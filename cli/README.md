# gg — GitGate CLI

```bash
npm install -D gg
# or globally
npm install -g gg
```

## CI commands

| Command | Description |
| --- | --- |
| `gg ci init` | Detect your stack, scaffold `.gitgate/pipelines/ci.ts` and `gitgate.config.ts`. |
| `gg ci compile` | Import `.gitgate/pipelines/**/*.ts`, compile to `.github/workflows/*.yml`. |
| `gg ci convert <yaml>` | Convert a GitHub Actions YAML file to TypeScript. |
| `gg ci validate` | Dry-run compile — fail on errors. |
| `gg ci watch` | Recompile on change. |
| `gg ci estimate [--durations <json>] [--runs-per-month <n>]` | Show Ubicloud cost vs GitHub-hosted runners. |

## Gate commands (GitGate Platform)

Authenticate first: `gg auth login` (writes a token to `~/.gitgate/token`).

| Command | Description |
| --- | --- |
| `gg gate status` | Governance state for the current repo. |
| `gg gate score <pr>` | Merge Confidence breakdown for a PR. |
| `gg gate provenance <pr>` | Provenance event log + clone URL. |

## Configuration

`gitgate.config.ts` at the repo root:

```ts
export default {
  pipelinesDir: '.gitgate/pipelines',
  outputDir: '.github/workflows',
  apiUrl: 'https://api.gitgate.com',
};
```

## License

Apache 2.0.
