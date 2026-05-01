import { createDB } from '@gitgate/db';
import {
  agentActivityLog,
  agentDetections,
  governanceConfig,
  repos,
} from '@gitgate/db/schema';
import type { GitEvent, PREvent, RepoRef } from '@gitgate/shared';
import { eq } from 'drizzle-orm';
import { GitHubAdapter } from '../adapters/github.js';
import type { Env } from '../env.js';
import { detectAgent } from '../engine/agent-detection.js';
import { recordUsage, periodKey } from '../engine/budgets.js';
import { loadAndPersistGitgateYml } from '../engine/config-loader.js';
import {
  buildCheckRunSummary,
  computeMergeConfidence,
  persistScore,
} from '../engine/merge-confidence.js';
import { recordEvent, sealChain } from '../engine/provenance.js';
import { ArtifactsClient } from '../services/artifacts-client.js';
import { GitHubAppService } from '../services/github-app.js';
import { GitHubApi } from '../services/github-api.js';

interface IncomingPayload {
  event: GitEvent;
}

/**
 * One Durable Object per `owner/repo`. Serializes event handling for the
 * repo so that detections, scores, and provenance updates don't race.
 */
export class RepoAnalyzer {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const payload = (await request.json()) as IncomingPayload;
    try {
      await this.handle(payload.event);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (err) {
      console.error('RepoAnalyzer error', err);
      return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 500 });
    }
  }

  private async handle(event: GitEvent): Promise<void> {
    switch (event.type) {
      case 'pr.opened':
      case 'pr.updated':
        await this.onPullRequest(event.data);
        return;
      case 'pr.review':
        await this.onPullRequest(event.data.pr, { trigger: 'review' });
        return;
      case 'check.completed':
        if (event.data.prNumber !== undefined) {
          await this.rescoreByCheck({
            org: event.data.org,
            repo: event.data.repo,
            installationId: event.data.installationId,
            prNumber: event.data.prNumber,
            headSha: event.data.headSha,
          });
        }
        return;
      case 'pr.closed':
        await this.onClosed(event.data);
        return;
      case 'push':
        await this.onPush(event.data);
        return;
      default:
        return;
    }
  }

  private async onPush(data: {
    org: string;
    repo: string;
    installationId: number;
    ref: string;
    after: string;
    commits: Array<{ added: string[]; modified: string[]; removed: string[] }>;
  }): Promise<void> {
    const touchedConfig = data.commits.some(
      (c) =>
        c.added.includes('.gitgate.yml') ||
        c.modified.includes('.gitgate.yml') ||
        c.removed.includes('.gitgate.yml'),
    );
    if (!touchedConfig) return;
    const repoRow = await this.loadRepoRow(data.org, data.repo);
    if (!repoRow) return;
    const { api, db } = this.services();
    await loadAndPersistGitgateYml({
      api,
      db,
      org: data.org,
      repo: data.repo,
      installationId: data.installationId,
      ref: data.after,
      orgId: repoRow.orgId,
      repoId: repoRow.id,
    });
  }

  private services() {
    const appSvc = new GitHubAppService(this.env);
    const api = new GitHubApi(appSvc);
    const adapter = new GitHubAdapter(api, this.env.GITHUB_WEBHOOK_SECRET);
    const artifacts = new ArtifactsClient(this.env.ARTIFACTS);
    const db = createDB(this.env.DB);
    return { api, adapter, artifacts, db };
  }

  private async loadRepoRow(orgLogin: string, repoName: string) {
    const db = createDB(this.env.DB);
    const fullName = `${orgLogin}/${repoName}`;
    return (await db.select().from(repos).where(eq(repos.githubFullName, fullName)).limit(1))[0];
  }

  private async loadConfig(orgId: string, repoId: string) {
    const db = createDB(this.env.DB);
    const repoCfg = (
      await db.select().from(governanceConfig).where(eq(governanceConfig.scopeId, repoId)).limit(1)
    )[0];
    const orgCfg = (
      await db.select().from(governanceConfig).where(eq(governanceConfig.scopeId, orgId)).limit(1)
    )[0];
    const cfg = repoCfg ?? orgCfg;
    if (!cfg) return undefined;
    return {
      confidenceWeights: cfg.confidenceWeights ? JSON.parse(cfg.confidenceWeights) : undefined,
      confidenceMinimum: cfg.confidenceMinimum ?? undefined,
      sizeThresholds: cfg.sizeThresholds ? JSON.parse(cfg.sizeThresholds) : undefined,
      scopeMappings: cfg.scopeMappings ? JSON.parse(cfg.scopeMappings) : undefined,
      applyToHumanPrs: !!cfg.applyToHumanPrs,
      detectionEnabled: !!cfg.detectionEnabled,
      detectionLabelFormat: cfg.detectionLabelFormat ?? 'agent:{provider}',
      detectionPostComment: !!cfg.detectionPostComment,
      provenanceEnabled: !!cfg.provenanceEnabled,
      exemptBots: cfg.exemptBots ? (JSON.parse(cfg.exemptBots) as string[]) : [],
    };
  }

  private async onPullRequest(pr: PREvent, _opts: { trigger?: string } = {}): Promise<void> {
    const { db, adapter, api, artifacts } = this.services();
    const repoRow = await this.loadRepoRow(pr.org, pr.repo);
    if (!repoRow) return;
    const config = await this.loadConfig(repoRow.orgId, repoRow.id);

    const repoRef: RepoRef = {
      owner: pr.org,
      repo: pr.repo,
      installationId: pr.installationId,
    };

    const files = await api.getPRFiles(repoRef, pr.prNumber);
    const reviews = await api.getPRReviews(repoRef, pr.prNumber);
    const comments = await api.getPRReviewComments(repoRef, pr.prNumber);
    const checkRuns = await api.getCheckRuns(repoRef, pr.headSha);
    const linkedIssue = await api.getLinkedIssue(repoRef, pr.prNumber, pr.body);

    const detection = await detectAgent({
      db,
      orgId: repoRow.orgId,
      pr,
      files,
      exemptBots: config?.exemptBots ?? [],
    });

    if (detection.detected && config?.detectionEnabled !== false) {
      const label = (config?.detectionLabelFormat ?? 'agent:{provider}').replace(
        '{provider}',
        detection.provider,
      );
      await safe(adapter.addLabel(repoRef, pr.prNumber, label));
      const existing = await db
        .select()
        .from(agentDetections)
        .where(eq(agentDetections.repoId, repoRow.id))
        .limit(1);
      if (existing.length === 0 && config?.detectionPostComment !== false) {
        await safe(
          adapter.postComment(
            repoRef,
            pr.prNumber,
            buildDetectionComment(detection.provider, detection.signals),
          ),
        );
      }
      await db
        .insert(agentDetections)
        .values({
          id: crypto.randomUUID(),
          orgId: repoRow.orgId,
          repoId: repoRow.id,
          prNumber: pr.prNumber,
          detectedProvider: detection.provider,
          confidence: detection.confidence,
          signals: JSON.stringify(detection.signals),
          labeled: 1,
          commented: 1,
        })
        .onConflictDoNothing();

      if (config?.provenanceEnabled !== false) {
        await recordEvent({
          db,
          artifacts,
          orgId: repoRow.orgId,
          repoId: repoRow.id,
          prNumber: pr.prNumber,
          agentProvider: detection.provider,
          event: {
            type: 'trigger.pr_opened',
            actor: pr.author.login,
            actorType: 'agent',
            data: { title: pr.title, headSha: pr.headSha },
            timestamp: Math.floor(Date.now() / 1000),
          },
        });
      }
      await db.insert(agentActivityLog).values({
        id: crypto.randomUUID(),
        orgId: repoRow.orgId,
        agentProvider: detection.provider,
        repoId: repoRow.id,
        prNumber: pr.prNumber,
        activityType: 'pr_event',
        activityUnits: 1,
        periodKey: periodKey('monthly'),
      });
      await recordUsage(db, {
        orgId: repoRow.orgId,
        agentProvider: detection.provider,
        units: 1,
      });
    }

    if (!detection.detected && config?.applyToHumanPrs === false) {
      return;
    }

    const score = computeMergeConfidence({
      pr,
      files,
      reviews,
      reviewComments: comments,
      checkRuns,
      linkedIssue,
      isAgentAuthored: detection.detected,
      agentProvider: detection.provider,
      config,
    });
    const checkSummary = buildCheckRunSummary(score);
    const minimum = config?.confidenceMinimum;
    const conclusion: CheckConclusion =
      minimum === undefined ? 'neutral' : score.overall >= minimum ? 'success' : 'failure';

    let checkRunId: string | undefined;
    try {
      const created = await api.createCheckRun(repoRef, {
        name: 'gitgate/merge-confidence',
        headSha: pr.headSha,
        status: 'completed',
        conclusion,
        output: {
          title: checkSummary.title,
          summary: checkSummary.summary,
        },
        detailsUrl: 'https://gitgate.com/docs/merge-confidence',
      });
      checkRunId = String(created.id);
    } catch (err) {
      console.error('createCheckRun failed', err);
    }
    await persistScore(db, {
      orgId: repoRow.orgId,
      repoId: repoRow.id,
      prNumber: pr.prNumber,
      score,
      githubCheckRunId: checkRunId,
    });
  }

  private async rescoreByCheck(meta: {
    org: string;
    repo: string;
    installationId: number;
    prNumber: number;
    headSha: string;
  }): Promise<void> {
    const { api } = this.services();
    const ref: RepoRef = { owner: meta.org, repo: meta.repo, installationId: meta.installationId };
    // We don't have the full PR payload here; fetch the basics via the GH API instead.
    const res = await fetch(
      `https://api.github.com/repos/${meta.org}/${meta.repo}/pulls/${meta.prNumber}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${await new GitHubAppService(this.env).getInstallationToken(meta.installationId)}`,
          'User-Agent': 'gitgate-api/0.1.0',
        },
      },
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      number: number;
      title: string;
      body?: string;
      user: { login: string; type?: string };
      head: { ref: string; sha: string };
      base: { ref: string };
      labels?: Array<{ name: string }>;
    };
    const pr: PREvent = {
      provider: 'github',
      org: meta.org,
      repo: meta.repo,
      prNumber: meta.prNumber,
      author: { login: data.user.login, type: data.user.type === 'Bot' ? 'bot' : 'user' },
      headSha: data.head.sha,
      baseBranch: data.base.ref,
      headBranch: data.head.ref,
      title: data.title,
      body: data.body ?? '',
      labels: data.labels?.map((l) => l.name) ?? [],
      linkedIssueNumbers: [],
      installationId: meta.installationId,
      raw: data,
    };
    await this.onPullRequest(pr, { trigger: 'check' });
    void api;
    void ref;
  }

  private async onClosed(pr: PREvent): Promise<void> {
    const { db, artifacts } = this.services();
    const repoRow = await this.loadRepoRow(pr.org, pr.repo);
    if (!repoRow) return;
    await sealChain(db, artifacts, repoRow.id, pr.prNumber);
  }
}

type CheckConclusion = 'success' | 'failure' | 'neutral';

function buildDetectionComment(provider: string, signals: string[]): string {
  return [
    `**🤖 GitGate detected this PR was authored by an agent (\`${provider}\`).**`,
    '',
    `Signals: ${signals.map((s) => `\`${s}\``).join(', ')}`,
    '',
    'A Merge Confidence score will appear shortly as a check run.',
    'Learn more: https://gitgate.com/docs/merge-confidence',
  ].join('\n');
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error(err);
    return null;
  }
}
