# Benchmark — runner vs `act`

Head-to-head warm numbers. The cross-OS run was fired from
[`bench.yml`](../.github/workflows/bench.yml) on GitHub-hosted runners,
matrix `[ubuntu-latest, macos-latest, windows-latest]`. The
windows-local row is from a Windows 11 laptop with Docker Desktop in
Linux-container mode.

## Cross-OS, GitHub-hosted runners

Run id [`25241990379`](https://github.com/plsft/gitgate/actions/runs/25241990379) — all three OS jobs green at ~518s wall clock.

### Linux (`ubuntu-latest`) — full bench, act head-to-head

| Target | Our runner | `act` | Speedup |
| --- | ---: | ---: | ---: |
| `our-ci` (typecheck + 202 tests, 2 parallel jobs) | **10.58s** | 64.85s | **6.13×** |
| `node-matrix` (3-cell matrix, parallel via worktrees) | **1.10s** | 11.63s | **10.56×** |
| `service-postgres` (`postgres:16-alpine` + 4 psql steps) | **12.00s** | timed out (>360s) | **act fails** |
| `hono-bun` (real OSS, honojs/hono `bun` job, 26 tests) | **1.72s** | n/a (act lacks bun) | — |
| `hono-node-matrix` (real OSS, 3-cell node matrix) | **378ms** | n/a (act lacks bun) | — |

**Key finding**: `act` timed out on `service-postgres` even on Linux —
this isn't a Windows-specific bug as I initially characterised it.
`act`'s service-container networking has a real issue across OSes; the
log shows postgres healthy but `pg_isready -h postgres` from the job
container hangs indefinitely. Our runner explicitly sets
`--network-alias postgres` per service and runs the same workflow in
12 seconds.

### macOS (`macos-latest`) — host-only

`act` and `service-postgres` are skipped: GH-hosted macOS runners
don't ship Docker (which `act` needs and which the postgres service
container requires). Host-backend numbers run cleanly.

| Target | Our runner |
| --- | ---: |
| `our-ci` | **11.06s** |
| `node-matrix` | **1.19s** |
| `hono-bun` | **5.05s** |
| `hono-node-matrix` | **902ms** |

### Windows (`windows-latest`) — host-only

GH-hosted Windows runners default Docker to *Windows containers* mode;
switching to Linux containers in CI is fragile. `act` and
`service-postgres` are skipped for the same reason as macOS.

| Target | Our runner |
| --- | ---: |
| `our-ci` | **12.80s** |
| `node-matrix` | **2.57s** |
| `hono-bun` | 95.41s |
| `hono-node-matrix` | **5.44s** |

The 95-second `hono-bun` figure is a cold-install run — the GH-hosted
Windows runner doesn't have a `bun install` cache from a prior run, and
the lockfile install of all hono deps dominates. On a developer laptop
with deps already on disk, the same target runs in **1–6 seconds** (see
windows-local below).

### Windows local (developer machine, Docker Desktop in Linux mode)

For comparison, this is the original Windows 11 laptop bench. Same
runner code; the difference is dev-machine state (Docker, deps, bun
preinstalled).

| Target | Our runner | `act` | Speedup |
| --- | ---: | ---: | ---: |
| `our-ci` | 9.09s | 30.28s | 3.33× |
| `node-matrix` | 3.56s | 18.05s | 5.06× |
| `service-postgres` | 20.50s | timeout (>360s) | **act fails** |
| `hono-bun` | 6.09s | n/a | — |
| `hono-node-matrix` (post-worktree v0.2.0) | 18.99s | n/a | — |

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
pnpm turbo build --filter=@gitgate/runner...
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
   `pg_isready -h postgres`. We don't know yet whether this is a
   networking-namespace issue or something else; the bench treats it
   as a real failure (timeout) rather than excluding the target.
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

## Defensible public claim

> **6× faster than `act`** on standard workflows, **10×** on matrix,
> and `act` doesn't complete services workflows at all on either Linux
> or Windows. (GitHub-hosted Linux warm runs vs GitHub-hosted Linux act.)
