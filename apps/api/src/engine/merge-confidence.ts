import type {
  CheckRun,
  FileChange,
  GovernanceConfig,
  Issue,
  MergeConfidenceScore,
  MergeConfidenceWeights,
  PREvent,
  Review,
  SizeThresholds,
} from '@gitgate/shared';
import { DEFAULT_SIZE_THRESHOLDS, DEFAULT_WEIGHTS } from '@gitgate/shared';
import type { DB } from '@gitgate/db';
import { mergeConfidenceScores } from '@gitgate/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export interface ScoreInputs {
  pr: PREvent;
  files: FileChange[];
  reviews: Review[];
  reviewComments: Array<{ path: string; reviewer: string }>;
  checkRuns: CheckRun[];
  coverageDelta?: number;
  linkedIssue: Issue | null;
  isAgentAuthored: boolean;
  agentProvider?: string;
  agentHistory?: AgentHistory;
  config?: GovernanceConfig;
  provenance?: ProvenanceSummary;
}

export interface AgentHistory {
  prsTotal: number;
  prsMerged: number;
  avgReviewDepth: number;
  ciFirstPassRate: number;
}

export interface ProvenanceSummary {
  hasTrigger: boolean;
  hasContext: boolean;
  hasIterations: boolean;
  chainValid: boolean;
}

export function computeMergeConfidence(inputs: ScoreInputs): MergeConfidenceScore {
  const weights: MergeConfidenceWeights = {
    ...DEFAULT_WEIGHTS,
    ...(inputs.config?.confidenceWeights ?? {}),
  };
  const sizeThresholds: SizeThresholds = inputs.config?.sizeThresholds ?? DEFAULT_SIZE_THRESHOLDS;

  const testHealth = scoreTestHealth(inputs.checkRuns, inputs.coverageDelta);
  const scopeContainment = scoreScopeContainment(
    inputs.files,
    inputs.linkedIssue,
    inputs.config?.scopeMappings,
  );
  const reviewDepth = scoreReviewDepth(inputs.reviews, inputs.reviewComments, inputs.files.length);
  const agentTrust = scoreAgentTrust(inputs.isAgentAuthored, inputs.agentHistory);
  const sizeDiscipline = scoreSizeDiscipline(inputs.files, sizeThresholds);
  const provenanceQuality = scoreProvenanceQuality(inputs.isAgentAuthored, inputs.provenance);

  const totalWeight =
    weights.testHealth +
    weights.scopeContainment +
    weights.reviewDepth +
    weights.agentTrust +
    weights.sizeDiscipline +
    weights.provenanceQuality;

  const overall = Math.round(
    (testHealth * weights.testHealth +
      scopeContainment * weights.scopeContainment +
      reviewDepth * weights.reviewDepth +
      agentTrust * weights.agentTrust +
      sizeDiscipline * weights.sizeDiscipline +
      provenanceQuality * weights.provenanceQuality) /
      totalWeight,
  );

  return {
    overall,
    testHealth,
    scopeContainment,
    reviewDepth,
    agentTrust,
    sizeDiscipline,
    provenanceQuality,
    weights,
    isAgentAuthored: inputs.isAgentAuthored,
    version: 1,
    computedAt: Math.floor(Date.now() / 1000),
  };
}

