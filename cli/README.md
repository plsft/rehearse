# @rehearse/cli

> `rh` — command-line tool for authoring GitHub Actions workflows in
> TypeScript and compiling them to YAML.

The CLI front-end for [`@rehearse/ci`](https://www.npmjs.com/package/@rehearse/ci).
Initialise a project, compile TypeScript pipelines to `.github/workflows/*.yml`,
convert existing YAML to TypeScript, watch for changes, estimate Ubicloud
runner cost.

[![npm](https://img.shields.io/npm/v/@rehearse/cli)](https://www.npmjs.com/package/@rehearse/cli)
[![License](https://img.shields.io/npm/l/@rehearse/cli)](./LICENSE)
[![Source](https://img.shields.io/badge/source-plsft%2Frehearse-22c55e)](https://github.com/plsft/rehearse)

> **Note:** This package is `@rehearse/cli`, but the binary it installs is
> `rh` (so you type `rh ci compile`, not `cli ci compile`). For local
> workflow execution, see the separate
> [`@rehearse/runner`](https://www.npmjs.com/package/@rehearse/runner)
> package, which installs as `runner`.

## Install

```bash
# Per-project (recommended — pin the version alongside @rehearse/ci)
npm install -D @rehearse/cli

# Or globally
npm install -g @rehearse/cli

rh --version
```

## Commands

| Command | What it does |
| --- | --- |
| `rh ci init` | Detect your stack (Node / Bun / Rust / Go / Python), scaffold `.rehearse/pipelines/ci.ts` and `rehearse.config.ts`. |
| `rh ci compile` | Import `.rehearse/pipelines/**/*.ts`, compile to `.github/workflows/*.yml`. |
| `rh ci convert <yaml>` | Convert a GitHub Actions YAML file to TypeScript. Reports unmapped actions. |
| `rh ci validate` | Dry-run compile — fail on errors without writing output. |
| `rh ci watch` | Recompile on change — useful while editing pipeline TS. |
| `rh ci estimate` | Show Ubicloud cost vs GitHub-hosted runners for the compiled pipelines. |

Use the per-command `--help` for full flag lists:

```bash
rh ci compile --help
rh ci estimate --help
```

## Quick start

```bash
# In a fresh repo
mkdir my-project && cd my-project
git init && npm init -y

npm install -D @rehearse/ci @rehearse/cli

# Scaffold .rehearse/pipelines/ci.ts and rehearse.config.ts
rh ci init

# Edit .rehearse/pipelines/ci.ts, then:
rh ci compile
# → wrote .github/workflows/ci.yml

# Watch and recompile on save
rh ci watch
```

## Configuration

`rehearse.config.ts` at the repo root (auto-created by `rh ci init`):

```ts
const config = {
  pipelinesDir: '.rehearse/pipelines',
  outputDir: '.github/workflows',
};

export default config;
```

## Convert existing YAML

```bash
rh ci convert .github/workflows/ci.yml --out .rehearse/pipelines/
# → .rehearse/pipelines/ci.ts
```

The converter maps `actions/checkout@v4` to `step.checkout()`,
`actions/setup-node@v4` to a typed `step.action(...)` call (with a
suggestion to use the `node` preset for nicer ergonomics), and so on.
Unknown actions land as `step.action(uses, { with: {...} })` and the
warnings list flags anything that needed a fallback.

## Estimate runner cost

```bash
rh ci estimate --durations '{"test":7,"build":5}' --runs-per-month 200
```

Outputs a per-job table with the Ubicloud cost vs the GitHub-hosted
equivalent, plus the savings percentage.

## Run workflows locally before pushing

For local execution of the YAML you just compiled, install
[`@rehearse/runner`](https://www.npmjs.com/package/@rehearse/runner) and
run:

```bash
runner run .github/workflows/ci.yml
```

The runner reads the compiled YAML and executes it on your laptop —
6–10× faster than `act` on real workflows.

## Repo

Source, issues, roadmap: <https://github.com/plsft/rehearse>.

## License

Apache 2.0.
