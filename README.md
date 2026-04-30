# GitGate

**CI in TypeScript. Agent governance for Git.**

GitGate is a monorepo with a mix of **Apache 2.0 open-source packages** (published
to npm) and a **source-available platform** (hosted at `gitgate.com`). See
[LICENSING.md](LICENSING.md) for the boundary.

---

## Open source

Three packages, all Apache 2.0, all on npm, all with zero runtime dependency on
the hosted platform. Use them standalone or alongside the GitHub App.

| Package | What it does | Install |
| --- | --- | --- |
| [`@gitgate/ci`](packages/ci) | Compile TypeScript pipelines to GitHub Actions YAML. Type-safe builders, presets for Node/Bun/Python/Rust/Go/Docker, agent-aware extensions. | `npm i -D @gitgate/ci` |
| [`@gitgate/git-core`](packages/git-core) | Pure-TypeScript git protocol: objects, packfiles, smart-HTTP, diff, three-way merge. Runs on Workers / Node / Bun / Deno / browser. | `npm i @gitgate/git-core` |
| [`gg`](cli) | CLI for compiling pipelines, converting YAML → TypeScript, estimating cost, and inspecting agent governance. | `npm i -D gg` |

```bash
# Five-second tour
npx gg ci init                # scaffold .gitgate/pipelines/ci.ts
npx gg ci compile             # → .github/workflows/ci.yml
npx gg ci convert old.yml     # YAML → TypeScript
```

## The hosted platform

A GitHub App that detects agent-authored PRs, computes a Merge Confidence
score (0–100) reported as a GitHub Check Run, and stores immutable provenance
chains as git repos on Cloudflare Artifacts. No dashboard at launch — every
governance surface lives in the GitHub PR UI.

Install at <https://github.com/apps/gitgate>. The platform is source-available
under [`apps/api`](apps/api) for transparency but is **not licensed for
self-hosting**.

---

## Repository layout

```
packages/
  ci/         — @gitgate/ci, the public SDK             (Apache 2.0, public)
  git-core/   — @gitgate/git-core, pure-TS git protocol (Apache 2.0, public)
  shared/     — shared types and Zod schemas            (source-available)
  db/         — Drizzle schema + D1 migrations          (source-available)
apps/
  api/        — Hono Worker hosting the Platform API    (source-available)
  site/       — gitgate.com (Vite + Tailwind v4 + Alpine, source-available)
cli/          — gg, the CLI                              (Apache 2.0, public)
docs/         — Markdown reference docs
```

---

## Quickstarts

- **CI SDK** — [docs/ci-quickstart.md](docs/ci-quickstart.md)
- **Governance** — [docs/governance-quickstart.md](docs/governance-quickstart.md)
- **Merge Confidence reference** — [docs/merge-confidence.md](docs/merge-confidence.md)

## Local development

```bash
pnpm install
pnpm turbo build
pnpm turbo test
pnpm turbo typecheck
```

The CI SDK compiler has snapshot tests in `packages/ci/test/compiler/snapshots/`
that fail when the YAML output changes — review the diff and commit the
updated snapshot.

## Contributing

External contributions are welcome on the OSS packages. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

- `packages/ci`, `packages/git-core`, `cli`: **Apache 2.0**.
- Everything else: **source-available, proprietary**. See
  [LICENSING.md](LICENSING.md).
