# @gitgate/runner

> Local-first runner for GitHub Actions workflows. Same YAML, fast.

Run your `.github/workflows/*.yml` on a developer laptop in tens of seconds —
host backend by default, container backend (Docker) when the job needs
services or cross-platform parity.

This package is the orchestrator. The pieces it composes:

- **Parser** — uses [`@gitgate/ci`](../ts-ci) for `parseWorkflow`.
- **Planner** — expands `strategy.matrix` into concrete cells, substitutes
  `${{ matrix.* }}` references, and picks a backend per job.
- **Scheduler** — runs jobs in parallel respecting `needs:` and `if:`,
  bounded by `--max-parallel`.
- **Backends** — `HostBackend` (subprocess) and `ContainerBackend`
  (Docker, with services on a private network and a long-lived job
  container that steps `docker exec` into).
- **Shims** — in-process replacements for the most common `uses:` actions
  (checkout, setup-node/python/go/bun, cache, artifacts) so the runner
  doesn't waste time spinning up containers for them.

## Install

```bash
# Inside this repo, as a workspace package — already wired in.
pnpm install
pnpm --filter @gitgate/runner build
```

## CLI

```bash
node runner/dist/cli.js run <workflow.yml> [options]

Options:
  -j, --job <name>        run only this job (matrix variants of it still all run)
  -b, --backend <type>    host | container | auto (default: auto)
  -p, --max-parallel <n>  max concurrent jobs (default: min(cpus, 4))
  -c, --cwd <dir>         working directory (default: inferred from workflow path)
      --fail-fast         cancel sibling jobs on first failure
      --quiet             minimal output
      --bench             single JSON line on stdout (for the bench harness)
      --env-file <file>   load env vars from file (KEY=VALUE per line)
```

## Programmatic API

```ts
import { run } from '@gitgate/runner';

const result = await run({
  workflowPath: '.github/workflows/ci.yml',
  jobFilter: 'test',
  backend: 'auto',
  maxParallel: 4,
});

console.log(result.status);  // 'success' | 'failure' | 'skipped'
console.log(result.durationMs);
for (const j of result.jobs) console.log(j.jobName, j.status, j.durationMs);
```

## Backend selection

Per job, the planner chooses:

- `host` when the job has no `services:`, no `container:`, and `runs-on`
  matches the developer's OS family (or is generic).
- `container` otherwise — needed for `services: postgres:` and similar,
  and when a `runs-on: windows-latest` / `macos-latest` job is being run
  on a Linux host.

Override globally with `--backend host|container`.

## Scope

What this runner DOES support today:

- ✓ `run:` steps with `bash`/`pwsh`/`cmd` (the GitHub default per OS)
- ✓ `uses:` for the top ~15 most-popular actions, in-process shims
  (checkout, setup-*, cache, artifacts)
- ✓ `services:` with health checks (container backend)
- ✓ `strategy.matrix` (variables × include − exclude)
- ✓ `needs:` with parallel scheduling
- ✓ `if:` on jobs and steps — a useful subset of the expression language
- ✓ Step-level `working-directory:`, `env:`, `continue-on-error:`,
  `timeout-minutes:`, `shell:`
- ✓ `${{ matrix… }}`, `${{ env… }}`, `${{ secrets… }}`,
  `${{ runner… }}`, `${{ needs.<job>.outputs.<n> }}`,
  `${{ steps.<id>.outputs.<n> }}`, `${{ github.* }}` (subset)

What it does NOT support yet:

- ✗ Composite / local actions (`./.github/actions/*`)
- ✗ Reusable workflows (`uses: ./.github/workflows/foo.yml`)
- ✗ OIDC / `id-token: write`
- ✗ `concurrency:` group cancellation
- ✗ Real `actions/cache` semantics (CDN-backed; we use local fs)
- ✗ Real `actions/upload-artifact` semantics (we write to local fs)
- ✗ Full GitHub-Actions expression language

These are the known gaps and are tracked on the runner's roadmap.

## License

Apache 2.0.
