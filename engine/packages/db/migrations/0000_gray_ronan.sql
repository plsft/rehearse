CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream',
	`expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `branch_protection_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`branch_pattern` text NOT NULL,
	`require_pull_request` integer DEFAULT 0 NOT NULL,
	`required_approvals` integer DEFAULT 0 NOT NULL,
	`require_status_checks` integer DEFAULT 0 NOT NULL,
	`required_status_checks` text DEFAULT '[]' NOT NULL,
	`require_linear_history` integer DEFAULT 0 NOT NULL,
	`allow_force_push` integer DEFAULT 0 NOT NULL,
	`allow_deletion` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_bp_repo` ON `branch_protection_rules` (`repo_id`);--> statement-breakpoint
CREATE TABLE `check_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`sha` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`conclusion` text,
	`details_url` text,
	`output_title` text,
	`output_summary` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_checks_sha` ON `check_runs` (`repo_id`,`sha`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`commentable_type` text NOT NULL,
	`commentable_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_comments_target` ON `comments` (`commentable_type`,`commentable_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `commits` (
	`repo_id` text NOT NULL,
	`sha` text NOT NULL,
	`tree_sha` text NOT NULL,
	`parent_shas` text DEFAULT '[]' NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`author_date` text NOT NULL,
	`committer_name` text NOT NULL,
	`committer_email` text NOT NULL,
	`committer_date` text NOT NULL,
	`message` text NOT NULL,
	`gpg_signature` text,
	PRIMARY KEY(`repo_id`, `sha`),
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_commits_date` ON `commits` (`repo_id`,`committer_date`);--> statement-breakpoint
CREATE INDEX `idx_commits_author` ON `commits` (`repo_id`,`author_email`);--> statement-breakpoint
CREATE TABLE `git_objects` (
	`repo_id` text NOT NULL,
	`sha` text NOT NULL,
	`object_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`repo_id`, `sha`),
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_git_objects_type` ON `git_objects` (`repo_id`,`object_type`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '',
	`state` text DEFAULT 'open' NOT NULL,
	`author_id` text NOT NULL,
	`assignee_id` text,
	`milestone_id` text,
	`is_locked` integer DEFAULT 0 NOT NULL,
	`lock_reason` text,
	`closed_at` text,
	`closed_by_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_issues_repo_number` ON `issues` (`repo_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_issues_repo_state` ON `issues` (`repo_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_issues_author` ON `issues` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_issues_assignee` ON `issues` (`assignee_id`);--> statement-breakpoint
