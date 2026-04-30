import fs from 'node:fs/promises';
import path from 'node:path';
import { error, info, success } from '../../utils/output.js';

type StackKind = 'bun' | 'node' | 'rust' | 'go' | 'python' | 'unknown';

async function detectStack(cwd: string): Promise<StackKind> {
  const has = async (rel: string) =>
    fs
      .access(path.join(cwd, rel))
      .then(() => true)
      .catch(() => false);
  if (await has('bun.lockb')) return 'bun';
  if (await has('package-lock.json')) return 'node';
  if (await has('pnpm-lock.yaml')) return 'node';
  if (await has('yarn.lock')) return 'node';
  if (await has('package.json')) return 'node';
  if (await has('Cargo.toml')) return 'rust';
  if (await has('go.mod')) return 'go';
  if (await has('pyproject.toml')) return 'python';
  if (await has('requirements.txt')) return 'python';
  return 'unknown';
}

const TEMPLATES: Record<StackKind, string> = {
  bun: `import { pipeline, job, step, triggers, Runner } from '@gitgate/ci';
import { bun } from '@gitgate/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      steps: [step.checkout(), bun.setup(), bun.install(), bun.test(), bun.build()],
    }),
  ],
});
`,
  node: `import { pipeline, job, step, triggers, Runner } from '@gitgate/ci';
import { node } from '@gitgate/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      steps: [step.checkout(), node.setup('20'), node.install(), node.test(), node.build()],
    }),
  ],
});
`,
  rust: `import { pipeline, job, step, triggers, Runner } from '@gitgate/ci';
import { rust } from '@gitgate/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      steps: [step.checkout(), rust.setup(), rust.cache(), rust.check(), rust.clippy(), rust.test()],
    }),
  ],
});
`,
  go: `import { pipeline, job, step, triggers, Runner } from '@gitgate/ci';
import { go } from '@gitgate/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      steps: [step.checkout(), go.setup(), go.cache(), go.test(), go.build()],
    }),
  ],
});
`,
  python: `import { pipeline, job, step, triggers, Runner } from '@gitgate/ci';
import { python } from '@gitgate/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      steps: [step.checkout(), python.setup('3.12'), python.cache(), python.install(), python.lint(), python.test()],
    }),
  ],
});
`,
  unknown: `import { pipeline, job, step, triggers, Runner } from '@gitgate/ci';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('build', {
      runner: Runner.ubicloud('standard-4'),
      steps: [step.checkout(), step.run('echo "Configure your build"')],
    }),
  ],
});
`,
};

const CONFIG_TEMPLATE = `import type { GitGateConfig } from 'gg/dist/utils/config.js';

const config = {
  pipelinesDir: '.gitgate/pipelines',
  outputDir: '.github/workflows',
};

export default config;
`;

export async function runInit(cwd: string = process.cwd()): Promise<number> {
  const stack = await detectStack(cwd);
  info(`Detected stack: ${stack}`);

  const pipelinesDir = path.join(cwd, '.gitgate', 'pipelines');
  await fs.mkdir(pipelinesDir, { recursive: true });
  const ciFile = path.join(pipelinesDir, 'ci.ts');
  try {
    await fs.access(ciFile);
    error(`${path.relative(cwd, ciFile)} already exists — refusing to overwrite`);
    return 1;
  } catch {
    // fall through
  }
  await fs.writeFile(ciFile, TEMPLATES[stack], 'utf-8');
  success(`Wrote ${path.relative(cwd, ciFile)}`);

  const cfgFile = path.join(cwd, 'gitgate.config.ts');
  try {
    await fs.access(cfgFile);
  } catch {
    await fs.writeFile(cfgFile, CONFIG_TEMPLATE, 'utf-8');
    success(`Wrote ${path.relative(cwd, cfgFile)}`);
  }

  info('Next: install @gitgate/ci as a devDependency, then run `gg ci compile`.');
  return 0;
}
