import { loadConfig, readAuthToken } from '../../utils/config.js';
import { bold, error, info, table } from '../../utils/output.js';

interface ScoreResponse {
  ok: boolean;
  data?: {
    overall: number;
    testHealth: number;
    scopeContainment: number;
    reviewDepth: number;
    agentTrust: number;
    sizeDiscipline: number;
    provenanceQuality: number;
    isAgentAuthored: boolean;
    weights: Record<string, number>;
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

export async function runGateScore(prNumberStr: string): Promise<number> {
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
  const url = `${cfg.apiUrl}/v1/confidence/${repo.owner}/${repo.repo}/${prNumber}`;
  info(`Querying ${url}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    error(`API responded ${res.status}: ${await res.text()}`);
    return 1;
  }
  const body = (await res.json()) as ScoreResponse;
  if (!body.ok || !body.data) {
    error('Score not available');
    return 1;
  }
  const d = body.data;
  console.log(bold(`Merge Confidence: ${d.overall}/100`));
  console.log(
    table([
      { component: 'Test Health', score: d.testHealth, weight: d.weights.testHealth ?? '' },
      { component: 'Scope Containment', score: d.scopeContainment, weight: d.weights.scopeContainment ?? '' },
      { component: 'Review Depth', score: d.reviewDepth, weight: d.weights.reviewDepth ?? '' },
      { component: 'Agent Trust', score: d.agentTrust, weight: d.weights.agentTrust ?? '' },
      { component: 'Size Discipline', score: d.sizeDiscipline, weight: d.weights.sizeDiscipline ?? '' },
      { component: 'Provenance Quality', score: d.provenanceQuality, weight: d.weights.provenanceQuality ?? '' },
    ]),
  );
  console.log('');
  console.log(`Agent-authored: ${d.isAgentAuthored ? 'yes' : 'no'}`);
  return 0;
}
