# cloudflare-git

**A complete git hosting platform built from scratch in TypeScript on Cloudflare.**

This is the open-source git engine that powers [GitGate](https://gitgate.com). It implements the full git protocol (smart HTTP + SSH), Durable Object per-repo storage, D1 schemas, R2 object storage, Git LFS, GitHub import/migration, and a modern web frontend — all running on Cloudflare's edge with zero egress fees.

## What's Inside

- **`packages/git-core`** — Pure TypeScript git protocol implementation: pack files, objects, refs, diffs, merges
- **`packages/db`** — Drizzle ORM schemas for D1: users, repos, orgs, PRs, issues, CI, branch protection
- **`packages/shared`** — Shared types, validators (Zod), error classes, constants
- **`packages/ui`** — React component library
- **`apps/api`** — Hono API on Cloudflare Workers: git protocol routes, REST API, Durable Objects
- **`apps/web`** — Web frontend (React + vinext on Cloudflare Pages)
- **`apps/cli`** — CLI tool (`gg` command)
- **`apps/ssh-gateway`** — SSH-to-HTTP proxy (Fly.io)
- **`apps/admin`** — Admin dashboard (Cloudflare Worker)
- **`workers/ci-runner`** — CI workflow executor
- **`workers/queue-consumer`** — Async job queue handler

## License

Apache 2.0 — see [LICENSE](./LICENSE).

## Built By

[FlareFound](https://flarefound.com) / [Plurral Consulting](https://plurral.com)
