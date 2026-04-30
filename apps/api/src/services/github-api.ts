import type {
  CheckRun,
  CheckRunData,
  FileChange,
  Issue,
  RepoRef,
  Review,
} from '@gitgate/shared';
import type { GitHubAppService } from './github-app.js';

const API = 'https://api.github.com';

export class GitHubApi {
  constructor(private readonly app: GitHubAppService) {}

  private async authedFetch(installationId: number, path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.app.getInstallationToken(installationId);
    const headers = new Headers(init.headers ?? {});
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    headers.set('User-Agent', 'gitgate-api/0.1.0');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const res = await fetch(`${API}${path}`, { ...init, headers });
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset') ?? '0');
      const wait = Math.max(0, reset * 1000 - Date.now());
      if (wait > 0 && wait < 30_000) {
        await new Promise((r) => setTimeout(r, wait));
        return this.authedFetch(installationId, path, init);
      }
    }
    return res;
  }

  async getPRFiles(repo: RepoRef, prNumber: number): Promise<FileChange[]> {
    const res = await this.authedFetch(
      repo.installationId,
      `/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/files?per_page=100`,
    );
    if (!res.ok) throw new Error(`getPRFiles: ${res.status}`);
    const body = (await res.json()) as Array<{
      filename: string;
      status: FileChange['status'];
      additions: number;
      deletions: number;
      patch?: string;
    }>;
    return body.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  async getPRReviews(repo: RepoRef, prNumber: number): Promise<Review[]> {
    const res = await this.authedFetch(
      repo.installationId,
      `/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/reviews?per_page=100`,
    );
    if (!res.ok) throw new Error(`getPRReviews: ${res.status}`);
    const body = (await res.json()) as Array<{
      user: { login: string };
      state: string;
      body?: string;
      submitted_at: string;
    }>;
    return body.map((r) => ({
      reviewer: r.user.login,
      state: r.state.toLowerCase() as Review['state'],
      body: r.body,
      submittedAt: Math.floor(new Date(r.submitted_at).getTime() / 1000),
    }));
  }

  async getPRReviewComments(repo: RepoRef, prNumber: number): Promise<Array<{ path: string; reviewer: string }>> {
    const res = await this.authedFetch(
      repo.installationId,
      `/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/comments?per_page=100`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as Array<{ path: string; user: { login: string } }>;
    return body.map((c) => ({ path: c.path, reviewer: c.user.login }));
  }

  async getCheckRuns(repo: RepoRef, ref: string): Promise<CheckRun[]> {
    const res = await this.authedFetch(
      repo.installationId,
      `/repos/${repo.owner}/${repo.repo}/commits/${ref}/check-runs?per_page=100`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { check_runs: Array<CheckRun & { conclusion: string }> };
    return body.check_runs.map((c) => ({
      name: c.name,
      status: c.status,
      conclusion: (c.conclusion ?? undefined) as CheckRun['conclusion'],
      output: c.output,
    }));
  }

  async createCheckRun(repo: RepoRef, data: CheckRunData): Promise<{ id: number }> {
    const res = await this.authedFetch(
      repo.installationId,
      `/repos/${repo.owner}/${repo.repo}/check-runs`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          head_sha: data.headSha,
          status: data.status,
          conclusion: data.conclusion,
          output: data.output,
          details_url: data.detailsUrl,
        }),
      },
    );
    if (!res.ok) throw new Error(`createCheckRun: ${res.status} ${await res.text()}`);
    return (await res.json()) as { id: number };
  }

  async updateCheckRun(repo: RepoRef, id: number, data: Partial<CheckRunData>): Promise<void> {
    const res = await this.authedFetch(
      repo.installationId,
      `/repos/${repo.owner}/${repo.repo}/check-runs/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: data.name,
          status: data.status,
          conclusion: data.conclusion,
          output: data.output,
          details_url: data.detailsUrl,
        }),
      },
    );
    if (!res.ok) throw new Error(`updateCheckRun: ${res.status}`);
  }

  async createComment(repo: RepoRef, prNumber: number, body: string): Promise<void> {
    await this.authedFetch(
      repo.installationId,
      `/repos/${repo.owner}/${repo.repo}/issues/${prNumber}/comments`,
      { method: 'POST', body: JSON.stringify({ body }) },
    );
  }

  async addLabel(repo: RepoRef, prNumber: number, label: string): Promise<void> {
    await this.authedFetch(
      repo.installationId,
      `/repos/${repo.owner}/${repo.repo}/issues/${prNumber}/labels`,
      { method: 'POST', body: JSON.stringify({ labels: [label] }) },
    );
  }

  async getLinkedIssue(repo: RepoRef, prNumber: number, body: string): Promise<Issue | null> {
    const m = body.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
    if (!m) return null;
    const issueNumber = Number(m[1]);
    const res = await this.authedFetch(
      repo.installationId,
      `/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { number: number; title: string; labels: Array<{ name: string }> };
    return {
      number: data.number,
      title: data.title,
      labels: data.labels.map((l) => l.name),
    };
  }
}
