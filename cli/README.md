# @rehearse/cli

> **The migration on-ramp.** `rh` converts your existing GitHub Actions
> YAML to typed TypeScript in one command, then keeps it compiled
> on every save. Use it to adopt typed CI on an existing repo without
> rewriting a thing.

The CLI front-end for [`@rehearse/ci`](https://www.npmjs.com/package/@rehearse/ci).
Six commands cover the full workflow:

- `rh ci init` — detect your stack (Bun / Node / Rust / Go / Python / .NET) and scaffold a typed pipeline
- `rh ci convert <yaml>` — **YAML → TypeScript migration in one command** (the killer feature for adopting the SDK on existing repos)
- `rh ci compile` — TypeScript → standard GitHub Actions YAML
- `rh ci validate` — type-check pipelines without writing output
- `rh ci watch` — recompile on save (pair with `rh watch` for the inner loop)
- `rh ci estimate` — show GitHub-hosted CI cost per run + per month

This pairs with [`@rehearse/cli`](https://www.npmjs.com/package/@rehearse/cli)
(binary: `rh`) for local execution. Together they give you CI in
TypeScript that runs on your laptop, on a Pro VM, and on real GitHub
Actions — same source, three execution targets, no lock-in. See
[rehearse.sh/vs](https://rehearse.sh/vs) for the comparison vs
hosted-runner SaaS (Blacksmith, Ubicloud, RunsOn).

[![npm](https://img.shields.io/npm/v/@rehearse/cli)](https://www.npmjs.com/package/@rehearse/cli)
[![License](https://img.shields.io/npm/l/@rehearse/cli)](./LICENSE)
[![Source](https://img.shields.io/badge/source-plsft%2Frehearse-22c55e)](https://github.com/plsft/rehearse)

> **Note:** This package is `@rehearse/cli`, but the binary it installs is
> `rh` (so you type `rh ci compile`, not `cli ci compile`). For local
> workflow execution, see the separate
> [`@rehearse/cli`](https://www.npmjs.com/package/@rehearse/cli)
> package, which installs as `rehearse`.

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
| `rh ci init` | Detect your stack (Bun / Node / Rust / Go / Python — checked in that order), scaffold `.rehearse/pipelines/ci.ts`, `.rehearse/package.json`, and `rehearse.config.mjs`. |
| `rh ci compile` | Import `.rehearse/pipelines/**/*.ts`, compile to `.github/workflows/*.yml`. |
| `rh ci convert <yaml>` | **Migration starter** — convert a GitHub Actions YAML to TypeScript. Handles common shapes (`run` / `uses` / `with` / `env` / `if` and the standard event triggers). Currently drops `matrix`, `services`, `concurrency`, `defaults`, `environment`, job-level `permissions`, and outputs — review the generated TS before relying on it. |
| `rh ci validate` | Dry-run compile — fail on errors without writing output. |
| `rh ci watch` | Recompile on change — useful while editing pipeline TS. |
| `rh ci estimate` | Estimate GitHub-hosted CI cost per run and per month for the compiled pipelines. **Pricing is a list-price snapshot baked into the package** (refreshes per release); verify against current rate cards before quoting. |

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

# Scaffold .rehearse/pipelines/ci.ts and rehearse.config.mjs
rh ci init

# Edit .rehearse/pipelines/ci.ts, then:
rh ci compile
# → wrote .github/workflows/ci.yml

# Watch and recompile on save
rh ci watch
```

## Configuration

`rehearse.config.mjs` at the repo root (auto-created by `rh ci init` —
`.mjs` extension is explicit ESM so it loads regardless of your host
project's `package.json` `type` field):

```js
export default {
  pipelinesDir: '.rehearse/pipelines',
  outputDir: '.github/workflows',
};
```

(`.ts` and `.js` config files are also recognized — the loader probes
in that order — but `rh ci init` scaffolds `.mjs` for compatibility.)

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

**Use it as a migration starter, not a faithful round-trip.** It does
not yet emit `matrix`, `services`, `concurrency`, `defaults`, `environment`
blocks, or job-level `permissions` — hand-port those after running the
converter, then `rh ci compile` round-trips back to YAML to verify.

## Estimate runner cost

```bash
rh ci estimate --durations '{"test":7,"build":5}' --runs-per-month 200
```

Outputs a per-job table with cost-per-run on GitHub-hosted runners,
plus a monthly extrapolation given `--runs-per-month`.

## Run workflows locally before pushing

For local execution of the YAML you just compiled, install
[`@rehearse/cli`](https://www.npmjs.com/package/@rehearse/cli) and
run:

```bash
rh run .github/workflows/ci.yml
```

The runner reads the compiled YAML and executes it on your laptop —
5–9× faster than `act` on standard workflows, **30× on services**.
Optional hosted target via `rh run --remote` (Rehearse Pro).

## Repo

Source, issues, roadmap: <https://github.com/plsft/rehearse>.

## License

Apache 2.0.
