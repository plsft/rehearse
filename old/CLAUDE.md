# GitGate — Single-File Executable PRD

## Claude Code: Build From Scratch

**Date:** April 30, 2026
**Repo:** Empty. `git init` has been run. Nothing else exists.
**Runtime:** Cloudflare Workers, Durable Objects, D1, KV, Artifacts
**Language:** TypeScript. Bun for local tooling, Node 22+ compatible.
**Package manager:** pnpm workspaces + Turborepo
**Testing:** Vitest
**Marketing site:** HTML + Tailwind CSS v4 + Alpine.js → Cloudflare Pages

---

## Product Summary

GitGate is two products in one monorepo:

1. **`@gitgate/ci` (Open Source, Apache 2.0)** — A TypeScript SDK that compiles CI pipeline definitions to GitHub Actions YAML. Type safety, IDE autocomplete, shared functions, agent-aware extensions. Defaults to Ubicloud runners (10x cheaper than GitHub hosted). Zero runtime dependency — the generated YAML works standalone.

2. **GitGate Platform (Closed Source)** — A GitHub App for agent governance. Detects agent-authored PRs, computes a Merge Confidence score (0–100) reported as a GitHub Check Run, builds immutable provenance chains stored as git repos on Cloudflare Artifacts, tracks agent budgets, ranks agents on leaderboards. No dashboard at launch — all governance surfaces in the GitHub PR UI via check runs, comments, and labels.

**Tagline:** "CI in TypeScript. Agent governance for Git."

**What is NOT in this build:**

- No dashboard (deferred to post-traction)
- No GitLab/Bitbucket adapters (future)
- No runner resale (future)
- No MCP server (future)

---

## How TypeScript CI Compiles and Executes

```
Developer writes TypeScript             Compile (local)                GitHub receives YAML
───────────────────────────            ─────────────────              ────────────────────
.gitgate/pipelines/ci.ts      →     gg ci compile      →     .github/workflows/ci.yml
                                          │                          │
                                          │ 1. Import .ts file       │
                                          │ 2. Execute (returns data)│
                                          │ 3. Compile to YAML       │
                                          │ 4. Write .yml file       │
                                          │ 5. Commit to repo        │
                                                                     │
                                                                     ▼
                                                          GitHub Actions reads YAML
                                                          Dispatches to Ubicloud runner
                                                          Runs steps, reports checks
                                                                     │
                                                                     ▼
                                                          GitGate GitHub App receives
                                                          check_run.completed webhook
                                                          Recomputes Merge Confidence
```

The TypeScript is executed at COMPILE TIME on the developer's machine. NOT at CI time. The output is plain YAML. No GitGate dependency at runtime. Eject any time.

---

## Cloudflare Artifacts Integration

GitGate uses Artifacts (Workers binding) as its governance data layer. Each provenance chain is a git repo. Each event is a commit. The commit history IS the audit trail. `git clone` IS the compliance export.

**Artifacts namespace:** `gitgate-data`

| Repo Pattern              | Purpose                                         |
| ------------------------- | ----------------------------------------------- |
| `prov-{org}-{repo}-{pr}`  | Provenance chain for a PR. Events = commits.    |
| `ci-{org}-{repo}-{runId}` | CI outputs: coverage, test results, build logs. |
| `config-{org}`            | Governance config history. Changes = commits.   |

**Binding config (wrangler.jsonc):**

```jsonc
{
  "artifacts": [{ "binding": "ARTIFACTS", "namespace": "gitgate-data" }],
  "d1_databases": [{ "binding": "DB", "database_name": "gitgate-db" }],
  "kv_namespaces": [{ "binding": "CACHE", "id": "gitgate-cache" }],
  "durable_objects": {
    "bindings": [{ "name": "REPO_ANALYZER", "class_name": "RepoAnalyzer" }]
  }
}
```

---

## Repository Structure

