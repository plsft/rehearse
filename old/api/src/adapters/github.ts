import type {
  AuthorInfo,
  CheckRun,
  CheckRunData,
  FileChange,
  GitEvent,
  GitProviderAdapter,
  Issue,
  PREvent,
  RepoRef,
  Review,
} from '@gitgate/shared';
import type { GitHubApi } from '../services/github-api.js';

/** Parse webhook headers and verify HMAC; convert payload to GitEvent. */
export class GitHubAdapter implements GitProviderAdapter {
  readonly provider = 'github' as const;

  constructor(
    private readonly api: GitHubApi,
    private readonly webhookSecret: string,
  ) {}

  async parseWebhook(request: Request): Promise<GitEvent> {
    const rawBody = await request.clone().text();
    const sig = request.headers.get('x-hub-signature-256') ?? '';
    if (!(await verifyHmac(this.webhookSecret, rawBody, sig))) {
      throw new Error('Invalid webhook signature');
    }
    const event = request.headers.get('x-github-event') ?? '';
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    return normalize(event, payload);
  }

  async getPRFiles(event: PREvent): Promise<FileChange[]> {
    return this.api.getPRFiles(repoRefFromEvent(event), event.prNumber);
  }
  async getPRReviews(event: PREvent): Promise<Review[]> {
    return this.api.getPRReviews(repoRefFromEvent(event), event.prNumber);
  }
  async getCheckRuns(event: PREvent): Promise<CheckRun[]> {
    return this.api.getCheckRuns(repoRefFromEvent(event), event.headSha);
  }
  async getLinkedIssue(event: PREvent): Promise<Issue | null> {
    return this.api.getLinkedIssue(repoRefFromEvent(event), event.prNumber, event.body);
  }
  async postCheckRun(repo: RepoRef, data: CheckRunData): Promise<void> {
    await this.api.createCheckRun(repo, data);
  }
  async postComment(repo: RepoRef, prNumber: number, body: string): Promise<void> {
    await this.api.createComment(repo, prNumber, body);
  }
  async addLabel(repo: RepoRef, prNumber: number, label: string): Promise<void> {
    await this.api.addLabel(repo, prNumber, label);
  }
}

function repoRefFromEvent(event: PREvent): RepoRef {
  return { owner: event.org, repo: event.repo, installationId: event.installationId };
}

function normalize(eventName: string, payload: Record<string, unknown>): GitEvent {
  const installationId = Number(
    (payload as { installation?: { id?: number } }).installation?.id ?? 0,
  );
  switch (eventName) {
    case 'pull_request':
      return mapPullRequest(payload, installationId);
    case 'pull_request_review':
      return mapReview(payload, installationId);
    case 'check_run':
      return mapCheckRun(payload, installationId);
    case 'push':
      return mapPush(payload, installationId);
    case 'installation':
      return mapInstallation(payload);
    default:
      return { type: 'unknown', data: { eventName, raw: payload } };
  }
}

function authorOf(user: { login: string; type?: string; email?: string } | undefined): AuthorInfo {
  if (!user) return { login: 'unknown', type: 'user' };
  return {
    login: user.login,
    type: (user.type?.toLowerCase() === 'bot' ? 'bot' : 'user') as AuthorInfo['type'],
    email: user.email,
  };
}

function mapPullRequest(payload: Record<string, unknown>, installationId: number): GitEvent {
  const action = String(payload.action ?? '');
  const pr = (payload as { pull_request: PullRequestPayload }).pull_request;
  const repoFull = (payload as { repository: { full_name: string } }).repository.full_name;
  const [owner, name] = repoFull.split('/');
  const linked = extractLinkedIssues(pr.body ?? '');
  const data: PREvent = {
    provider: 'github',
    org: owner!,
    repo: name!,
    prNumber: pr.number,
    author: authorOf(pr.user),
    headSha: pr.head.sha,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    title: pr.title,
    body: pr.body ?? '',
    labels: pr.labels?.map((l) => l.name) ?? [],
    linkedIssueNumbers: linked,
    installationId,
    action,
    raw: payload,
  };
  if (action === 'opened' || action === 'reopened') return { type: 'pr.opened', data };
  if (action === 'closed') return { type: 'pr.closed', data };
  return { type: 'pr.updated', data };
}

