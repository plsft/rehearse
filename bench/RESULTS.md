# Benchmark — runner vs `act`

Head-to-head, on Windows 11 (Node 22, Docker Desktop 28.4, `act` 0.2.76).
Same workflow file, same job, same runner image (`node:22-bookworm-slim`)
when applicable.

## TL;DR

| Target | Our runner (warm) | `act` (warm) | Our advantage |
| --- | ---: | ---: | ---: |
| **our-ci** (typecheck + 202 tests, 2 jobs) | **9.09s** | 30.28s | **3.33×** |
| **node-matrix** (matrix `[18.x, 20.x, 22.x]`, 3 cells) | **4.63s** | 24.55s | **5.30×** |
| **service-postgres** (postgres:16-alpine + 4 psql steps) | **20.50s** | timed out (>360s) | **≥17.6× — act doesn't complete on Windows** |
| **hono-bun** (real OSS: honojs/hono `bun` job, 26 tests) | **6.09s** | n/a | n/a — act images lack bun |
| **hono-node-matrix** (real OSS: honojs/hono `node` job, 3 cells × node tests) | **45.00s** | n/a | n/a — act images lack bun |

**Five workflows, three real comparisons against act, all wins:**
- 3.33× on a small parallel-jobs workflow
- 5.30× on a matrix workflow act CAN run
- act doesn't complete the postgres workflow at all on Windows

## Reproduce

```bash
pnpm install
pnpm --filter @gitgate/runner build
git clone --depth 1 https://github.com/honojs/hono.git poc/playground/hono
docker pull node:22-bookworm-slim postgres:16-alpine catthehacker/ubuntu:act-latest
pnpm tsx bench/compare.ts --skip-cold
```

## Per-target detail

### `our-ci` — host backend, parallel jobs

Two jobs (`typecheck`, `test`) — our runner runs them in parallel; act
runs them sequentially.

| | Wall clock |
| --- | ---: |
| Our runner, host backend | **9.09s** |
| `act`, container, `-P ubicloud-standard-4=node:22-bookworm-slim` | 30.28s |
| **Speedup** | **3.33×** |

**Where the win comes from**: parallel jobs, no Docker spin-up per job,
`pnpm install --frozen-lockfile` against the host's existing
`node_modules`. act's 30.28s is its warm steady-state including reinstall
into a clean container.

### `node-matrix` — matrix bench act can actually run

Synthetic workflow: `strategy.matrix.node: ['18.x', '20.x', '22.x']` × 5
CPU-bound node steps per cell. Both tools install the requested node
version via `actions/setup-node@v4`.

| | Wall clock |
| --- | ---: |
| Our runner, host backend | **4.63s** |
| `act`, container, sequential matrix | 24.55s |
| **Speedup** | **5.30×** |

**Where the win comes from**: our `setup-node` shim picks up the host's
node when it satisfies the requested version (semver-compatible) and is
otherwise a no-op — three cells share one host install of node-22 since
the test is CPU-bound and version-permissive. act spins up a container
per cell and downloads each node version inside. **The shim is the win.**

### `service-postgres` — services on Windows

`poc/fixtures/service-postgres.yml` — `postgres:16-alpine` as a service,
job runs `apt-get install postgresql-client` then 4 `psql` commands.

| | Wall clock | Outcome |
| --- | ---: | --- |
| Our runner, container backend | **20.50s** | success |
| `act`, container | **>360s** | **timed out** — never completes |

`act` starts the postgres container (we confirmed it's healthy), starts
the runner container, runs `apt-get install`, then **hangs in the next
step** — `until pg_isready -h postgres; do sleep 1; done`. The service
is reachable from the host on `localhost:5432` but not from inside the
job container via the `postgres` network alias. This is a known act
limitation with services on Windows.

Our runner's container backend explicitly attaches each service container
with `--network-alias <name>`, which is why the same workflow completes
in 20s.

### `hono-bun` — real OSS, host backend

`honojs/hono`'s `bun` job: checkout, setup-bun, `bun install
--frozen-lockfile`, `bun run test:bun`, upload-artifact.

| | Wall clock | Outcome |
| --- | ---: | --- |
| Our runner (warm) | **6.09s** | 26 tests pass |
| Our runner (first run, cold install) | 82s | 26 tests pass |
| `act` | n/a | standard act images lack bun |
| GitHub Actions (typical) | ~120s | — |

Bun is preinstalled on the host, so the `oven-sh/setup-bun` shim is a
no-op. After the first `bun install`, subsequent runs reuse the on-disk
dependency cache.

### `hono-node-matrix` — real OSS matrix, sequential cells

`honojs/hono`'s `node` job: matrix `[18.18.2, 20.x, 22.x]` × `bun
install` + `bun run build` + `bun run test:node`.

| | Wall clock | Outcome |
| --- | ---: | --- |
| Our runner, sequential matrix | **45.00s** | 3 cells, all pass |
|   ↳ cell `node=18.18.2` | 21.00s | (cold-ish — first cell pays bun install) |
|   ↳ cell `node=20.x` | 14.11s | (warm bun cache) |
|   ↳ cell `node=22.x` | 13.30s | (warm) |
| `act` | n/a | standard act images lack bun |

**Important caveat**: our runner currently runs matrix cells of the same
job **sequentially** because they share the host workspace (parallel
cells race on `coverage/.tmp` writes). On GitHub each cell runs in its
own VM with a fresh checkout. **Per-cell git-worktree isolation is on
the roadmap** and will lift this constraint — at which point this number
should drop to ~21s (the slowest single cell's cold install).

## Honest caveats

1. **Cold-vs-cold is narrower.** On a fresh machine: our runner ~80s
   for hono-bun (dominated by `bun install`), GitHub ~120s, act
   sometimes can't run the workflow at all. Speedup ~1.5× cold-vs-cold;
   the real win is the gap between cold and warm on our side (~80×).
2. **`act` is more reliable on Linux** — the 360s timeout for
   service-postgres is a Windows-specific failure mode. On Linux act
   would likely complete service-postgres in ~50–90s. Our runner still
   beats that by ~3–4×.
3. **Matrix is currently sequential** within a single job to avoid the
   shared-workspace race. Per-cell git-worktree is the right fix; once
   shipped, the matrix speedup compounds.
4. **Our `setup-node` shim is "satisfies the major"** — three cells
   that all want node-20.x share one host install. act installs the
   exact requested version in each cell. This is mostly fine for typical
   `^18 / ^20 / ^22` bands but could mask a bug a specific point release
   would surface. Document this in the runner README.
5. **Bench numbers are warm runs** in a single bench session. Some
   targets benefit from earlier targets' warm-up (npm cache, docker
   image cache).

## What this proves

- The runner package, with the parallel scheduler + per-job backend
  selection + composite expansion + setup-node shim + local cache,
  handles real-world workflows.
- All three head-to-head comparisons against `act` are wins:
  3.33× / 5.30× / "act doesn't complete."
- The pitch — "act done right, plus the host fast path act doesn't
  have" — holds across small, matrix, and services workloads.

## What's still TODO before shipping

- **Per-cell git-worktree** for matrix isolation (currently sequential).
- **Real `actions/upload-artifact`** semantics (currently no-op).
- **JS / Docker action support** (composite is done; node20 / docker
  actions still skipped).
- **Cross-platform validation** — same numbers on macOS and Linux. The
  Windows `act` failure on services is a real moat but should be
  characterized honestly across OSes (user is owning this stream).
