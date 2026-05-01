# flowrunna — POC

Single-file proof that you can run a GitHub Actions workflow locally on the
host in tens of seconds instead of waiting minutes for a remote runner.

See [RESULTS.md](RESULTS.md) for the numbers.

## Run

```bash
pnpm tsx poc/run-workflow.ts <path-to-workflow.yml> [job-name]
```

Examples:

```bash
pnpm tsx poc/run-workflow.ts .github/workflows/ci.yml
pnpm tsx poc/run-workflow.ts .github/workflows/ci.yml test
```

## What it does

- Parses the YAML using `@gitgate/ci` (existing CI SDK).
- Picks one job (named) or all jobs (sequential).
- Walks each step:
  - `run:` — spawn the script with bash (Unix or Git Bash on Windows) or
    PowerShell, inherit stdio, time the execution.
  - `uses:` — match against a known list of "host-equivalent" actions
    (checkout, setup-node, setup-pnpm, setup-go, setup-bun, cache,
    upload-artifact, etc.) and skip them with a clear log message.
- Honors `working-directory:`, per-step `env:`, and a tiny subset of `if:`
  (`always()`, `success()`, `failure()`, literal `true`/`false`).
- Stops the job on first non-zero exit unless `continue-on-error: true`.
- Prints a per-step + total wall-clock report.

## What it does NOT do

- Containers (everything runs on the host)
- Matrix jobs / `services:` / composite actions / reusable workflows
- Real GitHub-issued tokens, OIDC, real cache, real artifact storage
- Full `${{ ... }}` expression evaluation

These are scope items for the actual runner — the POC stops where it stops on
purpose, to validate the speed wedge fast.
