# @rehearse/runner

> **Stop pushing CI failures.** Run your `.github/workflows/*.yml` on your
> laptop in seconds. Same YAML. **6–10× faster than [`act`](https://github.com/nektos/act).**

`@rehearse/runner` is a local-first runner for GitHub Actions workflows.
Read the YAML you already have, choose a backend per job (host or
container), execute. Free, Apache 2.0, single binary.

[![npm](https://img.shields.io/npm/v/@rehearse/runner)](https://www.npmjs.com/package/@rehearse/runner)
[![License](https://img.shields.io/npm/l/@rehearse/runner)](./LICENSE)
[![Source](https://img.shields.io/badge/source-plsft%2Frehearse-22c55e)](https://github.com/plsft/rehearse)

## Install

```bash
npm install -g @rehearse/runner
# or
pnpm add -g @rehearse/runner
# or
bun add -g @rehearse/runner

runner --version    # 0.2.x
```

The package installs a single binary called `runner`.

## Use

```bash
# Run a workflow
runner run .github/workflows/ci.yml

# One job
runner run .github/workflows/ci.yml --job test

# Force a backend
runner run … --backend host          # subprocess on the host (fast)
runner run … --backend container     # docker (parity with GH-hosted)

# Re-run on save (inner-loop dev tool)
runner watch .github/workflows/ci.yml

# Block bad pushes
runner install-hook                  # writes .git/hooks/pre-push

# Audit a workflow's compatibility before running
runner compat .github/workflows/ci.yml
```

## Bench (cross-OS, GitHub-hosted runners)

Same workflow, head-to-head against `act` on a fresh `ubuntu-latest`
runner. Reproducible via `gh workflow run bench.yml`.

| Target | runner | `act` | Speedup |
| --- | ---: | ---: | ---: |
| `our-ci` (typecheck + 202 tests, 2 parallel jobs) | **10.58s** | 64.85s | **6.13×** |
| `node-matrix` (3-cell matrix, parallel via worktrees) | **1.10s** | 11.63s | **10.56×** |
| `service-postgres` (postgres:16-alpine + 4 psql steps) | **12.00s** | timeout (>360s) | **act fails** |
| `hono-bun` (real OSS — honojs/hono `bun` job, 26 tests) | **1.72s** | n/a (act image lacks bun) | — |
| `hono-node-matrix` (real OSS — 3-cell node matrix) | **378ms** | n/a (act image lacks bun) | — |

`act`'s `service-postgres` failure isn't OS-specific — it timed out on
both Linux and Windows GH runners. `act`'s service-container networking
is broken across hosts; the runner's `--network-alias <name>` per
service makes the same workflow run cleanly.

Full methodology + per-OS breakdown:
[bench/RESULTS.md](https://github.com/plsft/rehearse/blob/main/bench/RESULTS.md).

## Cross-OS support

| | `runner run` | `services:` | act head-to-head |
| --- | :---: | :---: | :---: |
| **Linux** (`ubuntu-latest`) | ✓ | ✓ | ✓ |
| **macOS** (`macos-latest`) | ✓ | ✗ Docker not on GH runner | ✗ |
| **Windows** (`windows-latest`) | ✓ | ⚠ Linux containers need setup | ⚠ |
| **Any developer laptop** with Docker Desktop in Linux mode | ✓ | ✓ | ✓ |

Host-backend bench targets work on every OS. Container backend needs
Docker with Linux containers — that's standard on Linux dev boxes and
on `ubuntu-latest` GH-hosted runners; on macOS / Windows GH runners
you only get host-backend execution.

## What's supported

- `run:` steps in `bash` / `pwsh` / `cmd`
- Top ~15 actions in-process: `checkout`, `setup-node`/`python`/`go`/`bun`,
  `cache`, `upload-artifact`, `download-artifact`
- **JS actions** (`runs.using: node20|18|16`) — auto-cloned at the
  requested ref, run with the standard `INPUT_*` / `GITHUB_OUTPUT` /
  `GITHUB_ENV` env contract
- **Composite actions, local and remote** (`./.github/actions/*` and
  `owner/repo[/sub-path]@ref`) — inlined with `${{ inputs.x }}` substitution
- **Local reusable workflows** (`uses: ./.github/workflows/foo.yml` at the
  job level) — caller's `with:` and `secrets:` substitute into the called
  workflow's `inputs.*` / `secrets.*` references
- `services:` with health-check waits and a private Docker network alias
- `strategy.matrix` — cartesian product, `include`, `exclude`. **Cells run
  in parallel via per-cell `git worktree`**
- `needs:` with parallel scheduling
- `if:` on jobs and steps (useful expression-language subset)
- `actions/cache` semantics on local fs (exact-key + restore-key
  longest-prefix matching, persistent across runs)
- `actions/upload-artifact` / `download-artifact` backed by `.runner/artifacts/`

## What's not supported yet

- Remote reusable workflows (`org/repo/.github/workflows/foo.yml@ref`) — local form works
- Docker actions (`runs.using: docker`) — JS-action runtime ships; Docker-action runtime doesn't yet
- OIDC / `id-token: write`
- `concurrency:` group cancellation

## Programmatic API

```ts
import { run, compat } from '@rehearse/runner';

const result = await run({
  workflowPath: '.github/workflows/ci.yml',
  jobFilter: 'test',
  backend: 'auto',
  maxParallel: 4,
});

console.log(result.status);      // 'success' | 'failure' | 'skipped'
console.log(result.durationMs);
for (const j of result.jobs) console.log(j.jobName, j.status, j.durationMs);

// Static audit: how much of a workflow would run today?
const audit = compat('.github/workflows/ci.yml');
console.log(`${audit.coverage.toFixed(1)}% of ${audit.stepsTotal} steps`);
```

## CLI flags reference

```
runner run <workflow.yml> [options]

  -j, --job <name>        run only this job (matrix variants of it still all run)
  -b, --backend <type>    host | container | auto (default: auto)
  -p, --max-parallel <n>  max concurrent jobs (default: min(cpus, 4))
  -c, --cwd <dir>         working directory (default: inferred from workflow path)
      --fail-fast         cancel sibling jobs on first failure
      --quiet             minimal output
      --bench             single JSON line on stdout
      --env-file <file>   load env vars from file (KEY=VALUE per line)

runner watch <workflow.yml> [options]
  Same flags as `run`. Re-runs on file changes (debounced).

runner install-hook
  -w, --workflow <path>   workflow to gate the push on (default: .github/workflows/ci.yml)
  -j, --job <name>        restrict to one job

runner compat <workflow.yml>
  --json                  machine-readable JSON
```

## Repo

Source, issues, roadmap: <https://github.com/plsft/rehearse>.

## License

Apache 2.0.
