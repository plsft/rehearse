# Contributing to GitGate

Thanks for taking the time to contribute. This guide covers the **three open-source
packages** in this repo:

- [`@gitgate/ci`](packages/ci) — TypeScript CI SDK
- [`@gitgate/git-core`](packages/git-core) — pure-TypeScript git protocol
- [`gg`](cli) — CLI

The proprietary platform code (`apps/api`, `apps/site`, `packages/db`,
`packages/shared`) is not open to external contributions. See
[LICENSING.md](LICENSING.md) for the split.

## Development setup

```bash
# Requires Node 22+ and pnpm 9+
pnpm install
pnpm turbo typecheck
pnpm turbo test
```

To work on a single package:

```bash
pnpm --filter @gitgate/ci test
pnpm --filter @gitgate/git-core test
pnpm --filter gg dev -- ci compile  # run the CLI from source
```

## Project layout

```
packages/
├── ci/         # @gitgate/ci — public SDK
├── git-core/   # @gitgate/git-core — public git engine
├── shared/     # internal types (proprietary)
└── db/         # D1 schema (proprietary)

apps/
├── api/        # platform Worker (proprietary)
└── site/       # marketing site (proprietary)

cli/            # gg CLI — public
```

## What we look for in a PR

1. **Tests.** Every public-API change has a matching test. The CI compiler has
   snapshot tests in `packages/ci/test/compiler/snapshots/` — if your change
   updates the YAML output, delete the affected snapshot and rerun
   `pnpm --filter @gitgate/ci test` to regenerate; commit both.
2. **Typecheck clean.** `pnpm turbo typecheck` must pass.
3. **No new runtime deps in `@gitgate/ci`.** The compiled YAML must work
   without GitGate at runtime — that means the SDK itself can't drag in
   anything beyond TypeScript. Dev-only deps are fine.
4. **No native deps in `@gitgate/git-core`.** It runs on Cloudflare Workers,
   the browser, and every JS runtime. `pako` is the only allowed runtime dep.
5. **Conventional commits.** `feat(scope):`, `fix(scope):`, `test(scope):`,
   `docs:`, `chore:`. The `scope` is the package or app being touched (`ci`,
   `git-core`, `cli`).

## Reporting issues

- **Bug reports** — minimal repro plus your Node / pnpm / OS versions.
- **CI YAML output drift** — please paste the diff between expected and actual.
- **Security** — please email <security@gitgate.com> rather than opening a
  public issue.

## Licensing of contributions

By submitting a pull request you agree that your contribution is licensed under
the Apache 2.0 License of the package you're contributing to. We don't use a CLA.

## Code of conduct

Be kind. Be specific. Assume good faith. We follow the spirit of the
[Contributor Covenant](https://www.contributor-covenant.org/).
