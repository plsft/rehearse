/**
 * Cloudflare Worker bindings + secrets used by the GitGate API.
 *
 * `ARTIFACTS_NAMESPACE` is the Workers Artifacts binding handle. The exact
 * shape evolves with the platform; we narrow to the methods we use to keep
 * the rest of the codebase ergonomic and easy to mock in tests.
 */
export interface ArtifactsNamespace {
  createRepo(name: string): Promise<ArtifactsRepoHandle>;
  getRepo(name: string): Promise<ArtifactsRepoHandle | null>;
  createExportToken(name: string, options: { ttl: number }): Promise<{ token: string; cloneUrl: string }>;
}

export interface ArtifactsRepoHandle {
  name: string;
  cloneUrl: string;
  commit(args: { message: string; files: Record<string, string>; author: { name: string; email: string } }): Promise<{ sha: string }>;
  countCommits(): Promise<number>;
}

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ARTIFACTS: ArtifactsNamespace;
  REPO_ANALYZER: DurableObjectNamespace;

  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITGATE_API_URL: string;
}

export interface AppVariables {
  installationId?: number;
}
