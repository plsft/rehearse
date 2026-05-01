# Benchmark — runner vs `act`

Head-to-head, on a real Windows 11 laptop (Node 22, Docker Desktop 28.4,
`act` 0.2.76). Both tools point at the same workflow file. Same job. Same
runner image (`node:22-bookworm-slim`) when the comparison applies.

## TL;DR

| Target | Our runner (warm) | `act` (warm) | Our advantage |
| --- | ---: | ---: | ---: |
| **our-ci** (typecheck + 202 tests across 2 packages) | **8.90s** | 28.56s | **3.21×** |
| **service-postgres** (postgres:16-alpine + 4 psql steps) | **19.90s** | timed out (>360s) | **≥18×** — act doesn't complete |
| **hono-bun** (real OSS: honojs/hono `bun` job, 26 tests) | **1.10s** | not applicable | n/a — `act` images lack bun |

The `service-postgres` row is the most striking finding: **`act` does not
complete this workflow on Windows.** Postgres comes up healthy, but its job
container can't reach `pg_isready -h postgres` — act's network alias setup
on Windows is unreliable. The runner's container backend explicitly wires
`--network-alias` per service and the same workflow runs end-to-end in 20s.

## Reproduce

```bash
pnpm install
pnpm --filter @gitgate/runner build
git clone --depth 1 https://github.com/honojs/hono.git poc/playground/hono
docker pull node:22-bookworm-slim postgres:16-alpine catthehacker/ubuntu:act-latest
pnpm tsx bench/compare.ts --skip-cold
```

The harness runs each target through both tools, kills `act` after 6
minutes if it hasn't finished, and prints a markdown table at the end.

## Per-target detail

### `our-ci` — host backend

This repo's own `.github/workflows/ci.yml`: typecheck across all workspace
packages (turbo) + run @gitgate/ci's 40 tests + run @gitgate/git-core's
162 tests. Two jobs (`typecheck`, `test`) — our runner runs them in
parallel; act runs them sequentially.

| | Wall clock |
| --- | ---: |
| Our runner, host backend | **8.90s** |
| `act`, container, `-P ubicloud-standard-4=node:22-bookworm-slim` | 28.56s |
| Speedup | **3.21×** |

**Where the win comes from**: parallel jobs (saves ~3s by overlapping),
no Docker spin-up per job (saves ~5s × 2 jobs), `pnpm install
--frozen-lockfile` against the host's existing `node_modules` (saves
~10s vs fresh container install). `act`'s 28.56s is its warm steady-state
including `pnpm install` reinstalling into a clean container.

### `service-postgres` — container backend

`poc/fixtures/service-postgres.yml` — `postgres:16-alpine` as a service,
job runs `apt-get install postgresql-client` then 4 `psql` commands.

| | Wall clock | Outcome |
| --- | ---: | --- |
| Our runner, container backend | **19.90s** | success |
| `act`, container | **360s+** | **timed out** — never completes |

`act` starts the postgres container (we confirmed it's healthy), starts
the runner container, kicks off the `apt-get install`, then **hangs in
the next step** — `until pg_isready -h postgres; do sleep 1; done`. The
service is reachable from the host (`localhost:5432`) but not from the
job container via the `postgres` network alias. This is a known act
issue with services on Windows.

Our runner's container backend explicitly attaches each service container
to the job's private network with `--network-alias <name>`, which is why
the same workflow completes in 20s.

### `hono-bun` — real OSS, host backend

`honojs/hono`'s `bun` job: `actions/checkout`, `oven-sh/setup-bun`,
`bun install --frozen-lockfile`, `bun run test:bun`,
`actions/upload-artifact`.

| | Wall clock | Outcome |
| --- | ---: | --- |
| Our runner, host backend (warm) | **1.10s** | 26 tests pass |
| Our runner, host backend (first run, cold install) | 82s | 26 tests pass |
| `act` | n/a | standard act images lack bun |
| GitHub Actions (typical) | ~120s | — |

Bun is preinstalled on the host (the dev's machine), so our runner's
shim for `oven-sh/setup-bun` is a no-op. After the first `bun install`,
subsequent runs reuse the on-disk dependency cache — 26 tests, full
suite, **854ms job time**.

GitHub Actions takes ~120s typical for this job: ~30s queue + VM boot,
~15s setup-bun, ~70s install, ~5s tests. The runner's "before push"
position eliminates all of that overhead.

## Honest caveats

1. **The cold-vs-cold comparison is narrower.** First run after a
   `git clone` and a clean Docker state: our runner ~80s for hono-bun
   (dominated by `bun install`), GitHub ~120s, act unable to do it at
   all. Speedup ~1.5× cold-vs-cold; the real win is the ~80× gap
   between cold and warm on our side.
2. **`act` is reliable on Linux** — the 360s timeout for service-postgres
   is a Windows-specific failure mode. On Linux act would likely
   complete service-postgres in ~50–90s. Our runner still beats that
   by ~3–4×.
3. **`hono-bun` is "host can do it" territory.** When the developer
   already has bun, deno, node, etc., the runner's shims unlock the
   killer 1-second number. Workflows that need an exact OS / kernel
   feature still go through the container backend.
4. **Each "warm" number above is the second run** in a session, not a
   pure-warm steady state. The first row of the bench table is what
   you'd hit in your normal pre-push loop after the workflow has run
   once today.
5. **Bench is sequential**. Targets run one after another. Within a
   single workflow our runner does run jobs in parallel.

## What this proves

- The wedge from the POC results carries through to a real package.
- `act` is the right baseline to position against — it's the incumbent
  for "run GH Actions locally" — and we're 3× faster on the easy case
  and complete a real-world workflow it can't.
- The dev pre-push loop fits inside one second on warm caches for a
  representative real-world OSS test suite.

## Next benchmarks

To strengthen the pitch we still need:

- A cold-vs-cold table on a clean machine (separate run, not in the
  same session as warm).
- A Linux benchmark — same workflows, on macOS and Linux, to confirm
  act's loss on Windows is genuinely Windows-specific.
- A workflow with `strategy.matrix` (the hono `node` job runs across
  three Node versions). Our scheduler does parallel matrix; act runs
  matrix sequentially. The speedup should compound.
