import { loadConfig, readAuthToken } from '../../utils/config.js';
import { bold, error, info, success } from '../../utils/output.js';

interface ProvenanceResponse {
  ok: boolean;
  data?: {
    artifactsRepoName: string;
    eventCount: number;
    status: string;
    cloneUrl?: string;
    events: Array<{ type: string; actor: string; actorType: string; timestamp: number }>;
  };
}

async function detectRepo(cwd: string): Promise<{ owner: string; repo: string } | null> {
  const { execFileSync } = await import('node:child_process');
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf-8' }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (!m) return null;
    return { owner: m[1]!, repo: m[2]! };
  } catch {
    return null;
  }
}

export async function runGateProvenance(prNumberStr: string): Promise<number> {
  const prNumber = Number(prNumberStr);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    error(`Invalid PR number: ${prNumberStr}`);
    return 1;
  }
  const cfg = await loadConfig();
  const token = await readAuthToken();
  if (!token) {
    error('Not authenticated. Run `gg auth login` first.');
    return 1;
  }
  const repo = await detectRepo(process.cwd());
  if (!repo) {
    error('Could not detect a GitHub remote in the current directory.');
    return 1;
  }
  const url = `${cfg.apiUrl}/v1/provenance/${repo.owner}/${repo.repo}/${prNumber}`;
  info(`Querying ${url}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    error(`API responded ${res.status}: ${await res.text()}`);
    return 1;
  }
  const body = (await res.json()) as ProvenanceResponse;
  if (!body.ok || !body.data) {
    error('Provenance not available');
    return 1;
  }
  const d = body.data;
  console.log(bold(`Provenance chain: ${d.artifactsRepoName}`));
  console.log(`Status: ${d.status}`);
  console.log(`Events: ${d.eventCount}`);
  if (d.cloneUrl) {
    success(`Clone: git clone ${d.cloneUrl}`);
  }
  for (const e of d.events) {
    console.log(`  • ${new Date(e.timestamp * 1000).toISOString()}  ${e.actorType}/${e.actor}  ${e.type}`);
  }
  return 0;
}
