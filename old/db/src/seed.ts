import { DEFAULT_WEIGHTS } from '@gitgate/shared';
import { sql } from 'drizzle-orm';
import type { DB } from './index.js';
import {
  agentActivityLog,
  agentBudgets,
  agentDetections,
  agentIdentities,
  governanceConfig,
  mergeConfidenceScores,
  orgs,
  provenanceChains,
  repos,
} from './schema/index.js';

const ORG_ID = 'org_acme';
const REPO_API_ID = 'repo_acme_api';
const REPO_WEB_ID = 'repo_acme_web';

export async function seed(db: DB): Promise<void> {
  await db.insert(orgs).values({
    id: ORG_ID,
    githubOrgId: 1001,
    githubOrgLogin: 'acme',
    displayName: 'Acme Corp',
    plan: 'team',
    installationId: 50001,
  });

  await db.insert(repos).values([
    {
      id: REPO_API_ID,
      orgId: ORG_ID,
      githubRepoId: 9001,
      githubFullName: 'acme/api',
      defaultBranch: 'main',
      monitoringEnabled: 1,
    },
    {
      id: REPO_WEB_ID,
      orgId: ORG_ID,
      githubRepoId: 9002,
      githubFullName: 'acme/web',
      defaultBranch: 'main',
      monitoringEnabled: 1,
    },
  ]);

  await db.insert(agentIdentities).values([
    {
      id: 'agent_claude',
      orgId: ORG_ID,
      name: 'Claude Code',
      provider: 'claude',
      matchRules: JSON.stringify({
        committerEmails: ['*+claude-code@users.noreply.github.com'],
      }),
      status: 'active',
    },
    {
      id: 'agent_cursor',
      orgId: ORG_ID,
      name: 'Cursor',
      provider: 'cursor',
      matchRules: JSON.stringify({ prBodyPatterns: ['\\[cursor\\]'] }),
      status: 'active',
    },
  ]);

  await db.insert(agentDetections).values([
    {
      id: 'det_001',
      orgId: ORG_ID,
      repoId: REPO_API_ID,
      prNumber: 142,
      detectedProvider: 'claude',
      confidence: 'high',
      signals: JSON.stringify(['committer-email-match', 'body-marker']),
      labeled: 1,
      commented: 1,
    },
    {
      id: 'det_002',
      orgId: ORG_ID,
      repoId: REPO_API_ID,
      prNumber: 143,
      detectedProvider: 'claude',
      confidence: 'high',
      signals: JSON.stringify(['committer-email-match']),
      labeled: 1,
      commented: 1,
    },
    {
      id: 'det_003',
      orgId: ORG_ID,
      repoId: REPO_WEB_ID,
      prNumber: 88,
      detectedProvider: 'cursor',
      confidence: 'medium',
      signals: JSON.stringify(['body-marker']),
      labeled: 1,
      commented: 1,
    },
  ]);

  const weightsSnapshot = JSON.stringify(DEFAULT_WEIGHTS);
  await db.insert(mergeConfidenceScores).values([
    {
      id: 'score_001',
      orgId: ORG_ID,
      repoId: REPO_API_ID,
      prNumber: 142,
      overallScore: 72,
      testHealth: 80,
      scopeContainment: 80,
      reviewDepth: 60,
      agentTrust: 65,
      sizeDiscipline: 80,
      provenanceQuality: 75,
      weightsSnapshot,
      isAgentAuthored: 1,
      githubCheckRunId: 'cr_142_v1',
    },
    {
      id: 'score_002',
      orgId: ORG_ID,
      repoId: REPO_API_ID,
      prNumber: 143,
      overallScore: 85,
      testHealth: 95,
      scopeContainment: 90,
      reviewDepth: 80,
      agentTrust: 75,
      sizeDiscipline: 100,
      provenanceQuality: 80,
      weightsSnapshot,
      isAgentAuthored: 1,
      githubCheckRunId: 'cr_143_v1',
    },
    {
      id: 'score_003',
      orgId: ORG_ID,
      repoId: REPO_WEB_ID,
      prNumber: 88,
      overallScore: 45,
      testHealth: 50,
      scopeContainment: 40,
      reviewDepth: 0,
      agentTrust: 50,
      sizeDiscipline: 50,
      provenanceQuality: 80,
      weightsSnapshot,
      isAgentAuthored: 1,
      githubCheckRunId: 'cr_88_v1',
    },
  ]);

  await db.insert(provenanceChains).values({
    id: 'chain_001',
    orgId: ORG_ID,
    repoId: REPO_API_ID,
    prNumber: 142,
    agentProvider: 'claude',
    artifactsRepoName: 'prov-acme-api-142',
    eventCount: 4,
    status: 'open',
  });

  const periodKey = new Date().toISOString().slice(0, 7);
  await db.insert(agentActivityLog).values([
    {
      id: 'act_001',
      orgId: ORG_ID,
      agentProvider: 'claude',
      repoId: REPO_API_ID,
      prNumber: 142,
      activityType: 'pr_opened',
      activityUnits: 1,
      periodKey,
    },
    {
      id: 'act_002',
      orgId: ORG_ID,
      agentProvider: 'claude',
      repoId: REPO_API_ID,
      prNumber: 142,
      activityType: 'commit',
      activityUnits: 0.2,
      periodKey,
    },
    {
      id: 'act_003',
      orgId: ORG_ID,
      agentProvider: 'claude',
      repoId: REPO_API_ID,
      prNumber: 143,
      activityType: 'pr_opened',
      activityUnits: 1,
      periodKey,
    },
    {
      id: 'act_004',
      orgId: ORG_ID,
      agentProvider: 'claude',
      repoId: REPO_API_ID,
      prNumber: 143,
      activityType: 'pr_merged',
      activityUnits: 1,
      periodKey,
    },
    {
      id: 'act_005',
      orgId: ORG_ID,
      agentProvider: 'cursor',
      repoId: REPO_WEB_ID,
      prNumber: 88,
      activityType: 'pr_opened',
      activityUnits: 1,
      periodKey,
    },
  ]);

  await db.insert(agentBudgets).values({
    id: 'budget_001',
    orgId: ORG_ID,
    scopeType: 'org',
    scopeId: ORG_ID,
    period: 'monthly',
    limitUnits: 500,
    costPerUnit: 0.05,
    alertThresholdPct: 80,
    enforcement: 'comment',
  });

  await db.insert(governanceConfig).values({
    scopeId: ORG_ID,
    scopeType: 'org',
    confidenceWeights: JSON.stringify(DEFAULT_WEIGHTS),
    confidenceMinimum: 60,
    sizeThresholds: JSON.stringify({ excellent: 200, good: 500, acceptable: 1000 }),
    applyToHumanPrs: 1,
    detectionEnabled: 1,
    detectionLabelFormat: 'agent:{provider}',
    detectionPostComment: 1,
    provenanceEnabled: 1,
    exemptBots: JSON.stringify(['dependabot[bot]', 'renovate[bot]']),
  });
}

export async function clear(db: DB): Promise<void> {
  await db.run(sql`DELETE FROM agent_activity_log`);
  await db.run(sql`DELETE FROM agent_budgets`);
  await db.run(sql`DELETE FROM agent_identities`);
  await db.run(sql`DELETE FROM provenance_chains`);
  await db.run(sql`DELETE FROM merge_confidence_scores`);
  await db.run(sql`DELETE FROM agent_detections`);
  await db.run(sql`DELETE FROM governance_config`);
  await db.run(sql`DELETE FROM repos`);
  await db.run(sql`DELETE FROM orgs`);
}
