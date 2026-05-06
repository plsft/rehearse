# @rehearse/ci

> **The TypeScript-authored CI SDK.** Write GitHub Actions workflows in
> typed TypeScript with full IDE autocomplete, compile to standard YAML
> on your machine, ship the YAML. **Zero runtime dependency on us** —
> the compiled YAML works on stock GitHub Actions even if you uninstall
> the SDK.

`@rehearse/ci` fills a small but real niche: typed TypeScript that
compiles **lossless** to standard GitHub Actions YAML. The hosted-runner
SaaS layer (Blacksmith, Ubicloud, RunsOn, Depot, WarpBuild) doesn't try
to do this. YAML-authoring alternatives that do exist (Pulumi, Earthly,
Dagger, hand-rolled generators) either lock you into a proprietary
execution model, use a non-YAML output format, or don't compile to
canonical GH Actions YAML you can ship to stock GitHub Actions.

The forward path (`compile`: TS → YAML) is **100% lossless** — every
SDK feature produces canonical GH Actions YAML, verified by a comprehensive
snapshot test suite. The reverse path (`convert`: YAML → TS) is a
migration starter: handles the common shapes (triggers / jobs / runner /
steps / env / permissions / outputs / conditions) so you can adopt the
SDK on existing repos in one command, then hand-port the advanced bits
(matrix / services / concurrency).

