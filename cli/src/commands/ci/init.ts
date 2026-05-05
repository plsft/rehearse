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
  // Bun 1.3+ writes `bun.lock` (text); older Bun used `bun.lockb` (binary).
  // Check both, plus a fallback peek at package.json's packageManager field.
  if (await has('bun.lock')) return 'bun';
  if (await has('bun.lockb')) return 'bun';
  if (await has('package.json')) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')) as {
        packageManager?: string;
      };
      if (pkg.packageManager?.startsWith('bun@')) return 'bun';
    } catch {
      /* not a JSON file; fall through */
    }
  }
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
  bun: `import { pipeline, job, step, triggers, Runner } from '@rehearse/ci';
import { bun } from '@rehearse/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      // bun.build() omitted by default — \`bun init\` doesn't scaffold a
      // build script. Add it back if your package.json has one.
      steps: [step.checkout(), bun.setup(), bun.install(), bun.test()],
    }),
  ],
});
`,
  node: `import { pipeline, job, step, triggers, Runner } from '@rehearse/ci';
import { node } from '@rehearse/ci/presets';

export const ci = pipeline('CI', {
  triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      // node.build() omitted by default — \`npm init -y\` scaffolds no
      // build script. Add it back if your package.json has one.
      steps: [step.checkout(), node.setup('20'), node.install(), node.test()],
    }),
  ],
});
`,
  rust: `import { pipeline, job, step, triggers, Runner } from '@rehearse/ci';
import { rust } from '@rehearse/ci/presets';

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
  go: `import { pipeline, job, step, triggers, Runner } from '@rehearse/ci';
import { go } from '@rehearse/ci/presets';

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
  python: `import { pipeline, job, step, triggers, Runner } from '@rehearse/ci';
import { python } from '@rehearse/ci/presets';

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
  unknown: `import { pipeline, job, step, triggers, Runner } from '@rehearse/ci';

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

// Use .mjs (extension-explicit ESM) so the config loads regardless of the
// host project's package.json `type` field.
const CONFIG_TEMPLATE = `// rehearse.config.mjs
export default {
  pipelinesDir: '.rehearse/pipelines',
  outputDir: '.github/workflows',
};
`;

// Drop a tiny package.json inside .rehearse/ that scopes ESM resolution to
// the pipelines subtree. This way the user's root project can stay CJS
// (or unset) and the .ts pipeline files still import cleanly under tsx.
const PIPELINES_PACKAGE_JSON = `{
  "type": "module"
}
`;

export async function runInit(cwd: string = process.cwd()): Promise<number> {
  const stack = await detectStack(cwd);
  info(`Detected stack: ${stack}`);

  const pipelinesDir = path.join(cwd, '.rehearse', 'pipelines');
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

  // Scope ESM resolution to .rehearse/ so the .ts pipelines compile
  // regardless of whether the root project's package.json sets type:module.
  const pkgJsonFile = path.join(cwd, '.rehearse', 'package.json');
  try {
    await fs.access(pkgJsonFile);
  } catch {
    await fs.writeFile(pkgJsonFile, PIPELINES_PACKAGE_JSON, 'utf-8');
    success(`Wrote ${path.relative(cwd, pkgJsonFile)}`);
  }

  const cfgFile = path.join(cwd, 'rehearse.config.mjs');
  try {
    await fs.access(cfgFile);
  } catch {
    await fs.writeFile(cfgFile, CONFIG_TEMPLATE, 'utf-8');
    success(`Wrote ${path.relative(cwd, cfgFile)}`);
  }

  info('Next: install @rehearse/ci as a devDependency, then run `rh ci compile`.');
  return 0;
}
