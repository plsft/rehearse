# composite-action-demo — local composite action authoring + use

A repo with a reusable composite action and a workflow that uses it. Shows
how `@rehearse/runner` inlines composite actions at execution time, with
`${{ inputs.* }}` substituted from the parent's `with:`.

## What this example demonstrates

| Feature | Where |
| --- | --- |
| Local composite action definition | `.github/actions/setup-deps/action.yml` |
| Composite expansion at runtime | runner inlines the inner steps into the calling job |
| `${{ inputs.* }}` substitution | parent's `with: { node-version, cache-key-prefix }` flows in |
| Calling a composite from a TS pipeline | `step.action('./.github/actions/setup-deps', { with: {...} })` |

## Files

```
composite-action-demo/
├── src/
│   ├── index.ts             # the library
│   └── index.test.ts        # vitest test
├── package.json
│
├── .github/
│   ├── actions/
│   │   └── setup-deps/
│   │       ├── action.yml   # the composite action definition
│   │       └── README.md    # docs for the composite
│   └── workflows/
│       └── ci.yml           # generated — uses the composite
│
├── .rehearse/
│   ├── package.json
│   └── pipelines/ci.ts      # the TypeScript pipeline (uses step.action)
└── rehearse.config.mjs
```

## The composite (action.yml)

```yaml
name: setup-deps
inputs:
  node-version:
    default: '20.x'
  cache-key-prefix:
    default: 'npm'

runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}

    - uses: actions/cache@v4
      with:
        path: ~/.npm
        key: '${{ inputs.cache-key-prefix }}-${{ runner.os }}-${{ hashFiles(''**/package-lock.json'') }}'

    - shell: bash
      run: npm ci
```

## The caller (TypeScript pipeline)

```typescript
import { job, pipeline, Runner, step, triggers } from '@rehearse/ci';

export const ci = pipeline('Composite action demo', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('test', {
      runner: Runner.github('ubuntu-latest'),
      steps: [
        step.checkout(),
        step.action('./.github/actions/setup-deps', {
          name: 'Set up deps via composite action',
          with: {
            'node-version': '20.x',
            'cache-key-prefix': 'npm-demo',
          },
        }),
        step.run('npm test', { name: 'Run tests' }),
      ],
    }),
  ],
});
```

## What the runner does

When `rehearse run` hits the `uses: ./.github/actions/setup-deps` step, it:

1. Reads `.github/actions/setup-deps/action.yml`
2. Builds an `inputs` context from the parent's `with:` (`node-version: '20.x'`, `cache-key-prefix: 'npm-demo'`), defaulting any unspecified inputs from the action's `inputs:` block
3. Walks the composite's `runs.steps`, substitutes `${{ inputs.* }}` references against that context
4. Splices the resulting steps into the parent job in place of the `uses:` line
5. Executes them as normal steps in the parent job's session

You'll see this in the runner's output as labelled steps prefixed with the action path:

```
▶ job: test (host · ubuntu-latest)
  ✓ Checkout                                              0ms
  ✓ ./.github/actions/setup-deps → Setup Node.js 20.x     45ms
  ✓ ./.github/actions/setup-deps → Restore npm cache      12ms
  ✓ ./.github/actions/setup-deps → Install dependencies   1.20s
  ✓ Run tests                                              340ms
```

## Run locally

```bash
cd examples/composite-action-demo

npm install
npm install -g @rehearse/runner @rehearse/cli

rh ci compile
rehearse run .github/workflows/ci.yml
```

## Remote composites work the same way

Change the `uses:` to a remote ref like `oven-sh/setup-bun@v2` and the
runner auto-clones the action at the requested ref into
`.runner/actions/<slug>/`, then expands it the same way. Local and
remote composites share the resolution path.