function scoreTestHealth(checks: CheckRun[], coverageDelta: number | undefined): number {
  if (checks.length === 0) return 50;
  const failed = checks.some((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out');
  if (failed) return 0;
  const allPassed = checks.every(
    (c) => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral',
  );
  if (!allPassed) return 50;
  if (coverageDelta === undefined) return 70;
  if (coverageDelta >= 0) {
    return Math.min(100, 70 + Math.min(30, coverageDelta * 10));
  }
  return Math.max(0, 70 + coverageDelta * 5);
}

function scoreScopeContainment(
  files: FileChange[],
  linkedIssue: Issue | null,
  scopeMappings: Record<string, string[]> | undefined,
): number {
  if (files.length === 0) return 50;
  if (linkedIssue && scopeMappings && Object.keys(scopeMappings).length > 0) {
    const allowed = new Set<string>();
    for (const label of linkedIssue.labels) {
      const mapped = scopeMappings[label];
      if (mapped) for (const p of mapped) allowed.add(p);
    }
    if (allowed.size === 0) return 60;
    const matches = files.filter((f) =>
      Array.from(allowed).some((prefix) => f.filename.startsWith(prefix.replace(/\*+$/, ''))),
    ).length;
    return Math.round((matches / files.length) * 100);
  }
  const dirs = new Set<string>();
  for (const f of files) {
    const d = f.filename.split('/')[0];
    if (d) dirs.add(d);
  }
  const numDirs = dirs.size;
  let raw: number;
  if (numDirs <= 1) raw = 100;
  else if (numDirs <= 3) raw = 80;
  else if (numDirs <= 6) raw = 60;
  else raw = Math.max(20, 80 - numDirs * 5);
  return linkedIssue ? raw : Math.max(0, raw - 10);
}

function scoreReviewDepth(
  reviews: Review[],
  comments: Array<{ path: string; reviewer: string }>,
  totalFiles: number,
): number {
  if (reviews.length === 0) return 0;
  const lastByReviewer = new Map<string, Review>();
  for (const r of reviews) {
    const existing = lastByReviewer.get(r.reviewer);
    if (!existing || existing.submittedAt < r.submittedAt) lastByReviewer.set(r.reviewer, r);
  }
  const last = Array.from(lastByReviewer.values());
  const approvals = last.filter((r) => r.state === 'approved');
  const changes = last.some((r) => r.state === 'changes_requested');

  let base: number;
  if (approvals.length === 0) base = 0;
  else if (comments.length === 0) base = 40;
  else {
    const filesCovered = new Set(comments.map((c) => c.path));
    const fileCoverage = totalFiles > 0 ? filesCovered.size / totalFiles : 0;
    base = 40 + Math.min(60, comments.length * 5 + fileCoverage * 30);
  }
  if (changes) base = Math.max(0, base - 20);
  return Math.min(100, Math.round(base));
}

function scoreAgentTrust(isAgent: boolean, history: AgentHistory | undefined): number {
  if (!isAgent) return 100;
  if (!history || history.prsTotal < 5) return 50;
  const mergeRate = history.prsMerged / Math.max(1, history.prsTotal);
  return Math.round(
    Math.min(100, mergeRate * 40 + history.avgReviewDepth * 0.3 + history.ciFirstPassRate * 30),
  );
}

function scoreSizeDiscipline(files: FileChange[], thresholds: SizeThresholds): number {
  const total = files.reduce((s, f) => s + f.additions + f.deletions, 0);
  if (total <= thresholds.excellent) return 100;
  if (total <= thresholds.good) return 80;
  if (total <= thresholds.acceptable) return 50;
  return Math.max(0, 50 - (total - thresholds.acceptable) / 100);
}

function scoreProvenanceQuality(isAgent: boolean, provenance: ProvenanceSummary | undefined): number {
  if (!isAgent) return 100;
  if (!provenance) return 0;
  let score = 0;
  if (provenance.hasTrigger) score += 25;
  if (provenance.hasContext) score += 25;
  if (provenance.hasIterations) score += 25;
  if (provenance.chainValid) score += 25;
  return score;
}

export async function persistScore(
  db: DB,
  args: {
    orgId: string;
    repoId: string;
    prNumber: number;
    score: MergeConfidenceScore;
    githubCheckRunId?: string;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  const previous = (
    await db
      .select()
      .from(mergeConfidenceScores)
      .where(
        and(
          eq(mergeConfidenceScores.repoId, args.repoId),
          eq(mergeConfidenceScores.prNumber, args.prNumber),
        ),
      )
      .orderBy(desc(mergeConfidenceScores.computedAt))
      .limit(1)
  )[0];
  await db.insert(mergeConfidenceScores).values({
    id,
    orgId: args.orgId,
    repoId: args.repoId,
    prNumber: args.prNumber,
    overallScore: args.score.overall,
    testHealth: args.score.testHealth,
    scopeContainment: args.score.scopeContainment,
    reviewDepth: args.score.reviewDepth,
    agentTrust: args.score.agentTrust,
    sizeDiscipline: args.score.sizeDiscipline,
    provenanceQuality: args.score.provenanceQuality,
    weightsSnapshot: JSON.stringify(args.score.weights),
    isAgentAuthored: args.score.isAgentAuthored ? 1 : 0,
    githubCheckRunId: args.githubCheckRunId ?? null,
    version: (previous?.version ?? 0) + 1,
  });
}

export function buildCheckRunSummary(score: MergeConfidenceScore): {
  title: string;
  summary: string;
  conclusion: 'success' | 'failure' | 'neutral';
} {
  const summary = [
    `| Component | Score | Weight |`,
    `| --- | ---: | ---: |`,
    `| Test Health | ${score.testHealth} | ${score.weights.testHealth}% |`,
    `| Scope Containment | ${score.scopeContainment} | ${score.weights.scopeContainment}% |`,
    `| Review Depth | ${score.reviewDepth} | ${score.weights.reviewDepth}% |`,
    `| Agent Trust | ${score.agentTrust} | ${score.weights.agentTrust}% |`,
    `| Size Discipline | ${score.sizeDiscipline} | ${score.weights.sizeDiscipline}% |`,
    `| Provenance Quality | ${score.provenanceQuality} | ${score.weights.provenanceQuality}% |`,
    '',
    `**Overall: ${score.overall}/100**`,
  ].join('\n');
  return {
    title: `Merge Confidence: ${score.overall}/100`,
    summary,
    conclusion: 'neutral',
  };
}