function mapReview(payload: Record<string, unknown>, installationId: number): GitEvent {
  const pr = (payload as { pull_request: PullRequestPayload }).pull_request;
  const repoFull = (payload as { repository: { full_name: string } }).repository.full_name;
  const [owner, name] = repoFull.split('/');
  const review = (payload as {
    review: { user: { login: string }; state: string; body?: string; submitted_at: string };
  }).review;
  const prEvent: PREvent = {
    provider: 'github',
    org: owner!,
    repo: name!,
    prNumber: pr.number,
    author: authorOf(pr.user),
    headSha: pr.head.sha,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    title: pr.title,
    body: pr.body ?? '',
    labels: pr.labels?.map((l) => l.name) ?? [],
    linkedIssueNumbers: extractLinkedIssues(pr.body ?? ''),
    installationId,
    raw: payload,
  };
  return {
    type: 'pr.review',
    data: {
      pr: prEvent,
      review: {
        reviewer: review.user.login,
        state: review.state.toLowerCase() as Review['state'],
        body: review.body,
        submittedAt: Math.floor(new Date(review.submitted_at).getTime() / 1000),
      },
    },
  };
}

function mapCheckRun(payload: Record<string, unknown>, installationId: number): GitEvent {
  const repoFull = (payload as { repository: { full_name: string } }).repository.full_name;
  const [owner, name] = repoFull.split('/');
  const cr = (payload as {
    check_run: {
      name: string;
      status: CheckRun['status'];
      conclusion: CheckRun['conclusion'];
      head_sha: string;
      pull_requests?: Array<{ number: number }>;
      output?: { title?: string; summary?: string; text?: string };
    };
  }).check_run;
  return {
    type: 'check.completed',
    data: {
      org: owner!,
      repo: name!,
      installationId,
      prNumber: cr.pull_requests?.[0]?.number,
      headSha: cr.head_sha,
      checkRun: {
        name: cr.name,
        status: cr.status,
        conclusion: cr.conclusion,
        output: cr.output,
      },
      raw: payload,
    },
  };
}

function mapPush(payload: Record<string, unknown>, installationId: number): GitEvent {
  const repoFull = (payload as { repository: { full_name: string } }).repository.full_name;
  const [owner, name] = repoFull.split('/');
  const commits = (
    payload as {
      commits?: Array<{
        id: string;
        message: string;
        author: { name?: string; email?: string; username?: string };
        added?: string[];
        modified?: string[];
        removed?: string[];
      }>;
    }
  ).commits;
  return {
    type: 'push',
    data: {
      org: owner!,
      repo: name!,
      installationId,
      ref: String(payload.ref),
      before: String(payload.before),
      after: String(payload.after),
      commits:
        commits?.map((c) => ({
          id: c.id,
          message: c.message,
          author: {
            login: c.author.username ?? c.author.email ?? 'unknown',
            type: 'user',
            email: c.author.email,
          },
          added: c.added ?? [],
          modified: c.modified ?? [],
          removed: c.removed ?? [],
        })) ?? [],
      raw: payload,
    },
  };
}

function mapInstallation(payload: Record<string, unknown>): GitEvent {
  const action = String(payload.action ?? '');
  const inst = (payload as { installation: { id: number; account: { login: string; id: number } } })
    .installation;
  const repos = ((payload as { repositories?: Array<{ id: number; full_name: string }> })
    .repositories ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    defaultBranch: 'main',
  }));
  const data = {
    installationId: inst.id,
    org: inst.account.login,
    orgId: inst.account.id,
    repos,
    raw: payload,
  };
  if (action === 'deleted') return { type: 'installation.deleted', data };
  return { type: 'installation.created', data };
}

function extractLinkedIssues(body: string): number[] {
  const out = new Set<number>();
  const re = /(?:closes|fixes|resolves)\s+#(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.add(Number(m[1]));
  return Array.from(out);
}

interface PullRequestPayload {
  number: number;
  title: string;
  body?: string;
  user: { login: string; type?: string };
  head: { ref: string; sha: string };
  base: { ref: string };
  labels?: Array<{ name: string }>;
}

async function verifyHmac(secret: string, body: string, signatureHeader: string): Promise<boolean> {
  if (!signatureHeader.startsWith('sha256=')) return false;
  const expected = signatureHeader.slice('sha256='.length);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(hex, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
