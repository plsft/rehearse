# Rehearse examples

Five small, self-contained sample projects demonstrating real CI pipelines
authored in TypeScript with `@rehearse/ci`, runnable locally with
`@rehearse/runner`.

| Example | Stack | What it shows |
| --- | --- | --- |
| [`node-app/`](node-app) | Node + Vitest | **matrix `[18.x, 20.x, 22.x]` parallel via per-cell git worktree**, `actions/cache`, `upload-artifact` for coverage. |
| [`python-api/`](python-api) | FastAPI + pytest | **Postgres `services:` block** via the container backend with `--network-alias`. The workflow class `act` doesn't complete. |
| [`php-app/`](php-app) | PHP + PHPUnit + PHPStan | **Remote JS action** (`shivammathur/setup-php@v2`) auto-cloned and executed via the runner's JS-action runtime. Matrix `[8.2, 8.3, 8.4]`. |
| [`dotnet-app/`](dotnet-app) | .NET (C#) + xUnit | **Multi-target framework matrix** `[net8.0, net9.0]` with shimmed `actions/setup-dotnet` (host no-op locally). NuGet cache, TRX test artifacts. |
| [`composite-action-demo/`](composite-action-demo) | Node + Vitest | A local composite action (`./.github/actions/setup-deps`) and a workflow that uses it. Shows composite expansion + `${{ inputs.* }}` substitution. |

## Run any of them

Each example is fully self-contained. To run an example locally:

```bash
cd examples/node-app

# install the example's deps
pnpm install

# install the rehearse toolchain locally to this example
npm install -D @rehearse/ci
npm install -g @rehearse/runner @rehearse/cli

# regenerate the compiled YAML from the TypeScript pipeline
rh ci compile

# run the workflow on your laptop
rehearse run .github/workflows/ci.yml
```

That's the loop: edit the TS pipeline → `rh ci compile` → `rehearse run`.
For watch-mode iteration during dev:

```bash
rehearse watch .github/workflows/ci.yml
```

## Pre-generated YAML is committed

The `.github/workflows/ci.yml` in each example is the actual output of
`rh ci compile` against the matching `.rehearse/pipelines/ci.ts`. You can
read the TypeScript source and the generated YAML side-by-side. Both are
checked in so you can push the example directly to GitHub as-is and
watch CI run there.

## Targeting a different runner

Every example uses `Runner.github('ubuntu-latest')` so the generated
YAML is portable to any GitHub Actions setup. To target a bigger tier,
self-hosted, or a third-party hosted-runner provider, swap the runner
in the `.rehearse/pipelines/ci.ts` and recompile:

- Bigger GitHub-hosted: `Runner.github('ubuntu-latest-4-cores')`
- Self-hosted: `Runner.selfHosted('linux', 'x64')`
- Custom label: `Runner.custom('your-runner-label')`

See [the package reference](https://rehearse.sh/packages) for the full
runner / `@rehearse/ci` / `rh` surface.
