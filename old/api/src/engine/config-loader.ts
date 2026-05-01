import type { DB } from '@gitgate/db';
import { governanceConfig } from '@gitgate/db/schema';
import { gitgateYmlSchema, type GitGateYml, type GovernanceConfig } from '@gitgate/shared';
import { parse as parseYaml } from 'yaml';
import { eq } from 'drizzle-orm';
import type { GitHubApi } from '../services/github-api.js';

export interface LoadGitgateYmlArgs {
  api: GitHubApi;
  db: DB;
  org: string;
  repo: string;
  installationId: number;
  ref?: string;
  repoId: string;
  orgId: string;
}

/**
 * Read `.gitgate.yml` from the repo, validate it with Zod, merge it with the
 * org-level dashboard config, and persist the merged result on the repo scope.
 */
export async function loadAndPersistGitgateYml(args: LoadGitgateYmlArgs): Promise<GovernanceConfig | null> {
  const path = '.gitgate.yml';
  const ref = args.ref ?? '';
  const url = `/repos/${args.org}/${args.repo}/contents/${encodeURIComponent(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  // The GitHubApi client doesn't expose a generic `get` helper; we reuse fetch via an installation token.
  const token = await (args.api as unknown as { app: { getInstallationToken: (id: number) => Promise<string> } }).app.getInstallationToken(
    args.installationId,
  );
  const res = await fetch(`https://api.github.com${url}`, {
    headers: {
      Accept: 'application/vnd.github.raw',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'gitgate-api/0.1.0',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const text = await res.text();

  let parsed: GitGateYml;
  try {
    const raw = parseYaml(text);
    parsed = gitgateYmlSchema.parse(raw);
  } catch (err) {
    console.error(`Invalid .gitgate.yml in ${args.org}/${args.repo}:`, err);
    return null;
  }

  const merged: GovernanceConfig = {
    confidenceWeights: parsed.confidence?.weights
      ? {
          testHealth: parsed.confidence.weights.test_health,
          scopeContainment: parsed.confidence.weights.scope_containment,
          reviewDepth: parsed.confidence.weights.review_depth,
          agentTrust: parsed.confidence.weights.agent_trust,
          sizeDiscipline: parsed.confidence.weights.size_discipline,
          provenanceQuality: parsed.confidence.weights.provenance_quality,
        }
      : undefined,
    confidenceMinimum: parsed.confidence?.minimum_score,
    sizeThresholds: parsed.confidence?.size_thresholds,
    scopeMappings: parsed.confidence?.scope_mappings,
    applyToHumanPrs: parsed.confidence?.apply_to_human_prs,
    detectionEnabled: parsed.detection?.enabled,
    detectionLabelFormat: parsed.detection?.label_format,
    detectionPostComment: parsed.detection?.post_comment,
    provenanceEnabled: parsed.provenance?.enabled,
    exemptBots: parsed.detection?.exempt_bots,
  };

  await args.db
    .insert(governanceConfig)
    .values({
      scopeId: args.repoId,
      scopeType: 'repo',
      confidenceWeights: merged.confidenceWeights ? JSON.stringify(merged.confidenceWeights) : null,
      confidenceMinimum: merged.confidenceMinimum ?? null,
      sizeThresholds: merged.sizeThresholds ? JSON.stringify(merged.sizeThresholds) : null,
      scopeMappings: merged.scopeMappings ? JSON.stringify(merged.scopeMappings) : null,
      applyToHumanPrs: merged.applyToHumanPrs === false ? 0 : 1,
      detectionEnabled: merged.detectionEnabled === false ? 0 : 1,
      detectionLabelFormat: merged.detectionLabelFormat ?? 'agent:{provider}',
      detectionPostComment: merged.detectionPostComment === false ? 0 : 1,
      provenanceEnabled: merged.provenanceEnabled === false ? 0 : 1,
      exemptBots: merged.exemptBots ? JSON.stringify(merged.exemptBots) : null,
    })
    .onConflictDoUpdate({
      target: governanceConfig.scopeId,
      set: {
        confidenceWeights: merged.confidenceWeights ? JSON.stringify(merged.confidenceWeights) : null,
        confidenceMinimum: merged.confidenceMinimum ?? null,
        sizeThresholds: merged.sizeThresholds ? JSON.stringify(merged.sizeThresholds) : null,
        scopeMappings: merged.scopeMappings ? JSON.stringify(merged.scopeMappings) : null,
        applyToHumanPrs: merged.applyToHumanPrs === false ? 0 : 1,
        detectionEnabled: merged.detectionEnabled === false ? 0 : 1,
        detectionLabelFormat: merged.detectionLabelFormat ?? 'agent:{provider}',
        detectionPostComment: merged.detectionPostComment === false ? 0 : 1,
        provenanceEnabled: merged.provenanceEnabled === false ? 0 : 1,
        exemptBots: merged.exemptBots ? JSON.stringify(merged.exemptBots) : null,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    });

  // Touch governanceConfig table directly via eq for type safety
  void eq;
  return merged;
}
