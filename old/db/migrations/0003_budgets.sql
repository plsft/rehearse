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
