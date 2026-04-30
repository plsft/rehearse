export interface GitProviderAdapter {
  readonly provider: 'github' | 'gitlab' | 'artifacts';
  parseWebhook(request: Request): Promise<GitEvent>;
  getPRFiles(event: PREvent): Promise<FileChange[]>;
  getPRReviews(event: PREvent): Promise<Review[]>;
  getCheckRuns(event: PREvent): Promise<CheckRun[]>;
  getLinkedIssue(event: PREvent): Promise<Issue | null>;
  postCheckRun(repo: RepoRef, data: CheckRunData): Promise<void>;
  postComment(repo: RepoRef, prNumber: number, body: string): Promise<void>;
  addLabel(repo: RepoRef, prNumber: number, label: string): Promise<void>;
}

export type GitEvent =
  | { type: 'pr.opened'; data: PREvent }
  | { type: 'pr.updated'; data: PREvent }
  | { type: 'pr.closed'; data: PREvent }
  | { type: 'pr.review'; data: ReviewEvent }
  | { type: 'check.completed'; data: CheckEvent }
  | { type: 'push'; data: PushEvent }
  | { type: 'installation.created'; data: InstallationEvent }
  | { type: 'installation.deleted'; data: InstallationEvent }
  | { type: 'unknown'; data: { eventName: string; raw: unknown } };

export interface PREvent {
  provider: string;
  org: string;
  repo: string;
  prNumber: number;
  author: AuthorInfo;
  headSha: string;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
  labels: string[];
  linkedIssueNumbers: number[];
  installationId: number;
  action?: string;
  raw: unknown;
}

export interface ReviewEvent {
  pr: PREvent;
  review: Review;
}

export interface CheckEvent {
  org: string;
  repo: string;
  installationId: number;
  prNumber?: number;
  headSha: string;
  checkRun: CheckRun;
  raw: unknown;
}

export interface PushEvent {
  org: string;
  repo: string;
  installationId: number;
  ref: string;
  before: string;
  after: string;
  commits: PushCommit[];
  raw: unknown;
}

export interface PushCommit {
  id: string;
  message: string;
  author: AuthorInfo;
  added: string[];
  modified: string[];
  removed: string[];
}

export interface InstallationEvent {
  installationId: number;
  org: string;
  orgId: number;
  repos: Array<{ id: number; fullName: string; defaultBranch: string }>;
  raw: unknown;
}

export interface AuthorInfo {
  login: string;
  type: 'user' | 'bot';
  email?: string;
}

export interface FileChange {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}

export interface DiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface Review {
  reviewer: string;
  state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
  body?: string;
  submittedAt: number;
}

export interface ReviewComment {
  path: string;
  body: string;
  reviewer: string;
}

export interface CheckRun {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'skipped';
  output?: { title?: string; summary?: string; text?: string };
}

export interface CheckRunData {
  name: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: string;
  output?: { title: string; summary: string; text?: string };
  detailsUrl?: string;
}

export interface Issue {
  number: number;
  title: string;
  labels: string[];
}

export interface RepoRef {
  owner: string;
  repo: string;
  installationId: number;
}
