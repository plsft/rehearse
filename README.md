# GitGate

**CI in TypeScript. Agent governance for Git.**

GitGate is two products in one monorepo:

1. **`@gitgate/ci`** (Apache 2.0) — A TypeScript SDK that compiles GitHub Actions
   pipelines from typed code. Type safety, IDE autocomplete, shared functions,
   agent-aware extensions. Defaults to Ubicloud runners (~10× cheaper than
   GitHub-hosted). The output is plain YAML with zero runtime dependency on
   GitGate — eject any time.
2. **GitGate Platform** (closed source) — A GitHub App that detects
   agent-authored PRs, computes a Merge Confidence score (0–100) reported as a
   GitHub Check Run, and stores immutable provenance chains as git repos on
   Cloudflare Artifacts. No dashboard at launch — every governance surface
   lives in the GitHub PR UI.

## Repository layout

```
packages/
  ci/         — @gitgate/ci, the public SDK (Apache 2.0)
  git-core/   — @gitgate/git-core, pure-TypeScript git protocol (Apache 2.0)
  shared/     — shared TypeScript types and Zod schemas
  db/         — Drizzle schema + D1 migrations
apps/
  api/        — Cloudflare Worker (Hono) hosting the Platform API
  site/       — gitgate.com marketing site (Vite + Tailwind v4 + Alpine)
cli/          — `gg`, the CLI (Apache 2.0)
docs/         — Markdown reference docs
```

## Quickstarts

- **CI SDK** — [docs/ci-quickstart.md](docs/ci-quickstart.md)
- **Governance** — [docs/governance-quickstart.md](docs/governance-quickstart.md)
- **Merge Confidence** — [docs/merge-confidence.md](docs/merge-confidence.md)

## Local development

```bash
pnpm install
pnpm turbo build
pnpm turbo test
pnpm turbo typecheck
```

The CI SDK has snapshot tests in `packages/ci/test/compiler/snapshots/`; if
your change updates the YAML output, the snapshots fail until you delete them
and re-run the suite.

## Open source components

- [`@gitgate/ci`](packages/ci) — pipeline DSL, compiler, presets, converter
- [`gg`](cli) — CLI for `compile`, `init`, `convert`, `validate`, `watch`,
  `estimate`, plus `gate status|score|provenance` for the platform

The platform code in `apps/api` is source-available for transparency, but the
hosted service is the licensed product. See `LICENSE` files for details.

## License

`@gitgate/ci` and `gg`: Apache 2.0. The platform: source-available.
