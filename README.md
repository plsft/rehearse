# Local-first runner for GitHub Actions

> **Stop pushing CI failures.** Run your `.github/workflows/*.yml` locally
> before you push. Same YAML, same outcome, in tens of seconds.

This repo is a working set of POCs validating the wedge:
**run an unmodified GitHub Actions workflow on a developer laptop, fast.**

It is not yet a shipping product. The work is being staged across three POCs
that together prove the speed and compatibility claims.

## Status

| | What | Result |
| --- | --- | --- |
| ✅ POC #1 | Localhost runner against our own CI | 16.86s end-to-end (3 jobs, 16 steps) |
| ✅ POC #2 | Compatibility audit of real OSS workflows | hono 94.4%, vite 96.2% of steps executable |
| ✅ POC #2b | Real run of `honojs/hono` `bun` job | 9.27s warm vs ~120s on GitHub (~13×) |
| ✅ POC #3 | Container backend with `services: postgres` | 20.12s warm vs ~75s on GitHub (~3.75×) |
| 🟡 next | Matrix expansion, parallel job scheduler | — |
| 🟡 next | Real runner package (replace POCs) | — |
| 🟡 next | Pre-commit / pre-push hook integration | — |

See [`poc/RESULTS.md`](poc/RESULTS.md) for the speed numbers and methodology.

## Repo layout

```
ts-ci/         — TypeScript SDK that parses + compiles GitHub Actions YAML
                 (Apache 2.0, npm: @gitgate/ci)
git-engine/    — Pure-TypeScript git protocol implementation
                 (Apache 2.0, npm: @gitgate/git-core)
cli/           — `gg` CLI: compile/init/convert/validate/watch/estimate
poc/           — Single-file proofs (this is the active surface)
  run-workflow.ts   — POC #1: localhost backend
  2-compat.ts       — POC #2: compatibility analyzer
  3-container.ts    — POC #3: Docker container backend with services
  fixtures/         — real workflows from hono, vite, plus our own
  RESULTS.md        — numbers + methodology
old/           — pre-pivot code kept for reference; not in workspace
.gitgate/      — TypeScript source for this repo's own CI
.github/       — generated workflow YAML (do not edit by hand)
```

## Run the POCs

```bash
pnpm install

# POC #1 — run our own CI on the host
pnpm tsx poc/run-workflow.ts .github/workflows/ci.yml

# POC #2 — audit any workflow's compatibility
pnpm tsx poc/2-compat.ts poc/fixtures/hono-ci.yml

# POC #2b — run a real OSS workflow
git clone --depth 1 https://github.com/honojs/hono.git poc/playground/hono
pnpm tsx poc/run-workflow.ts poc/playground/hono/.github/workflows/ci.yml bun

# POC #3 — container backend with postgres (requires Docker running)
pnpm tsx poc/3-container.ts poc/fixtures/service-postgres.yml
```

## Speed claim, honestly

The wedge is real but the numbers depend on cache state. The defensible
public claim today is:

- **5–13× faster on the warm pre-push loop** — developer's `node_modules`
  already on disk; we skip VM boot, queue, and fresh install
- **~3–4× faster for jobs that need containers** (postgres, redis), once
  images are pulled
- **~1.5× faster vs cold-cache CI**, because a fresh `pnpm install` /
  `bun install` is the dominant cost on both ends

The win is the dev pre-push loop, not replacing CI runners.

## What's open source

`ts-ci` and `git-engine` are Apache 2.0 and publishable to npm as
`@gitgate/ci` and `@gitgate/git-core`. See [`LICENSING.md`](LICENSING.md).
The runner itself, when it ships as a standalone package, will also be
Apache 2.0.

## Naming

The product doesn't have a name yet. Don't ship one until the runner is
measurably faster than `act` on three real workflows including one with
containers.