```
gitgate/
├── README.md
├── CLAUDE.md                            # THIS FILE
├── package.json                         # Root workspace
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .gitignore
├── .prettierrc
│
├── packages/
│   ├── ci/                              # @gitgate/ci — OPEN SOURCE (Apache 2.0)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── LICENSE
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── builder/
│   │   │   │   ├── pipeline.ts
│   │   │   │   ├── job.ts
│   │   │   │   ├── step.ts
│   │   │   │   ├── triggers.ts
│   │   │   │   ├── runner.ts
│   │   │   │   └── context.ts
│   │   │   ├── compiler/
│   │   │   │   ├── compile.ts
│   │   │   │   ├── yaml.ts
│   │   │   │   └── header.ts
│   │   │   ├── presets/
│   │   │   │   ├── index.ts
│   │   │   │   ├── node.ts
│   │   │   │   ├── bun.ts
│   │   │   │   ├── python.ts
│   │   │   │   ├── rust.ts
│   │   │   │   ├── go.ts
│   │   │   │   └── docker.ts
│   │   │   ├── agent/
│   │   │   │   ├── index.ts
│   │   │   │   ├── conditions.ts
│   │   │   │   ├── coverage.ts
│   │   │   │   ├── matrix.ts
│   │   │   │   └── provenance.ts
│   │   │   ├── converter/
│   │   │   │   ├── parse.ts
│   │   │   │   ├── transform.ts
│   │   │   │   └── runner-map.ts
│   │   │   └── estimator/
│   │   │       └── cost.ts
│   │   └── test/
│   │       ├── compiler/
│   │       │   ├── compile.test.ts
│   │       │   └── snapshots/
│   │       ├── builder/
│   │       │   ├── pipeline.test.ts
│   │       │   ├── step.test.ts
│   │       │   ├── context.test.ts
│   │       │   └── triggers.test.ts
│   │       ├── presets/
│   │       │   ├── node.test.ts
│   │       │   └── bun.test.ts
│   │       ├── agent/
│   │       │   └── conditions.test.ts
│   │       └── converter/
│   │           └── parse.test.ts
│   │
│   ├── shared/                          # Shared types
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types/
│   │       │   ├── governance.ts
│   │       │   ├── providers.ts
│   │       │   ├── agents.ts
│   │       │   └── api.ts
│   │       └── schemas/
│   │           ├── config.ts
│   │           └── api.ts
│   │
│   └── db/                              # D1 schema + Drizzle
│       ├── package.json
│       ├── tsconfig.json
│       ├── drizzle.config.ts
│       ├── src/
│       │   ├── index.ts
│       │   └── schema/
│       │       ├── orgs.ts
│       │       ├── repos.ts
│       │       ├── installations.ts
│       │       ├── agent-detections.ts
│       │       ├── merge-confidence.ts
│       │       ├── provenance.ts
│       │       ├── agent-budgets.ts
│       │       ├── agent-activity.ts
│       │       ├── leaderboard.ts
│       │       └── config.ts
│       └── migrations/
│           ├── 0001_core.sql
│           ├── 0002_governance.sql
│           └── 0003_budgets.sql
│
├── apps/
│   ├── api/                             # Platform API (Cloudflare Worker)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── wrangler.jsonc
│   │   └── src/
│   │       ├── index.ts
│   │       ├── routes/
│   │       │   ├── github-webhooks.ts
│   │       │   ├── api-confidence.ts
│   │       │   ├── api-provenance.ts
│   │       │   ├── api-budgets.ts
│   │       │   ├── api-leaderboard.ts
│   │       │   └── api-config.ts
│   │       ├── adapters/
│   │       │   ├── types.ts
│   │       │   └── github.ts
│   │       ├── engine/
│   │       │   ├── agent-detection.ts
│   │       │   ├── merge-confidence.ts
│   │       │   ├── provenance.ts
│   │       │   ├── budgets.ts
│   │       │   └── leaderboard.ts
│   │       ├── services/
│   │       │   ├── github-api.ts
│   │       │   ├── github-app.ts
│   │       │   └── artifacts-client.ts
│   │       ├── durable-objects/
│   │       │   └── repo-analyzer.ts
│   │       └── middleware/
│   │           ├── auth.ts
│   │           └── rate-limit.ts
│   │
│   └── site/                            # Marketing site (CF Pages)
│       ├── package.json
│       ├── wrangler.jsonc               # Pages config
│       ├── public/
│       │   ├── index.html               # Landing page
│       │   ├── pricing.html
│       │   ├── docs.html                # Docs landing (links to GitHub README)
│       │   ├── favicon.svg
│       │   ├── og-image.png
│       │   └── robots.txt
│       └── assets/
│           └── style.css                # Minimal custom styles beyond Tailwind
│
├── cli/                                 # `gg` CLI — OPEN SOURCE (Apache 2.0)
│   ├── package.json
│   ├── tsconfig.json
│   ├── LICENSE
│   └── src/
│       ├── index.ts
│       ├── commands/
│       │   ├── ci/
│       │   │   ├── compile.ts
│       │   │   ├── init.ts
│       │   │   ├── convert.ts
│       │   │   ├── validate.ts
│       │   │   ├── watch.ts
│       │   │   └── estimate.ts
│       │   └── gate/
│       │       ├── status.ts
│       │       ├── score.ts
│       │       └── provenance.ts
│       └── utils/
│           ├── config.ts
│           └── output.ts
│
└── docs/
    ├── ci-quickstart.md
    ├── governance-quickstart.md
    └── merge-confidence.md
```

---

## D1 Schema (Complete)

### Migration 0001_core.sql

```sql
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  github_org_id INTEGER NOT NULL UNIQUE,
  github_org_login TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  installation_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  github_repo_id INTEGER NOT NULL UNIQUE,
  github_full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  monitoring_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_repos_org ON repos(org_id);

CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  github_installation_id INTEGER NOT NULL UNIQUE,
  access_token TEXT,
  access_token_expires_at INTEGER,
  permissions TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_user_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE org_members (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (org_id, user_id)
);
```

### Migration 0002_governance.sql

