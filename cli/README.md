# @gitgate/cli

> `gg` — command-line tool for authoring GitHub Actions workflows in
> TypeScript and compiling them to YAML.

The CLI front-end for [`@gitgate/ci`](https://www.npmjs.com/package/@gitgate/ci).
Initialise a project, compile TypeScript pipelines to `.github/workflows/*.yml`,
convert existing YAML to TypeScript, watch for changes, estimate Ubicloud
runner cost.

[![npm](https://img.shields.io/npm/v/@gitgate/cli)](https://www.npmjs.com/package/@gitgate/cli)
[![License](https://img.shields.io/npm/l/@gitgate/cli)](./LICENSE)
[![Source](https://img.shields.io/badge/source-plsft%2Fgitgate-22c55e)](https://github.com/plsft/gitgate)

> **Note:** This package is `@gitgate/cli`, but the binary it installs is
> `gg` (so you type `gg ci compile`, not `cli ci compile`). For local
> workflow execution, see the separate
> [`@gitgate/runner`](https://www.npmjs.com/package/@gitgate/runner)
> package, which installs as `runner`.

## Install

```bash
# Per-project (recommended — pin the version alongside @gitgate/ci)
npm install -D @gitgate/cli

# Or globally
npm install -g @gitgate/cli

gg --version
```

## Commands

| Command | What it does |
| --- | --- |
| `gg ci init` | Detect your stack (Node / Bun / Rust / Go / Python), scaffold `.gitgate/pipelines/ci.ts` and `gitgate.config.ts`. |
| `gg ci compile` | Import `.gitgate/pipelines/**/*.ts`, compile to `.github/workflows/*.yml`. |
| `gg ci convert <yaml>` | Convert a GitHub Actions YAML file to TypeScript. Reports unmapped actions. |
| `gg ci validate` | Dry-run compile — fail on errors without writing output. |
| `gg ci watch` | Recompile on change — useful while editing pipeline TS. |
| `gg ci estimate` | Show Ubicloud cost vs GitHub-hosted runners for the compiled pipelines. |

Use the per-command `--help` for full flag lists:

```bash
gg ci compile --help
gg ci estimate --help
```

## Quick start

```bash
# In a fresh repo
mkdir my-project && cd my-project
git init && npm init -y

npm install -D @gitgate/ci @gitgate/cli

# Scaffold .gitgate/pipelines/ci.ts and gitgate.config.ts
gg ci init

# Edit .gitgate/pipelines/ci.ts, then:
gg ci compile
# → wrote .github/workflows/ci.yml

# Watch and recompile on save
gg ci watch
```

## Configuration

`gitgate.config.ts` at the repo root (auto-created by `gg ci init`):

```ts
const config = {
  pipelinesDir: '.gitgate/pipelines',
  outputDir: '.github/workflows',
};

export default config;
```

## Convert existing YAML

```bash
gg ci convert .github/workflows/ci.yml --out .gitgate/pipelines/
# → .gitgate/pipelines/ci.ts
```

The converter maps `actions/checkout@v4` to `step.checkout()`,
`actions/setup-node@v4` to a typed `step.action(...)` call (with a
suggestion to use the `node` preset for nicer ergonomics), and so on.
Unknown actions land as `step.action(uses, { with: {...} })` and the
warnings list flags anything that needed a fallback.

## Estimate runner cost

```bash
gg ci estimate --durations '{"test":7,"build":5}' --runs-per-month 200
```

Outputs a per-job table with the Ubicloud cost vs the GitHub-hosted
equivalent, plus the savings percentage.

## Run workflows locally before pushing

For local execution of the YAML you just compiled, install
[`@gitgate/runner`](https://www.npmjs.com/package/@gitgate/runner) and
run:

```bash
runner run .github/workflows/ci.yml
```

The runner reads the compiled YAML and executes it on your laptop —
6–10× faster than `act` on real workflows.

## Repo

Source, issues, roadmap: <https://github.com/plsft/gitgate>.

## License

Apache 2.0.
