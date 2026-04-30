# CI SDK Quickstart

Five minutes from zero to a typed pipeline.

## 1. Install

```bash
npm install -D @gitgate/ci gg
# or
pnpm add -D @gitgate/ci gg
# or
bun add -d @gitgate/ci gg
```

## 2. Initialise

```bash
npx gg ci init
```

`gg` detects your stack (Bun, Node, Rust, Go, Python) and scaffolds:

```
.gitgate/pipelines/ci.ts
gitgate.config.ts
```

## 3. Edit the pipeline

```ts
// .gitgate/pipelines/ci.ts
import { pipeline, job, step, triggers, Runner } from '@gitgate/ci';
import { node } from '@gitgate/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('lint', {
      runner: Runner.ubicloud('standard-2'),
      steps: [step.checkout(), node.setup('20'), node.install(), node.lint()],
    }),
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      needs: ['lint'],
      steps: [step.checkout(), node.setup('20'), node.install(), node.test(true)],
    }),
  ],
});
```

## 4. Compile

```bash
npx gg ci compile
# → .github/workflows/ci.yml
```

## 5. Commit both

The TypeScript file is the source of truth, but commit the generated YAML so
that CI runs without a build step.

```bash
git add .gitgate/pipelines/ci.ts .github/workflows/ci.yml
git commit -m "ci: typescript-driven pipeline"
```

## What's next

- Add the GitGate GitHub App for agent governance — see
  [governance-quickstart.md](governance-quickstart.md).
- Estimate cost: `gg ci estimate --durations '{"lint":2,"test":7}'`.
- Convert an existing YAML: `gg ci convert .github/workflows/old.yml`.
