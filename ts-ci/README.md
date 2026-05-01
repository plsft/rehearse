# @gitgate/ci

> Type-safe GitHub Actions pipelines in TypeScript. Compile to plain YAML on
> your machine. No runtime dependency.

## Install

```bash
npm install -D @gitgate/ci
# also install the CLI
npm install -D gg
```

## Hello, world

```ts
// .gitgate/pipelines/ci.ts
import { pipeline, job, step, triggers, Runner } from '@gitgate/ci';
import { node } from '@gitgate/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest()],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      steps: [step.checkout(), node.setup('20'), node.install(), node.test()],
    }),
  ],
});
```

```bash
npx gg ci compile
# → .github/workflows/ci.yml
```

## API overview

### Builders

| Function | Purpose |
| --- | --- |
| `pipeline(name, config)` | Top-level pipeline. Requires triggers and jobs. |
| `job(name, config)` | A single job: runner + steps (+ matrix, services, env, env name, …). |
| `step.run(cmd, opts?)` | Inline shell. |
| `step.action(uses, opts?)` | Reference a GitHub Action. |
| `step.checkout(opts?)` | `actions/checkout@v4`. |
| `step.uploadArtifact(opts)` / `downloadArtifact(name, path?)` | `actions/upload-artifact@v4` / `download-artifact@v4`. |
| `step.cache(opts)` | `actions/cache@v4`. |
| `triggers.push|pullRequest|workflowDispatch|schedule|release|workflowRun` | Trigger constructors. |
| `Runner.ubicloud(size?)` / `Runner.github(label)` / `Runner.selfHosted(...)` | Runner specs. |

### Context helpers

`secrets`, `vars`, `github`, `env`, `needs`, `steps`, `expr`, `hashFiles` all
return `${{ ... }}` expression strings with input validation.

### Presets

`@gitgate/ci/presets` exports `node`, `bun`, `python`, `rust`, `go`, `docker`.
Each is a small object of step constructors with sensible defaults.

### Agent extensions

`@gitgate/ci/agent` exports:

- `isAgentAuthored()` / `isProvider('claude')` — `if:` expressions that match
  PRs labelled by the GitGate App.
- `coverageGate({ minCoverage, maxCoverageDecrease? })` — fails the job when
  coverage falls below a threshold.
- `expandedMatrix({ nodeVersions, command })` — sequential per-version steps in
  one job, instead of a matrix strategy.
- `provenanceEvent(type, data?)` — best-effort POST to the GitGate Platform
  API. Requires `secrets.GITGATE_TOKEN`.

### Converter

```ts
import { convert } from '@gitgate/ci';

const { source, warnings } = convert(yamlString);
```

## CLI

```bash
gg ci init        # scaffold .gitgate/pipelines/ci.ts and gitgate.config.ts
gg ci compile     # compile .ts pipelines → .yml workflows
gg ci convert ci.yml --out .gitgate/pipelines
gg ci validate    # dry-run compile
gg ci watch       # recompile on change
gg ci estimate    # show Ubicloud cost vs GitHub-hosted
```

## License

Apache 2.0.