CREATE TABLE `label_assignments` (
	`label_id` text NOT NULL,
	`labelable_type` text NOT NULL,
	`labelable_id` text NOT NULL,
	PRIMARY KEY(`label_id`, `labelable_type`, `labelable_id`),
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '0366d6' NOT NULL,
	`description` text DEFAULT '',
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_labels_repo_name` ON `labels` (`repo_id`,`name`);--> statement-breakpoint
CREATE TABLE `merge_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`pull_request_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '',
	`state` text DEFAULT 'open' NOT NULL,
	`due_date` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_milestones_repo_title` ON `milestones` (`repo_id`,`title`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`title` text NOT NULL,
	`is_read` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user` ON `notifications` (`user_id`,`is_read`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_provider_user` ON `oauth_connections` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE TABLE `org_members` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_slug_unique` ON `orgs` (`slug`);--> statement-breakpoint
CREATE TABLE `personal_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pat_user` ON `personal_access_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_pat_prefix` ON `personal_access_tokens` (`token_prefix`);--> statement-breakpoint
CREATE TABLE `pr_review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_request_id` text NOT NULL,
	`review_id` text,
	`author_id` text NOT NULL,
	`path` text NOT NULL,
	`diff_hunk` text NOT NULL,
	`line` integer,
	`side` text,
	`body` text NOT NULL,
	`in_reply_to_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_id`) REFERENCES `pr_reviews`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_review_comments_pr` ON `pr_review_comments` (`pull_request_id`);--> statement-breakpoint
CREATE TABLE `pr_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_request_id` text NOT NULL,
	`author_id` text NOT NULL,
	`state` text NOT NULL,
	`body` text DEFAULT '',
	`submitted_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_pr` ON `pr_reviews` (`pull_request_id`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '',
	`state` text DEFAULT 'open' NOT NULL,
	`author_id` text NOT NULL,
	`head_ref` text NOT NULL,
	`head_sha` text NOT NULL,
	`base_ref` text NOT NULL,
	`base_sha` text NOT NULL,
	`merge_commit_sha` text,
	`merged_by_id` text,
	`merged_at` text,
	`is_draft` integer DEFAULT 0 NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`changed_files` integer DEFAULT 0 NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merged_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_prs_repo_number` ON `pull_requests` (`repo_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_prs_repo_state` ON `pull_requests` (`repo_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_prs_author` ON `pull_requests` (`author_id`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reactable_type` text NOT NULL,
	`reactable_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reactions_unique` ON `reactions` (`user_id`,`reactable_type`,`reactable_id`,`content`);--> statement-breakpoint
CREATE TABLE `refs` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`name` text NOT NULL,
	`sha` text NOT NULL,
	`ref_type` text NOT NULL,
	`is_protected` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_refs_repo_name` ON `refs` (`repo_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_refs_repo` ON `refs` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_refs_repo_type` ON `refs` (`repo_id`,`ref_type`);--> statement-breakpoint
CREATE TABLE `repo_collaborators` (
	`repo_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission` text DEFAULT 'read' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`repo_id`, `user_id`),
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repo_counters` (
	`repo_id` text PRIMARY KEY NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repo_subscriptions` (
	`repo_id` text NOT NULL,
	`user_id` text NOT NULL,
	`level` text DEFAULT 'participating' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`repo_id`, `user_id`),
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`default_branch` text DEFAULT 'main' NOT NULL,
	`is_private` integer DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT 0 NOT NULL,
	`is_fork` integer DEFAULT 0 NOT NULL,
	`forked_from_id` text,
	`star_count` integer DEFAULT 0 NOT NULL,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`open_issue_count` integer DEFAULT 0 NOT NULL,
	`open_pr_count` integer DEFAULT 0 NOT NULL,
	`disk_usage_bytes` integer DEFAULT 0 NOT NULL,
	`pushed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_repos_owner` ON `repos` (`owner_id`,`owner_type`);--> statement-breakpoint
CREATE INDEX `idx_repos_pushed` ON `repos` (`pushed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_repos_owner_name` ON `repos` (`owner_id`,`name`);--> statement-breakpoint
CREATE TABLE `search_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`path` text,
	`content_hash` text NOT NULL,
	`vectorize_id` text,
	`indexed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_search_repo` ON `search_documents` (`repo_id`,`doc_type`);--> statement-breakpoint
CREATE TABLE `ssh_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`public_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ssh_keys_user` ON `ssh_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_keys_fingerprint` ON `ssh_keys` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `stars` (
	`user_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `repo_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stars_repo` ON `stars` (`repo_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `timeline_events` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`payload` text DEFAULT '{}',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_timeline_target` ON `timeline_events` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`avatar_url` text,
	`bio` text,
	`passkey_credential_id` text,
	`passkey_public_key` blob,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`response_code` integer,
	`response_body` text,
	`duration_ms` integer,
	`delivered_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_deliveries_webhook` ON `webhook_deliveries` (`webhook_id`,`delivered_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text,
	`events` text DEFAULT '["push"]' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`last_delivery_at` text,
	`last_response_code` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`conclusion` text,
	`runner_name` text,
	`container_id` text,
	`logs_r2_key` text,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_run` ON `workflow_jobs` (`run_id`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`trigger_event` text NOT NULL,
	`trigger_ref` text NOT NULL,
	`trigger_sha` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`conclusion` text,
	`actor_id` text NOT NULL,
	`run_number` integer NOT NULL,
	`logs_r2_key` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_runs_workflow` ON `workflow_runs` (`workflow_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_repo` ON `workflow_runs` (`repo_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_status` ON `workflow_runs` (`repo_id`,`status`);--> statement-breakpoint
CREATE TABLE `workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`name` text NOT NULL,
	`step_number` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`conclusion` text,
	`logs_r2_key` text,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `workflow_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`name` text NOT NULL,
	`file_path` text NOT NULL,
	`trigger_events` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflows_repo_path` ON `workflows` (`repo_id`,`file_path`);