# @rehearse/runner

> **CI feedback in seconds, before you push.** Run your
> `.github/workflows/*.yml` on every save, on your laptop, in
> sub-second. Same YAML, three execution targets, no lock-in.

`@rehearse/runner` is a local-first GitHub Actions runner. It reads
the YAML you already have, picks a backend per job (host or container),
and executes — giving you CI feedback *before* `git push`. Pair with
`rehearse watch` for save-triggered reruns or `rehearse install-hook` for
a pre-push gate.

The category sibling is [`nektos/act`](https://github.com/nektos/act)
(MIT, ~56k stars) — also OSS, also local. We compete on speed (5–30×
faster on the bench), feature coverage (host backend, watch mode,
pre-push hook, real `services:` networking), and an optional same-binary
hosted offload target via [Rehearse Pro](https://rehearse.sh/pro). Pick
the one that fits your workflow.

Comparison vs hosted-runner replacements (Blacksmith, Ubicloud, RunsOn,
Depot, WarpBuild): they don't try to do local execution at all — they
all start the clock at `git push`. Honest comparison at
[rehearse.sh/vs](https://rehearse.sh/vs).

Free, Apache 2.0, single binary. Pro is $49/mo for 25,000 active
CPU-min, +$49 per additional 25k block, whole-rootfs cache persistence.
Skip it and the runner is yours forever.

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

rehearse --version    # 0.3.12
```

The package installs a single binary called `rehearse`.

## Use

```bash
# Run a workflow
rehearse run .github/workflows/ci.yml

# One job
rehearse run .github/workflows/ci.yml --job test

# Force a backend
rehearse run … --backend host          # subprocess on the host (fast)
rehearse run … --backend container     # docker (parity with GH-hosted)

# Re-run on save (inner-loop dev tool)
rehearse watch .github/workflows/ci.yml

# Block bad pushes
rehearse install-hook                  # writes .git/hooks/pre-push

# Audit a workflow's compatibility before running
rehearse compat .github/workflows/ci.yml

# Ship to a Rehearse Pro VM (auto-detects git origin + ref + subdir)
rehearse run --remote .github/workflows/ci.yml
rehearse run --remote --env-file .env .github/workflows/deploy.yml
```

## Bench (Linux GH-hosted, head-to-head with `act`)

Same workflow, fresh `ubuntu-latest` runner, v0.3.11 warm. Reproducible
via `gh workflow run bench.yml`.

| Target | runner | `act` | Speedup |
| --- | ---: | ---: | ---: |
| `our-ci` (typecheck + tests, 2 parallel jobs) | **12.19s** | 63.78s | **5.23×** |
| `node-matrix` (3-cell matrix, parallel via worktrees) | **1.12s** | 10.07s | **8.99×** |
| `service-postgres` (postgres:16 + 4 psql steps) | **10.97s** | timeout (>360s) | **32.82×** — act fails |
| `hono-bun` (real OSS — honojs/hono `bun` job) | **7.58s** | n/a (act image lacks bun) | — |

Full methodology + per-OS breakdown + historical baselines:
[bench/RESULTS.md](https://github.com/plsft/rehearse/blob/main/bench/RESULTS.md).

## Cross-OS support

| | `rehearse run` | `services:` | act head-to-head |
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

- `run:` steps in `bash` / `pwsh` / `cmd`, with the full
  `$GITHUB_OUTPUT` / `$GITHUB_ENV` / `$GITHUB_PATH` / `$GITHUB_STEP_SUMMARY`
  step contract
- **18 in-process action shims**: `actions/checkout`,
  `actions/setup-{node,python,go,java,dotnet,bun,pnpm,deno,ruby}`,
  `dtolnay/rust-toolchain`, `actions/cache` + `/save` + `/restore`,
  `actions/upload-artifact`, `actions/download-artifact`,
  `codecov/codecov-action`, `actions/github-script`. `setup-dotnet` is a
  real shim that runs Microsoft's `dotnet-install.sh` and caches the SDK.
- **JS actions** (`runs.using: node12 / node16 / node20`, plus our
  forward-compat acceptance of `node22 / 24 / 25`) — auto-cloned at the
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
- `needs:` with topological scheduling and bounded parallelism
- `if:` on jobs and steps with the full context surface
  (`matrix / env / secrets / vars / needs / steps / job / runner / inputs / github`)
- `actions/cache` semantics on local fs (exact-key + restore-key
  longest-prefix matching, persistent across runs, all 3 outputs)
- `actions/upload-artifact` / `download-artifact` backed by `.runner/artifacts/`
- `rehearse run --remote` — ships the workflow YAML + auto-detected git
  context (origin URL + HEAD SHA + cwd subdir) + secrets (from
  `--env-file`) to a Rehearse Pro VM, streams stdout/stderr back as
  ndjson

## What's not supported yet

- Remote reusable workflows (`org/repo/.github/workflows/foo.yml@ref`) — local form works
- Docker actions (`runs.using: docker`) — JS-action runtime ships; Docker-action runtime doesn't yet
- OIDC / `id-token: write` — use long-lived credentials via `--env-file` for now
- `concurrency:` group cancellation — parsed, not enforced

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
for (const j of result.jobs) console.log(j.jobId, j.status, j.durationMs);

// Static audit: how much of a workflow would run today?
const audit = compat('.github/workflows/ci.yml');
console.log(`${audit.coverage.toFixed(1)}% of ${audit.stepsTotal} steps`);
```

Lower-level building blocks are also exported:
[`plan`](./src/planner.ts), [`runJobs`](./src/scheduler.ts),
[`HostBackend`](./src/backends/host.ts), [`ContainerBackend`](./src/backends/container.ts),
[`LocalCache`](./src/cache.ts), [`LocalArtifacts`](./src/artifacts.ts),
[`expandMatrix`](./src/matrix.ts), [`evalExpr`](./src/expression.ts),
[`isJsActionUses`](./src/js-action.ts), [`expandReusable`](./src/reusable.ts),
[`createWorktree`](./src/worktree.ts).

## CLI flags reference

```
rehearse run <workflow.yml> [options]

  -j, --job <name>        run only this job (matrix variants of it still all run)
  -b, --backend <type>    host | container | auto (default: auto)
  -p, --max-parallel <n>  max concurrent jobs (omit for scheduler default ~min(cpus, 4))
  -c, --cwd <dir>         working directory (default: inferred from workflow path)
      --fail-fast         cancel sibling jobs on first failure
      --quiet             minimal output
      --bench             single JSON line on stdout
      --env-file <file>   load env vars from file (KEY=VALUE per line). Loaded
                          values become both process env AND ${{ secrets.* }}
                          context for workflow expansion.
      --remote            execute on a Rehearse Pro VM (requires REHEARSE_TOKEN)
      --api-url <url>     override Pro API URL (default: https://api.rehearse.sh)
      --repo-url <url>    override the git remote URL shipped to the VM
                          (auto-detected from `git remote get-url origin`)
      --repo-ref <ref>    override the git ref (auto-detected from HEAD)
      --repo-subdir <p>   override the in-repo cwd subdir (auto-detected)

rehearse watch <workflow.yml> [options]
  Same flags as `run`. Re-runs on file changes (debounced).

rehearse install-hook
  -w, --workflow <path>   workflow to gate the push on (default: .github/workflows/ci.yml)
  -j, --job <name>        restrict to one job

rehearse compat <workflow.yml>
  --json                  machine-readable JSON
```

### Pro / `--remote` usage

```bash
# 1. Install the OSS runner (same binary)
npm install -g @rehearse/runner@latest

# 2. Set your Pro token (get one at https://pro.rehearse.sh/dashboard/keys)
export REHEARSE_TOKEN=rh_pro_live_…

# 3. Run any workflow remotely
rehearse run --remote .github/workflows/ci.yml

# 4. For deploy workflows, ship long-lived secrets via --env-file
rehearse run --remote --env-file .env .github/workflows/deploy.yml
```

`--remote` auto-detects the cwd's git origin URL, current SHA, and
relative-to-toplevel subdirectory, ships them with the request, and the
Pro VM clones the right repo at the right ref before running. Drop the
flag and you're back to local execution. Same workflow, no lock-in.

## Repo

Source, issues, roadmap: <https://github.com/plsft/rehearse>.

## License

Apache 2.0.
