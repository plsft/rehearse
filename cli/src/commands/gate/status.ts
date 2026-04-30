import { loadConfig, readAuthToken } from '../../utils/config.js';
import { error, info, success, warn } from '../../utils/output.js';

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

export async function runGateStatus(): Promise<number> {
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
  const url = `${cfg.apiUrl}/v1/governance/${repo.owner}/${repo.repo}/status`;
  info(`Querying ${url}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    error(`API responded ${res.status}: ${await res.text()}`);
    return 1;
  }
  const body = (await res.json()) as { ok: boolean; data?: unknown };
  if (!body.ok) {
    warn(JSON.stringify(body));
    return 1;
  }
  success(`Governance status for ${repo.owner}/${repo.repo}`);
  console.log(JSON.stringify(body.data, null, 2));
  return 0;
}