The CLI ships separately as [`@rehearse/cli`](https://www.npmjs.com/package/@rehearse/cli)
(binary: `rh`). Pair both if you want `rh ci init` / `compile` / `convert`
ergonomics.

[![npm](https://img.shields.io/npm/v/@rehearse/ci)](https://www.npmjs.com/package/@rehearse/ci)
[![License](https://img.shields.io/npm/l/@rehearse/ci)](./LICENSE)
[![Source](https://img.shields.io/badge/source-plsft%2Frehearse-22c55e)](https://github.com/plsft/rehearse)

## Install

```bash
# The SDK
npm install -D @rehearse/ci

# Plus the compile/init/convert CLI
npm install -D @rehearse/cli
```

## Hello, world

```ts
// .rehearse/pipelines/ci.ts
import { pipeline, job, step, triggers, Runner } from '@rehearse/ci';
import { node } from '@rehearse/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('test', {
      runner: Runner.github('ubuntu-latest'),
      steps: [
        step.checkout(),
        node.setup('20'),
        node.install(),
        node.test(),
      ],
    }),
  ],
});
```

```bash
npx rh ci compile
# → .github/workflows/ci.yml
```

The compiled YAML has zero `@rehearse/ci` dependency at CI time. You can
delete this package after compiling and the YAML still works.

## API overview

### Builders

| Function | Purpose |
| --- | --- |
| `pipeline(name, config)` | Top-level pipeline (triggers + jobs, plus optional permissions, env, concurrency, defaults). |
| `job(name, config)` | A job: `runner` + `steps` + optional `needs`, `matrix`, `services`, `env`, `if`, etc. |
| `step.run(cmd, opts?)` | Inline shell. |
| `step.action(uses, opts?)` | Reference a GitHub Action by `owner/repo@ref`. |
| `step.checkout(opts?)` | `actions/checkout@v4` with typed options. |
| `step.uploadArtifact(opts)` / `step.downloadArtifact(name, path?)` | `actions/upload-artifact@v4` / `download-artifact@v4`. |
| `step.cache(opts)` | `actions/cache@v4` with `key`, `path`, `restoreKeys`. |
| `triggers.push|pullRequest|workflowDispatch|schedule|release|workflowRun` | Trigger constructors. |
| `Runner.github(label)` / `Runner.selfHosted(...)` / `Runner.custom(spec)` | Runner specs. |

### Context helpers

```ts
import { secrets, vars, github, env, needs, steps, expr, hashFiles } from '@rehearse/ci';

secrets('GITHUB_TOKEN')                  // ${{ secrets.GITHUB_TOKEN }}
vars('REGION')                           // ${{ vars.REGION }}
github('event.pull_request.number')      // ${{ github.event.pull_request.number }}
env('NODE_ENV')                          // ${{ env.NODE_ENV }}
needs('build', 'sha')                    // ${{ needs.build.outputs.sha }}
steps('lint', 'result')                  // ${{ steps.lint.outputs.result }}
expr('matrix.os == \'ubuntu-latest\'')   // ${{ matrix.os == 'ubuntu-latest' }}
hashFiles('**/package-lock.json')        // ${{ hashFiles('**/package-lock.json') }}
```

All validate input (throw on empty/whitespace).

### Presets

`@rehearse/ci/presets` exports small step-constructor objects with
sensible defaults: `node`, `bun`, `python`, `rust`, `go`, `docker`.

```ts
import { node, bun, python, rust, go, docker } from '@rehearse/ci/presets';

node.setup('20')        // actions/setup-node@v4 with node-version: '20'
bun.install()           // run: bun install --frozen-lockfile
python.test('pytest')   // run: pytest
docker.buildPush('myimage:${{ github.sha }}', { push: true })
```

### Compile programmatically

```ts
import { compile, toYaml } from '@rehearse/ci';
import { ci } from './my-pipeline.js';

// compile() returns the structured workflow object
const workflow = compile(ci);

// toYaml() serializes any compatible object to GH Actions YAML
const yaml = toYaml(workflow);
console.log(yaml);
```

### Convert existing YAML to TypeScript (migration starter)

```ts
import { convert } from '@rehearse/ci';

const { source, warnings } = convert(yamlString);
// source: TypeScript source ready to drop into .rehearse/pipelines/
// warnings: array of unmapped actions or constructs
```

`convert()` is a **migration starter, not a faithful round-trip**. It
handles common shapes (`run` / `uses` / `with` / `env` / `if` and the
standard event triggers) but currently drops `matrix`, `services`,
`concurrency`, `defaults`, `environment`, job-level `permissions`, and
job outputs. Review the generated TS before relying on it; hand-port
the dropped blocks; then `rh ci compile` round-trips back to YAML to
verify.

The CLI wrapper is `rh ci convert <yaml>`.

### Estimate runner cost

```ts
import { estimate } from '@rehearse/ci';
import { ci } from './my-pipeline.js';

const report = estimate(ci, {
  durations: { test: 7, build: 5 },   // minutes per job
  runsPerMonth: 200,
});
console.log(report.totalUsd, report.savingsVsGitHubUsd);
```

Pricing tables are a **list-price snapshot** baked into the package
(refresh per release). The math is real (per-job × per-minute × runs
against GitHub-hosted public list prices) — verify against current rate
cards before quoting numbers to customers.

The CLI wrapper is `rh ci estimate`.

### Runner support

The same `Runner` constants are honored by
[`@rehearse/cli`](https://www.npmjs.com/package/@rehearse/cli) — the
local runner reads the compiled YAML and executes it on your laptop,
**5–9× faster than `act`** on standard workflows, **30× on services**.
So you author in TS, compile to YAML, run locally before pushing — and
optionally ship the same workflow to a [Rehearse Pro](https://rehearse.sh/pro)
VM with `rh run --remote`.

## Compatibility

This package compiles to **standard GitHub Actions YAML**. The YAML works
on:

- GitHub-hosted runners (`ubuntu-latest`, `macos-latest`, `windows-latest`)
- Self-hosted runners (`Runner.selfHosted(...)`)
- Third-party hosted runner pools via `Runner.custom('your-label')` —
  e.g. Ubicloud, BuildJet, Namespace, RunsOn — anywhere the org has
  configured the corresponding GitHub App or self-hosted listener
- Locally via `@rehearse/cli` (or `act`, if you prefer)

The TypeScript itself runs anywhere Node 18+ does. Tests run on Node 22.

## Repo

Source, issues, roadmap: <https://github.com/plsft/rehearse>.

## License

Apache 2.0.
