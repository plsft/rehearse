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
