# Benchmark — runner vs `act`

Head-to-head warm numbers. The cross-OS run was fired from
[`bench.yml`](../.github/workflows/bench.yml) on GitHub-hosted runners,
matrix `[ubuntu-latest, macos-latest, windows-latest]`. The
windows-local row is from a Windows 11 laptop with Docker Desktop in
Linux-container mode.

## Cross-OS, GitHub-hosted runners — v0.3.11

Run id [`25351624358`](https://github.com/plsft/rehearse/actions/runs/25351624358) — re-bench against the latest published runner (5 patch releases since the v0.3.2 baseline below). Three OS jobs green.

### Linux (`ubuntu-latest`) — full bench, act head-to-head

| Target | Our runner | `act` | Speedup | vs v0.3.2 |
| --- | ---: | ---: | ---: | --- |
| `our-ci` (typecheck + tests, 2 parallel jobs) | **12.19s** | 63.78s | **5.23×** | ↑ from 4.78× |
| `node-matrix` (3-cell matrix, parallel via worktrees) | **1.12s** | 10.07s | **8.99×** | ≈ 9.09× |
| `service-postgres` (`postgres:16-alpine` + 4 psql steps) | **10.97s** | timed out (360.07s) | **32.82×** — act fails | ↑ from 30.50× |
| `hono-bun` (real OSS, honojs/hono `bun` job) | **7.58s** | n/a (act lacks bun) | — | slower than 3.63s — see note |
| `hono-node-matrix` (real OSS, 3-cell node matrix) | _regression continues — exits non-zero in 1.17s_ | n/a | — | unchanged |

**`act` services failure**: `act` timed out on `service-postgres` at
360.07s on Linux GH-runner — confirms the service-container networking
issue persists in act. Our runner explicitly sets `--network-alias <name>`
per service and runs the same workflow in **10.97s** (32.82× faster).

**`hono-bun` slower at v0.3.11 (7.58s vs 3.63s):** the v0.3.7 host-backend
change to set `$GITHUB_OUTPUT`/`$GITHUB_ENV`/`$GITHUB_PATH` per step adds
mkdir + four file-creates per `run:` step. For a workflow with many small
steps this shows up as wall-time overhead. Net win for correctness (fixes
the "ambiguous redirect" bug we hit on real customer workflows), small
loss on this micro-bench. Will optimize per-step file creation in a
future patch.

### macOS (`macos-latest`) — host-only — v0.3.11

`act` and `service-postgres` are skipped: GH-hosted macOS runners
don't ship Docker. Host-backend numbers run cleanly.

| Target | Our runner | vs v0.3.2 |
| --- | ---: | --- |
| `our-ci` | **11.06s** | ≈ 10.06s |
| `node-matrix` | **911ms** | ≈ 910ms |
| `hono-bun` | **6.00s** | ↑ from 6.81s |
| `hono-node-matrix` | _regression continues_ | unchanged |

### Windows (`windows-latest`) — host-only — v0.3.11

GH-hosted Windows runners default Docker to *Windows containers* mode;
switching to Linux containers in CI is fragile. `act` and
`service-postgres` are skipped for the same reason as macOS.

| Target | Our runner | vs v0.3.2 |
| --- | ---: | --- |
| `our-ci` | **15.38s** | slower than 13.37s (Windows GH pool variance + per-step env-file overhead) |
| `node-matrix` | **11.21s** | slower than 2.21s — see note |
| `hono-bun` | 82.80s (cold-install) | slower than 59.82s |
| `hono-node-matrix` | _regression continues_ | unchanged |

The Windows `node-matrix` regression (2.21s → 11.21s) is the cost of the
v0.3.7 GITHUB_OUTPUT writes amplified by Windows' slower per-process
file creation (3 cells × ~10 steps × 4 small files each). On Linux/macOS
the same per-step overhead is sub-100ms because tmpfs file create is fast.
Optimization candidate: pre-create the 4 step files once per session and
truncate between steps.

## Earlier baseline — v0.3.2

Original benchmark, kept for historical comparison and to demonstrate
that the "5–9× faster than `act`" headline holds across releases.

Run id [`25262157287`](https://github.com/plsft/rehearse/actions/runs/25262157287).

### Linux (`ubuntu-latest`) — v0.3.2 baseline

| Target | Our runner | `act` | Speedup |
| --- | ---: | ---: | ---: |
| `our-ci` | 13.14s | 62.86s | 4.78× |
| `node-matrix` | 1.05s | 9.50s | 9.09× |
| `service-postgres` | 11.80s | timed out (360.05s) | 30.50× — act fails |
| `hono-bun` | 3.63s | n/a | — |
| `hono-node-matrix` | _regression_ | n/a | — |

### macOS (`macos-latest`) — v0.3.2 baseline

| Target | Our runner |
| --- | ---: |
| `our-ci` | 10.06s |
| `node-matrix` | 910ms |
| `hono-bun` | 6.81s |
| `hono-node-matrix` | _regression_ |

### Windows (`windows-latest`) — v0.3.2 baseline

| Target | Our runner |
| --- | ---: |
| `our-ci` | 13.37s |
| `node-matrix` | 2.21s |
| `hono-bun` | 59.82s (cold-install) |
| `hono-node-matrix` | _regression_ |

The 59.82-second `hono-bun` Windows GH-runner figure is a cold-install
run — no `bun install` cache, lockfile install of all hono deps
dominates. On a developer laptop with deps already on disk, the same
target runs in **1.5–6 seconds** (see
windows-local below).

### Windows local (developer machine, Docker Desktop in Linux mode)

For comparison, this is the original Windows 11 laptop bench. Same
runner code; the difference is dev-machine state (Docker, deps, bun
preinstalled).

Re-run on **2026-05-02 against the runner with the v0.3.1 require() fix**
(see commit fixing the ESM-context crash in `composite.ts` /
`artifacts.ts`). All five targets executed cleanly via the published
CLI surface; previously the matrix targets crashed when invoked
directly because of the require() in composite.ts.

| Target | Our runner | `act` | Speedup |
| --- | ---: | ---: | ---: |
| `our-ci` | **13.32s** | 55.80s | **4.19×** |
| `node-matrix` | **3.57s** | 18.72s | **5.25×** |
| `service-postgres` | **20.63s** | timeout (360.02s) | **17.45×** (act fails) |
| `hono-bun` | **1.58s** | n/a | — |
| `hono-node-matrix` | **18.47s** | n/a | — |

The earlier v0.2.0 numbers (`9.09s` / `3.56s` / `20.50s` / `6.09s` /
`18.99s`) drifted under load — laptop background state matters more
than runner version on the host backend. The v0.3.1 numbers above are
the steady-state warm read after running `pnpm tsx bench/compare.ts
--skip-cold` on a quiet machine.

The Linux GH-runner numbers are *better than* Windows-local across the
board (faster CPUs in the Linux pool + native Docker + better disk
caches). That's why we now report Linux as the headline benchmark.

## Reproduce

```bash
# Cross-OS via GH Actions
gh workflow run bench.yml
gh run watch --workflow=bench.yml

# Locally
pnpm install
pnpm turbo build --filter=@rehearse/runner...
git clone --depth 1 https://github.com/honojs/hono.git poc/playground/hono
docker pull node:22-bookworm-slim postgres:16-alpine catthehacker/ubuntu:act-latest
pnpm tsx bench/compare.ts --skip-cold
```

The bench harness auto-detects whether `act` is on PATH and Docker is
running; missing tools are skipped with a clear log line rather than
errored.

## Honest caveats

1. **`act` services are broken across OSes**, not just Windows. `act`
   on Linux GH-hosted with `postgres:16-alpine` healthy still hangs at
   `pg_isready -h postgres` — the v0.3.2 bench hit the harness's 360s
   kill exactly. The bench treats it as a real failure rather than
   excluding the target.
2. **Cold-vs-cold gap is narrower** than the warm headline. First-ever
   run after a clean clone: a fresh `pnpm install` / `bun install`
   dominates everything — saving ~30s of VM provisioning matters less
   when 60s of install is sequential. The wedge is the warm dev
   pre-push loop, where deps are already on disk.
3. **Per-OS performance varies** because GH-hosted runner specs vary.
   Linux runners (newer 4 vCPU pool) are notably faster than macOS
   (3-core M-series with slower disks under workflows) and Windows
   (4 vCPU but no native pnpm/bun cache). On developer laptops the
   numbers cluster differently — a fast macOS dev box outperforms a
   GH-hosted Windows runner on host-backend targets.
4. **Bench is sequential within a single run**. Targets run one after
   another. Within a single workflow our runner runs jobs (and matrix
   cells, post v0.2.0 worktree work) in parallel.
5. **`hono-node-matrix` regresses on GH-hosted runners at v0.3.2.**
   The target works locally on a developer laptop (Windows 11 dev
   machine: 18.47s warm, 3 cells parallel, all green) but exits non-zero
   in 1.4–4.0s on every GH-hosted OS at v0.3.2. The fast exit time
   suggests setup/install fails before the bun tests run, not the
   per-cell test work itself. This regressed between v0.2.0 and v0.3.2
   (v0.2.0 reported 378ms ✓ on Linux GH, but the brevity of that timing
   suggests cells weren't actually doing work — they were succeeding
   trivially because matrix cells shared a workspace pre-worktree).
   The v0.3.2 result is at least honest about a real failure where the
   v0.2.0 result hid one. Investigation pending.

## Defensible public claim — v0.3.11

> **5–9× faster than `act`** on standard workflows, **30× on services**
> (where `act` doesn't complete at all on either Linux or Windows).
> Linux GH-hosted v0.3.11 warm runs vs Linux GH-hosted `act` warm runs:
> our-ci 5.23×, node-matrix 8.99×, service-postgres 32.82×.
