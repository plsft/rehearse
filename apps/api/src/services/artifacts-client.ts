import type { ProvenanceEvent } from '@gitgate/shared';
import type { ArtifactsNamespace } from '../env.js';

/**
 * Thin wrapper over the Workers Artifacts namespace. We treat each provenance
 * chain as a git repo and each event as a commit on `main`.
 */
export class ArtifactsClient {
  constructor(private readonly ns: ArtifactsNamespace) {}

  async createProvenanceRepo(
    org: string,
    repoId: string,
    prNumber: number,
    name?: string,
  ): Promise<string> {
    const repoName = name ?? `prov-${org}-${repoId}-${prNumber}`;
    const handle = await this.ns.createRepo(repoName);
    await handle.commit({
      message: 'init: open provenance chain',
      files: {
        'README.md': `# Provenance chain\n\norg=${org}\nrepoId=${repoId}\npr=${prNumber}\n`,
        'events.ndjson': '',
      },
      author: { name: 'GitGate', email: 'noreply@gitgate.com' },
    });
    return repoName;
  }

  async getProvenanceRepo(org: string, repoId: string, prNumber: number) {
    return this.ns.getRepo(`prov-${org}-${repoId}-${prNumber}`);
  }

  async createCIArtifactRepo(org: string, repo: string, runId: string): Promise<string> {
    const name = `ci-${org}-${repo}-${runId}`;
    await this.ns.createRepo(name);
    return name;
  }

  async createConfigRepo(org: string): Promise<string> {
    const name = `config-${org}`;
    await this.ns.createRepo(name);
    return name;
  }

  async appendEvent(repoName: string, event: ProvenanceEvent): Promise<void> {
    const handle = await this.ns.getRepo(repoName);
    if (!handle) throw new Error(`Provenance repo not found: ${repoName}`);
    const line = `${JSON.stringify(event)}\n`;
    const existingCount = await handle.countCommits();
    await handle.commit({
      message: `${event.type} (#${existingCount + 1})`,
      files: {
        [`events/${String(existingCount).padStart(6, '0')}.json`]: JSON.stringify(event, null, 2),
      },
      author: {
        name: event.actor,
        email: `${event.actorType}@gitgate.local`,
      },
    });
    void line;
  }

  async createExportToken(repoName: string, ttlSeconds: number) {
    return this.ns.createExportToken(repoName, { ttl: ttlSeconds });
  }
}