```sql
CREATE TABLE agent_detections (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  detected_provider TEXT NOT NULL,
  confidence TEXT NOT NULL,
  signals TEXT NOT NULL,
  labeled INTEGER NOT NULL DEFAULT 0,
  commented INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(repo_id, pr_number)
);
CREATE INDEX idx_detections_repo ON agent_detections(repo_id, pr_number);

CREATE TABLE merge_confidence_scores (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  overall_score INTEGER NOT NULL,
  test_health INTEGER NOT NULL,
  scope_containment INTEGER NOT NULL,
  review_depth INTEGER NOT NULL,
  agent_trust INTEGER NOT NULL,
  size_discipline INTEGER NOT NULL,
  provenance_quality INTEGER NOT NULL,
  weights_snapshot TEXT NOT NULL,
  is_agent_authored INTEGER NOT NULL DEFAULT 0,
  github_check_run_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  computed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_scores_repo_pr ON merge_confidence_scores(repo_id, pr_number);

CREATE TABLE provenance_chains (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  agent_provider TEXT NOT NULL,
  artifacts_repo_name TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at INTEGER NOT NULL DEFAULT (unixepoch()),
  sealed_at INTEGER,
  UNIQUE(repo_id, pr_number)
);
CREATE INDEX idx_provenance_repo ON provenance_chains(repo_id, pr_number);

CREATE TABLE governance_config (
  scope_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  confidence_weights TEXT,
  confidence_minimum INTEGER,
  size_thresholds TEXT,
  scope_mappings TEXT,
  apply_to_human_prs INTEGER NOT NULL DEFAULT 1,
  detection_enabled INTEGER NOT NULL DEFAULT 1,
  detection_label_format TEXT DEFAULT 'agent:{provider}',
  detection_post_comment INTEGER NOT NULL DEFAULT 1,
  provenance_enabled INTEGER NOT NULL DEFAULT 1,
  exempt_bots TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### Migration 0003_budgets.sql

```sql
CREATE TABLE agent_identities (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  match_rules TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_agents_org ON agent_identities(org_id);

CREATE TABLE agent_activity_log (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_provider TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  pr_number INTEGER,
  activity_type TEXT NOT NULL,
  activity_units REAL NOT NULL,
  metadata TEXT,
  period_key TEXT NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_activity_org ON agent_activity_log(org_id, timestamp);
CREATE INDEX idx_activity_agent ON agent_activity_log(agent_provider, org_id, period_key);

CREATE TABLE agent_budgets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  period TEXT NOT NULL,
  limit_units REAL NOT NULL,
  cost_per_unit REAL,
  alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
  enforcement TEXT NOT NULL DEFAULT 'alert',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE agent_budget_usage (
  budget_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  units_consumed REAL NOT NULL DEFAULT 0,
  last_updated INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (budget_id, period_key)
);

CREATE TABLE agent_leaderboard_snapshots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_provider TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  prs_opened INTEGER NOT NULL DEFAULT 0,
  prs_merged INTEGER NOT NULL DEFAULT 0,
  merge_rate REAL,
  avg_merge_confidence REAL,
  avg_revision_cycles REAL,
  first_pass_merge_rate REAL,
  avg_time_to_merge INTEGER,
  ci_first_pass_rate REAL,
  activity_units REAL,
  efficiency_ratio REAL,
  computed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_leaderboard_org ON agent_leaderboard_snapshots(org_id, computed_at);
```

---

## Execution Plan

Work through tasks IN ORDER. Commit after every meaningful unit of work. Conventional commits: `feat(scope):`, `fix(scope):`, `test(scope):`, `chore:`, `docs:`.

---

### PHASE 1: Foundation (4 tasks)

**Task 1.1 — Bootstrap monorepo**

Create the full directory structure. Set up:

- `pnpm-workspace.yaml`: `packages/*`, `apps/*`, `cli`
- `turbo.json`: build, dev, test, lint, typecheck tasks with dependency ordering
- `tsconfig.base.json`: strict, ES2022, NodeNext, composite: true
- Root `package.json`: devDeps — `typescript@^5.8`, `vitest@^3`, `prettier`, `turbo@^2`
- `.gitignore`: node_modules, dist, .wrangler, .output, .env, .turbo
- `.prettierrc`: `{ "singleQuote": true, "semi": true, "trailingComma": "all" }`
- Empty `package.json` in each workspace with correct `name` and `version: "0.1.0"`
  - `@gitgate/ci` (public)
  - `@gitgate/shared` (private)
  - `@gitgate/db` (private)
  - `@gitgate/api` (private)
  - `@gitgate/site` (private)
  - `gg` (public, bin: `{ "gg": "./dist/index.js" }`)
- Run `pnpm install`

**Commit:** `init: bootstrap pnpm + turborepo monorepo`

**Task 1.2 — Shared types**

Build `packages/shared/src/`:

`types/providers.ts` — Provider adapter interface and normalized event types:

```typescript
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
  | { type: 'push'; data: PushEvent };

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
```

`types/governance.ts` — Merge Confidence, Provenance, config types:

```typescript
export interface MergeConfidenceScore {
  overall: number;
  testHealth: number;
  scopeContainment: number;
  reviewDepth: number;
  agentTrust: number;
  sizeDiscipline: number;
  provenanceQuality: number;
  weights: MergeConfidenceWeights;
  isAgentAuthored: boolean;
  version: number;
  computedAt: number;
}

export interface MergeConfidenceWeights {
  testHealth: number;
  scopeContainment: number;
  reviewDepth: number;
  agentTrust: number;
  sizeDiscipline: number;
  provenanceQuality: number;
}

export const DEFAULT_WEIGHTS: MergeConfidenceWeights = {
  testHealth: 25,
  scopeContainment: 20,
  reviewDepth: 20,
  agentTrust: 15,
  sizeDiscipline: 10,
  provenanceQuality: 10,
};

export interface ProvenanceEvent {
  type: string;
  actor: string;
  actorType: 'agent' | 'human' | 'system';
  data: Record<string, unknown>;
  timestamp: number;
}

export interface GovernanceConfig {
  confidenceWeights?: Partial<MergeConfidenceWeights>;
  confidenceMinimum?: number;
  sizeThresholds?: { excellent: number; good: number; acceptable: number };
  scopeMappings?: Record<string, string[]>;
  applyToHumanPrs?: boolean;
  detectionEnabled?: boolean;
  detectionLabelFormat?: string;
  detectionPostComment?: boolean;
  provenanceEnabled?: boolean;
  exemptBots?: string[];
}
```

`types/agents.ts` — Agent identity and budget types:

```typescript
export interface AgentIdentity {
  id: string;
  orgId: string;
  name: string;
  provider: string;
  matchRules: AgentMatchRules;
  status: 'active' | 'paused';
}

export interface AgentMatchRules {
  committerEmails?: string[];
  botUsernames?: string[];
  prBodyPatterns?: string[];
}

export interface AgentBudget {
  id: string;
  orgId: string;
  scopeType: 'org' | 'repo' | 'agent';
  scopeId: string;
  period: 'daily' | 'weekly' | 'monthly';
  limitUnits: number;
  costPerUnit?: number;
  alertThresholdPct: number;
  enforcement: 'alert' | 'comment' | 'block-check';
}

export interface LeaderboardEntry {
  agentProvider: string;
  prsOpened: number;
  prsMerged: number;
  mergeRate: number;
  avgMergeConfidence: number;
  avgRevisionCycles: number;
  firstPassMergeRate: number;
  avgTimeToMerge: number;
  ciFirstPassRate: number;
  activityUnits: number;
  efficiencyRatio: number;
}
```

`types/api.ts` — API envelope types:

```typescript
export interface ApiResponse<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string };
}

export interface PaginatedResponse<T> {
  ok: true;
  data: T[];
  pagination: { total: number; page: number; pageSize: number; hasMore: boolean };
}
```

`schemas/config.ts` — Zod schema for `.gitgate.yml`:

```typescript
import { z } from 'zod';

export const gitgateYmlSchema = z.object({
  version: z.literal(1),
  detection: z.object({
    enabled: z.boolean().default(true),
    label_format: z.string().default('agent:{provider}'),
    post_comment: z.boolean().default(true),
    exempt_bots: z.array(z.string()).default(['dependabot[bot]', 'renovate[bot]']),
    custom_agents: z.array(z.object({
      name: z.string(),
      match: z.object({
        committer_email: z.string().optional(),
        bot_username: z.string().optional(),
      }),
      treat_as: z.enum(['agent', 'bot']).default('agent'),
      provider: z.string().optional(),
    })).default([]),
  }).optional(),
  confidence: z.object({
    enabled: z.boolean().default(true),
    minimum_score: z.number().min(0).max(100).optional(),
    apply_to_human_prs: z.boolean().default(true),
    weights: z.object({
      test_health: z.number().optional(),
      scope_containment: z.number().optional(),
      review_depth: z.number().optional(),
      agent_trust: z.number().optional(),
      size_discipline: z.number().optional(),
      provenance_quality: z.number().optional(),
    }).optional(),
    size_thresholds: z.object({
      excellent: z.number().default(200),
      good: z.number().default(500),
      acceptable: z.number().default(1000),
    }).optional(),
    scope_mappings: z.record(z.array(z.string())).optional(),
  }).optional(),
  provenance: z.object({
    enabled: z.boolean().default(true),
    post_summary_comment: z.boolean().default(true),
  }).optional(),
  agents: z.record(z.object({
    confidence_minimum: z.number().min(0).max(100).optional(),
  })).optional(),
});

export type GitGateYml = z.infer<typeof gitgateYmlSchema>;
```

Export everything from `packages/shared/src/index.ts`.

**Commit:** `feat(shared): core types, provider adapter interface, Zod schemas`

**Task 1.3 — Database package**

Build `packages/db/`:

- Drizzle schema files matching all three SQL migrations
- `drizzle.config.ts` for D1
- `src/index.ts`: `createDB(d1: D1Database)` returns typed Drizzle instance
- Place all three `.sql` migration files in `migrations/`

**Commit:** `feat(db): D1 schema with Drizzle ORM`

**Task 1.4 — Seed data**

Build `packages/db/src/seed.ts`:

- 1 org (acme), 2 repos (acme/api, acme/web)
- 3 agent detections (2 claude, 1 cursor)
- 3 merge confidence scores (72, 85, 45)
- 1 provenance chain (open)
- 5 activity log entries
- 1 budget (monthly, org-wide)
- Governance config with default weights

**Commit:** `feat(db): seed data for development`

---

### PHASE 2: CI SDK — Open Source (12 tasks)

**Task 2.1 — Package scaffold**

Create `packages/ci/` with:

- `package.json`: name `@gitgate/ci`, version `0.1.0`, type `module`, exports map (`.`, `./presets`, `./agent`), zero runtime dependencies, devDeps: `vitest`, `typescript`
- `tsconfig.json`: extends base, strict, ES2022, NodeNext, outDir `dist/`
- `vitest.config.ts`
- `LICENSE`: Apache 2.0

**Commit:** `feat(ci): scaffold @gitgate/ci package`

**Task 2.2 — Core types**

Create `packages/ci/src/types.ts` with all CI type definitions: Pipeline, Job, Step, Trigger, TriggerEvent, TriggerConfig, WorkflowInput, RunnerSpec, UbicloudSize, MatrixConfig, ServiceContainer, Permissions, Concurrency, Defaults, JobEnvironment, ArtifactOptions, CacheConfig, GitGateConfig, UBICLOUD_PRICING constant, GITHUB_PRICING constant.

These types are fully specified in the repository structure section above. Copy the complete type definitions from the earlier CI SDK spec — they are the API contract.

**Commit:** `feat(ci): core type definitions`

**Task 2.3 — Builders**

Create all builder files. Each returns typed objects — no compilation happens here.

`builder/pipeline.ts`: `pipeline(name, config) → Pipeline`
`builder/job.ts`: `job(name, config) → Job` — normalize string environment to `{ name: string }`
`builder/step.ts`: `step.run()`, `step.checkout()`, `step.action()`, `step.uploadArtifact()`, `step.downloadArtifact()`, `step.cache()`
`builder/triggers.ts`: `triggers.push()`, `triggers.pullRequest()`, `triggers.workflowDispatch()`, `triggers.schedule()`, `triggers.release()`
`builder/runner.ts`: `Runner.ubicloud()`, `Runner.github()`, `Runner.selfHosted()`, `Runner.custom()`, `resolveRunner()` — maps RunnerSpec to `runs-on` YAML value

**Commit:** `feat(ci): pipeline, job, step, triggers, runner builders`

**Task 2.4 — Context helpers**

Create `builder/context.ts`:

- `secrets(name)` → `${{ secrets.NAME }}`
- `vars(name)` → `${{ vars.NAME }}`
- `github(path)` → `${{ github.path }}`
- `env(name)` → `${{ env.NAME }}`
- `needs(jobName, outputName)` → `${{ needs.job.outputs.output }}`
- `steps(stepId, outputName)` → `${{ steps.id.outputs.output }}`
- `expr(expression)` → `${{ expression }}`
- `hashFiles(...patterns)` → `${{ hashFiles('pattern') }}`

All validate inputs (throw on empty/whitespace). All documented with JSDoc including usage examples.

**Commit:** `feat(ci): secrets(), vars(), github(), env() context helpers`

**Task 2.5 — YAML compiler**

Create `compiler/yaml.ts` — Minimal YAML serializer. NO external library. ~100–150 lines. Rules:

- Strings containing `${{` → single-quoted
- Strings with special chars (`:`, `{`, `}`, `#`, `[`, `]`, `'`, `"`, `*`, `&`, `!`, `%`) → single-quoted
- Booleans → unquoted
- Numbers → unquoted
- Multiline strings (containing `\n`) → `|` block scalar
- null/undefined → omitted
- Empty objects/arrays → omitted
- Indentation: 2 spaces

Create `compiler/header.ts` — generates file header comment with source path and URL.

Create `compiler/compile.ts` — `compile(pipeline: Pipeline): string`
Transformation rules:

- `pipeline.name` → `name:`
- `pipeline.triggers` → `on:` — map event types. Schedule uses `[{ cron: ... }]` syntax.
- `pipeline.jobs` → `jobs:` — key = sanitized job name (lowercase, hyphens)
- `job.runner` → `runs-on:` via `resolveRunner()`
- `job.steps` → `steps:` — FLATTEN nested Step[] arrays from spread helpers
- `step.uses` → `uses:`, `step.run` → `run:`, `step.condition` → `if:`, `step.workingDirectory` → `working-directory:`, `step.continueOnError` → `continue-on-error:`

**Commit:** `feat(ci): YAML serializer and pipeline compiler`

**Task 2.6 — Presets**

Create preset files — each is a collection of functions returning Step or Step[]:

`presets/node.ts`: setup(version), install(frozen?), cache(), test(coverage?), build(), lint(), typecheck()
`presets/bun.ts`: setup(version?), install(frozen?), test(coverage?), build(), lint()
`presets/python.ts`: setup(version), install(), cache(), lint(tool), test(tool)
`presets/rust.ts`: setup(toolchain), cache(), check(), clippy(), test(), build(release?)
`presets/go.ts`: setup(version), cache(), test(), build()
`presets/docker.ts`: setupBuildx(), login(registry, username, password), buildPush(tags, context?, file?, push?)
`presets/index.ts`: re-exports all presets

Each preset uses the correct GitHub Action references (e.g., `actions/setup-node@v4`, `oven-sh/setup-bun@v2`, `dtolnay/rust-toolchain@stable`).

**Commit:** `feat(ci): language presets — node, bun, python, rust, go, docker`

**Task 2.7 — Agent extensions**

Create agent module:

`agent/conditions.ts`:

- `isAgentAuthored()` → returns `"contains(github.event.pull_request.labels.*.name, 'agent:')"` — a GitHub Actions `if:` expression checking for agent labels applied by GitGate
- `isProvider(provider)` → returns expression checking for specific `agent:{provider}` label

`agent/coverage.ts`:

- `coverageGate({ minCoverage, maxCoverageDecrease?, summaryPath? })` → Step with inline bash script that reads coverage-summary.json and fails if below threshold

`agent/matrix.ts`:

- `expandedMatrix({ nodeVersions?, pythonVersions?, command })` → Step[] that sequentially sets up each version and runs the command — unlike a matrix strategy which creates parallel jobs

`agent/provenance.ts`:

- `provenanceEvent(eventType, data)` → Step with inline curl to GitGate API (uses `secrets.GITGATE_TOKEN`, `continueOnError: true`)

`agent/index.ts`: re-exports all

**Commit:** `feat(ci): agent-aware extensions — detection, coverage, matrix, provenance`

**Task 2.8 — Converter (YAML → TypeScript)**

Create converter module:

`converter/parse.ts` — Parse GitHub Actions YAML into structured AST. Since this is a dev tool, use the `yaml` npm package as a devDependency. Parse the YAML into a plain JS object, then normalize.

`converter/runner-map.ts` — Maps GitHub runner labels to SDK calls:

```typescript
export const RUNNER_MAP: Record<string, string> = {
  'ubuntu-latest': "Runner.ubicloud('standard-4')",
  'ubuntu-22.04': "Runner.ubicloud('standard-4')",
  'ubuntu-24.04': "Runner.ubicloud('standard-4')",
  'macos-latest': "Runner.github('macos-latest')",
  'windows-latest': "Runner.github('windows-latest')",
};
```

`converter/transform.ts` — AST → TypeScript source string. Code generator that outputs valid `@gitgate/ci` TypeScript. Maps `uses: actions/checkout@v4` → `step.checkout()`, `uses: actions/setup-node@v4` → `node.setup()`, unknown actions → `step.action(...)`.

**Commit:** `feat(ci): YAML to TypeScript converter`

**Task 2.9 — Cost estimator**

Create `estimator/cost.ts`:

- `estimate({ pipeline, durations, runsPerMonth? })` → `CostEstimate`
- Calculates per-job and total cost using UBICLOUD_PRICING
- Generates GitHub comparison using equivalent runner tiers
- Returns savings percentage

**Commit:** `feat(ci): Ubicloud cost estimator`

**Task 2.10 — Public API surface**

Create `packages/ci/src/index.ts`:

```typescript
export { pipeline } from './builder/pipeline.js';
export { job } from './builder/job.js';
export { step } from './builder/step.js';
export { triggers } from './builder/triggers.js';
export { Runner } from './builder/runner.js';
export { secrets, vars, github, env, needs, steps, expr, hashFiles } from './builder/context.js';
export { compile } from './compiler/compile.js';
export { convert } from './converter/transform.js';
export { estimate } from './estimator/cost.js';
export type * from './types.js';
```

Package.json exports:

```json
{ "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/types/index.d.ts" },
    "./presets": { "import": "./dist/presets/index.js", "types": "./dist/types/presets/index.d.ts" },
    "./agent": { "import": "./dist/agent/index.js", "types": "./dist/types/agent/index.d.ts" }
}}
```

**Commit:** `feat(ci): public API exports`

**Task 2.11 — CLI commands**

Wire `gg ci` subcommands into `cli/src/`:

`ci/compile.ts`: Load `gitgate.config.ts` from project root → glob `.gitgate/pipelines/**/*.ts` → dynamically import each → call `compile()` → write to `.github/workflows/`
`ci/init.ts`: Detect project (bun.lockb → Bun, package-lock.json → Node, Cargo.toml → Rust, etc.) → scaffold `.gitgate/pipelines/ci.ts` + `gitgate.config.ts` → add `@gitgate/ci` to devDeps
`ci/convert.ts`: Read YAML file → parse → transform → write `.gitgate/pipelines/{name}.ts` → print conversion report
`ci/validate.ts`: Run compile dry-run → validate YAML structure
`ci/watch.ts`: Watch `.gitgate/pipelines/` with `fs.watch` → recompile on change
`ci/estimate.ts`: Compile → prompt for durations (or accept `--durations` JSON) → run estimator → print table

Use `commander` or `citty` for CLI framework. Register all commands. Entry point: `cli/src/index.ts`.

**Commit:** `feat(cli): gg ci compile, init, convert, validate, watch, estimate`

**Task 2.12 — Tests**

Write Vitest tests:

**Compiler snapshot tests** (highest priority):

- Define pipelines with the builder API
- Compile to YAML
- Compare against committed `.yml` snapshot files in `test/compiler/snapshots/`
- Cases: basic-ci, matrix-build, agent-aware, monorepo, deploy-cloudflare, full-featured

**Builder unit tests**: verify each function returns correct typed objects
**Context helper tests**: verify expression strings, validate error throwing on bad input
**Preset tests**: verify correct action references and `with` parameters
**Agent condition tests**: verify `if:` expression output
**Converter tests**: parse a real GitHub Actions YAML, convert, verify output is valid TypeScript

**Commit:** `test(ci): compiler snapshots, builder and preset unit tests`

---

### PHASE 3: Platform API — GitHub App + Governance (8 tasks)

**Task 3.1 — Hono app scaffold**

Create `apps/api/` with:

- `wrangler.jsonc` as specified in the Artifacts integration section above
- Hono app entry point with all route mounts and middleware
- Environment type with all bindings: `DB`, `CACHE`, `ARTIFACTS`, `REPO_ANALYZER`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
- Durable Object export: `RepoAnalyzer`

**Commit:** `feat(api): Hono app scaffold with routes and CF bindings`

**Task 3.2 — GitHub App services**

`services/github-app.ts`:

- JWT generation from App private key (use `jose` library — works on Workers)
- Installation access token management: cache in KV with TTL, refresh when < 5 min remaining
- `getInstallationToken(installationId)` → valid token string

`services/github-api.ts`:

- Typed fetch wrapper using installation tokens
- Methods: `getPRFiles()`, `getPRReviews()`, `getPRComments()`, `getCheckRuns()`, `createCheckRun()`, `updateCheckRun()`, `createComment()`, `addLabel()`, `createLabel()`
- Rate limit awareness: check `x-ratelimit-remaining`, retry with backoff

**Commit:** `feat(api): GitHub App JWT and REST API client`

**Task 3.3 — GitHub adapter**

`adapters/github.ts` implementing `GitProviderAdapter`:

- `parseWebhook()`: validate HMAC-SHA256, detect event type from `X-GitHub-Event` header, normalize to `GitEvent`
- All read methods delegate to GitHub API client
- All write methods delegate to GitHub API client
- Handle edge cases: PR from fork, deleted branches, missing permissions

**Commit:** `feat(api): GitHub provider adapter`

**Task 3.4 — Artifacts client**

`services/artifacts-client.ts`:

- `createProvenanceRepo(org, repo, pr)` → creates `prov-{org}-{repo}-{pr}` in `gitgate-data` namespace
- `getProvenanceRepo(org, repo, pr)` → returns repo handle or null
- `createExportToken(org, repo, pr, ttl)` → read-only token for compliance
- `createCIArtifactRepo(org, repo, runId)` → creates `ci-{org}-{repo}-{runId}`
- `createConfigRepo(org)` → creates `config-{org}`
- Uses the Artifacts Workers binding from `env.ARTIFACTS`

**Commit:** `feat(api): Cloudflare Artifacts client`

**Task 3.5 — Agent detection engine**

`engine/agent-detection.ts`:

Definitive signals (one = detected):

- Committer email `*+claude-code@users.noreply.github.com`
- Bot usernames: `devin-ai-integration[bot]`, `sweep-ai[bot]`
- PR body markers: `<!-- Generated by Claude Code -->`, `[cursor]`, Devin session URLs
- Registered agent identities from `agent_identities` table

Heuristic signals (combined):

- All commits within 2s spread
- Known commit message templates
- High additions-to-modifications ratio

Exempt bots: `dependabot[bot]`, `renovate[bot]`, `github-actions[bot]`, plus org config

Returns `{ detected: boolean, provider: string, confidence: 'high' | 'medium' | 'low', signals: string[] }`

On detection:

1. Insert into `agent_detections` (D1)
2. Call adapter: `addLabel()` with configured format
3. Call adapter: `postComment()` with detection summary + Merge Confidence pending link
4. Create provenance repo via ArtifactsClient
5. Record `trigger.pr_opened` provenance event

**Commit:** `feat(api): agent detection engine`

**Task 3.6 — Merge Confidence engine**

`engine/merge-confidence.ts`:

Six components, each 0–100, weighted average:

**Test Health (25%):**

```
No CI → 50 | Failed → 0 | Passed no coverage → 70
Passed + coverage delta ≥ 0 → 70 + min(30, delta × 10)
Passed + coverage delta < 0 → max(0, 70 + delta × 5)
```

**Scope Containment (20%):**

```
With issue + scope mappings: in_scope_files / total_files × 100
With issue, no mappings: 1 dir → 100, 2-3 → 80, 4-6 → 60, 7+ → max(20, 80 - dirs×5)
No issue: same brackets with 10-point penalty
```

**Review Depth (20%):**

```
No reviews → 0 | Approved no comments → 40
Approved with comments: 40 + min(60, comment_count × 5 + file_coverage × 30)
Changes requested: max(current - 20, 0)
```

**Agent Trust (15%):**

```
Not agent-authored → 100 | Agent < 5 PRs → 50
Agent with history: merge_rate × 40 + avg_review × 0.3 + ci_rate × 30
```

**Size Discipline (10%):**

```
≤200 lines → 100 | ≤500 → 80 | ≤1000 → 50
>1000 → max(0, 50 - (lines-1000) / 100)
```

**Provenance Quality (10%):**

```
Not agent → 100
Agent: has_trigger(25) + has_context(25) + has_iterations(25) + chain_valid(25)
```

Recomputes on: `pr.opened`, `pr.updated`, `check.completed`, `pr.review`

Posts GitHub Check Run: `gitgate/merge-confidence`

- Title: `Merge Confidence: {score}/100`
- Summary: component breakdown table
- Conclusion: `success` if ≥ minimum, `failure` if below, `neutral` if no minimum set
- Details URL: `https://gitgate.com/docs/merge-confidence`

**Commit:** `feat(api): merge confidence scoring engine`

**Task 3.7 — Webhook handler + event routing**

`routes/github-webhooks.ts`:

- POST handler
- HMAC-SHA256 validation using `GITHUB_WEBHOOK_SECRET`
- Route events to Durable Object per repo:
  - `pull_request.opened` → detect → score → provenance
  - `pull_request.synchronize` → rescore → provenance → budget
  - `pull_request_review.submitted` → rescore → provenance
  - `check_run.completed` → rescore → provenance
  - `pull_request.closed` → seal provenance → update leaderboard
  - `installation.created` → create org, repos
  - `installation.deleted` → deactivate org
- Dispatch via `env.REPO_ANALYZER.get(env.REPO_ANALYZER.idFromName(repoFullName))`

**Commit:** `feat(api): GitHub webhook handler with event routing`

**Task 3.8 — RepoAnalyzer Durable Object**

`durable-objects/repo-analyzer.ts`:

- One instance per monitored repo (keyed by `owner/repo`)
- In-memory state: latest scores per PR, provenance chain status, budget counters
- HTTP handler receives events from the webhook route
- Methods: `handlePROpened()`, `handlePRUpdated()`, `handleReviewSubmitted()`, `handleCheckCompleted()`, `handlePRClosed()`
- Each method orchestrates: detection → scoring → provenance → budget → write-back
- All D1 writes via the injected env
- All GitHub API writes via the GitHub adapter
- All Artifacts writes via ArtifactsClient
- Target: < 500ms per event processing

**Commit:** `feat(api): RepoAnalyzer Durable Object`

---

### PHASE 4: Marketing Site (3 tasks)

The marketing site is static HTML + Tailwind CSS v4 + Alpine.js. Deployed to Cloudflare Pages. No build step — just static files.

**Task 4.1 — Pages project scaffold**

Create `apps/site/`:

- `package.json`: name `@gitgate/site`, private
- `wrangler.jsonc`: Pages project config, `pages_build_output_dir: "public"`
- `public/robots.txt`, `public/favicon.svg` (simple "GG" monogram in SVG)

**Commit:** `chore(site): scaffold Cloudflare Pages project`

**Task 4.2 — Landing page**

Create `apps/site/public/index.html`:

Single-page marketing site. Clean, professional, developer-focused. NOT generic SaaS — this is a dev tool. The tone is direct, technical, confident.

**Tech:** Tailwind CSS v4 via CDN (`<script src="https://cdn.tailwindcss.com"></script>`), Alpine.js via CDN (`<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>`). No build step.

**Structure:**

1. **Nav** — Logo (text: "gitgate"), links: Features, CI SDK, Governance, Pricing, Docs (→ GitHub README), GitHub (→ repo). CTA: "Install GitHub App". Sticky, blur background on scroll (Alpine.js `x-data` for scroll state).

2. **Hero** — Headline: "CI in TypeScript. Agent governance for Git." Sub: "Write pipelines in TypeScript, not YAML. Know what your AI agents are shipping. Merge Confidence scores on every PR." Two CTAs: "npm install @gitgate/ci" (copy-to-clipboard with Alpine.js) and "Install GitHub App" (→ GitHub App install URL). Below: animated code comparison — TypeScript on left, generated YAML on right (use Alpine.js `x-show` tabs or side-by-side).

3. **TypeScript CI section** — "YAML is a dead language for CI/CD." Show the TypeScript pipeline code with syntax highlighting (use `<pre><code>` with manual span coloring — no Prism/Shiki dependency). Show the compiled YAML output. Emphasize: type safety, IDE autocomplete, shared functions, conditional logic, zero runtime dependency. Callout: "Defaults to Ubicloud runners — 10x cheaper than GitHub."

4. **Agent Governance section** — "Know what your AI is shipping." Three cards:
   
   - **Merge Confidence** — Score 0–100 on every PR, surfaced as a GitHub Check Run. Screenshot/mockup of a GitHub PR checks list showing `gitgate/merge-confidence — Score: 74/100`.
   - **Agent Detection** — Automatic labeling of agent-authored PRs. Shows `agent:claude`, `agent:cursor` labels.
   - **Provenance Chains** — Immutable audit trail stored as git repos on Cloudflare Artifacts. `git clone` your compliance export.

5. **How it works** — Three steps with numbers:
   
   1. `npm install -D @gitgate/ci` → write pipelines in TypeScript → `gg ci compile`
   2. Install the GitGate GitHub App → agent detection + Merge Confidence appear on PRs
   3. Review scores, provenance, agent leaderboards (link to docs)

6. **Pricing section** — Three tiers:
   
   - **Free**: 3 repos, agent detection, Merge Confidence (default weights), `@gitgate/ci` unlimited. CTA: "Install Free"
   - **Team ($8/repo/mo)**: unlimited repos, custom weights, provenance, budgets, leaderboards, 1yr retention. Volume: 11-50 repos $6, 51+ $4. CTA: "Start Team"
   - **Enterprise (Custom)**: multi-provider, SSO, SIEM export, unlimited retention, SLA. CTA: "Contact Us"

7. **Open Source section** — "Built in the open." Links to `@gitgate/ci` on npm, `gg` CLI on npm, `@gitgate/git` TypeScript git engine (separate repo). Apache 2.0. "The CI SDK is open source. The generated YAML has zero GitGate dependency. Eject any time."

8. **Footer** — GitGate by FlareFound. Links: GitHub, npm, Docs, Privacy, Terms. "Built entirely on Cloudflare."

**Design tokens:**

- Font: `Inter` via Google Fonts (or system font stack for speed)
- Colors: Dark background (#0a0a0a), white text, accent blue (#3b82f6) for CTAs, green (#22c55e) for scores, amber (#f59e0b) for warnings
- Code blocks: dark bg (#1e1e2e), monospace font, colored spans for syntax
- Spacing: generous, lots of breathing room
- No gradients, no excessive shadows, no stock photos. Clean, minimal, technical.

**Alpine.js interactivity:**

- Copy-to-clipboard on the install command
- Scroll-aware nav (add background on scroll)
- Tab switching in the code comparison (TypeScript / YAML)
- Pricing toggle if needed (monthly/annual — skip for v1)

**Commit:** `feat(site): landing page — hero, CI, governance, pricing, footer`

**Task 4.3 — Pricing page + docs landing**

`pricing.html` — Expanded pricing page with feature comparison table and FAQ (Can I use the CI SDK without the GitHub App? Yes. What happens if I stop paying? Free tier features remain. Is my audit data portable? Yes, it's git repos you can clone.)

`docs.html` — Simple page that redirects to the GitHub README for now. "Documentation lives in our GitHub repo." Links to: CI SDK quickstart, governance quickstart, API reference (future).

**Commit:** `feat(site): pricing page and docs landing`

---

### PHASE 5: CLI Platform Commands + Polish (4 tasks)

**Task 5.1 — CLI gate commands**

Build `cli/src/commands/gate/`:

- `gg gate status`: calls GitGate API → shows governance state for current repo (requires `gg auth login` first)
- `gg gate score <pr>`: calls API → shows Merge Confidence breakdown for a PR
- `gg gate provenance <pr>`: calls API → shows provenance events, offers clone URL

**Commit:** `feat(cli): gg gate status, score, provenance`

**Task 5.2 — .gitgate.yml support**

In the platform API: when a `push` webhook includes changes to `.gitgate.yml`, read and validate it against the Zod schema. Merge with dashboard config (YAML wins repo-level, dashboard wins org-level). Store in `governance_config`.

**Commit:** `feat(api): .gitgate.yml config file support`

**Task 5.3 — Leaderboard cron**

Add a scheduled handler to the API Worker:

```jsonc
// wrangler.jsonc
{ "triggers": { "crons": ["0 2 * * *"] } }
```

- Daily: query `agent_activity_log` + `merge_confidence_scores` for last 90 days
- Compute all leaderboard metrics per agent per org
- Write to `agent_leaderboard_snapshots`

**Commit:** `feat(api): daily leaderboard computation cron`

**Task 5.4 — README + docs**

- Root `README.md`: what GitGate is, OSS components, quick starts
- `packages/ci/README.md`: full CI SDK reference with examples
- `cli/README.md`: all `gg` commands
- `docs/ci-quickstart.md`: install → init → compile → commit
- `docs/governance-quickstart.md`: install GitHub App → see first score
- `docs/merge-confidence.md`: component breakdown, weight config, branch protection

**Commit:** `docs: README, quickstarts, reference docs`

---

## Post-MVP (track as issues)

- Dashboard (React SPA on Workers) — build when first 10 paying teams ask
- Budget `block-check` enforcement (report check failure when budget exhausted)
- MCP server (governance data as MCP tools for agent self-governance)
- GitLab adapter (MR webhooks + CI status)
- Artifacts adapter (event subscriptions when CF ships them)
- Runner resale margin model
- `gg ci diff` — detect manual YAML edits
- `gg ci graph` — visualize job dependencies
- GitHub Marketplace listing
- `gitgate/compile-action` — auto-compile on push to `.gitgate/`
- VS Code extension
- Artifacts-native mode (no GitHub, bring your own CF credentials)

---

## Constraints for Claude Code

1. **One repo, scratch build.** No code carried over. `git init` first.
2. **Commit after every task.** Each task = one or more conventional commits.
3. **No dashboard.** All governance UX surfaces in GitHub (check runs, comments, labels). Dashboard is post-traction.
4. **Zero CI SDK runtime deps.** The compiled YAML works standalone. `@gitgate/ci` is devDependencies only.
5. **No external YAML library in the CI SDK.** Write a minimal serializer. (The converter CAN use `yaml` as a devDep since it's a dev tool.)
6. **Snapshot tests for compiler output.** Every compiler test case has a committed YAML snapshot. If output changes, the test fails.
7. **Bun-first, Node 22+ compatible.** ESM with CJS fallback.
8. **Marketing site: zero build step.** Static HTML + Tailwind CDN + Alpine.js CDN. Deployed to CF Pages.
9. **Artifacts binding for governance data.** Provenance chains = git repos on Artifacts. D1 = index for fast queries.
10. **Provider adapter pattern.** GitHub adapter ships. Interface supports future GitLab/Artifacts/Bitbucket adapters.
