import type { ProvenanceEvent } from '@gitgate/shared';
import type { DB } from '@gitgate/db';
import { provenanceChains } from '@gitgate/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { ArtifactsClient } from '../services/artifacts-client.js';

export interface RecordEventArgs {
  db: DB;
  artifacts: ArtifactsClient;
  orgId: string;
  repoId: string;
  prNumber: number;
  event: ProvenanceEvent;
  agentProvider?: string;
}

/**
 * Record a provenance event. Creates the chain on first use, opens a git repo
 * in Artifacts, and appends one commit per event.
 */
export async function recordEvent(args: RecordEventArgs): Promise<void> {
  const { db, artifacts, orgId, repoId, prNumber, event } = args;
  let chain = (
    await db
      .select()
      .from(provenanceChains)
      .where(and(eq(provenanceChains.repoId, repoId), eq(provenanceChains.prNumber, prNumber)))
      .limit(1)
  )[0];
  if (!chain) {
    const repoFull = repoId.replace(/^repo_/, '').replace(/_/g, '-');
    const name = `prov-${repoFull}-${prNumber}`;
    await artifacts.createProvenanceRepo(orgId, repoId, prNumber, name);
    await db.insert(provenanceChains).values({
      id: crypto.randomUUID(),
      orgId,
      repoId,
      prNumber,
      agentProvider: args.agentProvider ?? 'unknown',
      artifactsRepoName: name,
      eventCount: 0,
      status: 'open',
    });
    chain = (
      await db
        .select()
        .from(provenanceChains)
        .where(and(eq(provenanceChains.repoId, repoId), eq(provenanceChains.prNumber, prNumber)))
        .limit(1)
    )[0]!;
  }
  await artifacts.appendEvent(chain.artifactsRepoName, event);
  await db
    .update(provenanceChains)
    .set({ eventCount: sql`${provenanceChains.eventCount} + 1` })
    .where(eq(provenanceChains.id, chain.id));
}

export async function sealChain(
  db: DB,
  artifacts: ArtifactsClient,
  repoId: string,
  prNumber: number,
): Promise<void> {
  const chain = (
    await db
      .select()
      .from(provenanceChains)
      .where(and(eq(provenanceChains.repoId, repoId), eq(provenanceChains.prNumber, prNumber)))
      .limit(1)
  )[0];
  if (!chain) return;
  await artifacts.appendEvent(chain.artifactsRepoName, {
    type: 'pr.sealed',
    actor: 'gitgate',
    actorType: 'system',
    data: {},
    timestamp: Math.floor(Date.now() / 1000),
  });
  await db
    .update(provenanceChains)
    .set({ status: 'sealed', sealedAt: Math.floor(Date.now() / 1000) })
    .where(eq(provenanceChains.id, chain.id));
}
