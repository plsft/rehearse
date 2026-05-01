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
