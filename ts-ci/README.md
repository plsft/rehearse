# @gitgate/ci

> Type-safe GitHub Actions pipelines in TypeScript. Compile to plain
> YAML on your machine. Zero runtime dependency on us — the YAML is
> the real artifact.

`@gitgate/ci` is the authoring SDK. Write your workflows in TypeScript,
get IDE autocomplete and refactor support, then compile to standard
GitHub Actions YAML you commit alongside your TS source. The CLI ships
separately as [`@gitgate/cli`](https://www.npmjs.com/package/@gitgate/cli)
(binary: `gg`).

[![npm](https://img.shields.io/npm/v/@gitgate/ci)](https://www.npmjs.com/package/@gitgate/ci)
[![License](https://img.shields.io/npm/l/@gitgate/ci)](./LICENSE)
[![Source](https://img.shields.io/badge/source-plsft%2Fgitgate-22c55e)](https://github.com/plsft/gitgate)

## Install

```bash
# The SDK
npm install -D @gitgate/ci

# Plus the compile/init/convert CLI
npm install -D @gitgate/cli
```

## Hello, world

```ts
// .gitgate/pipelines/ci.ts
import { pipeline, job, step, triggers, Runner } from '@gitgate/ci';
import { node } from '@gitgate/ci/presets';

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
npx gg ci compile
# → .github/workflows/ci.yml
```

The compiled YAML has zero `@gitgate/ci` dependency at CI time. You can
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
| `Runner.github(label)` / `Runner.ubicloud(size?)` / `Runner.selfHosted(...)` / `Runner.custom(spec)` | Runner specs. |

### Context helpers

```ts
import { secrets, vars, github, env, needs, steps, expr, hashFiles } from '@gitgate/ci';

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

`@gitgate/ci/presets` exports small step-constructor objects with
sensible defaults: `node`, `bun`, `python`, `rust`, `go`, `docker`.

```ts
import { node, bun, python, rust, go, docker } from '@gitgate/ci/presets';

node.setup('20')        // actions/setup-node@v4 with node-version: '20'
bun.install()           // run: bun install --frozen-lockfile
python.test('pytest')   // run: pytest
docker.buildPush('myimage:${{ github.sha }}', { push: true })
```

### Convert existing YAML to TypeScript

```ts
import { convert } from '@gitgate/ci';

const { source, warnings } = convert(yamlString);
// source: TypeScript source ready to drop into .gitgate/pipelines/
// warnings: array of unmapped actions or constructs
```

The CLI command is `gg ci convert <yaml>`.

### Runner support

The same `Runner` constants are honored by
[`@gitgate/runner`](https://www.npmjs.com/package/@gitgate/runner) — the
local runner reads the compiled YAML and executes it on your laptop, 6–10×
faster than `act`. So you author in TS, compile to YAML, run locally
before pushing.

## Compatibility

This package compiles to **standard GitHub Actions YAML**. The YAML works
on:

- GitHub-hosted runners (`ubuntu-latest`, `macos-latest`, `windows-latest`)
- Self-hosted runners (`Runner.selfHosted(...)`)
- Ubicloud runners (`Runner.ubicloud('standard-4')` etc.)
- Locally via `@gitgate/runner` (or `act`, if you prefer)

The TypeScript itself runs anywhere Node 18+ does. Tests run on Node 22.

## Repo

Source, issues, roadmap: <https://github.com/plsft/gitgate>.

## License

Apache 2.0.
