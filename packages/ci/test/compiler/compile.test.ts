import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Runner, compile, job, pipeline, step, triggers } from '../../src/index.js';
import { isAgentAuthored } from '../../src/agent/index.js';
import { node } from '../../src/presets/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');

function compileForSnapshot(name: string, p: ReturnType<typeof pipeline>) {
  return compile(p, { omitHeader: true });
}

function readSnapshot(name: string): string | null {
  const file = path.join(SNAPSHOT_DIR, `${name}.yml`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

function writeSnapshotIfMissing(name: string, content: string): void {
  const file = path.join(SNAPSHOT_DIR, `${name}.yml`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
  }
}

function assertSnapshot(name: string, content: string): void {
  writeSnapshotIfMissing(name, content);
  const expected = readSnapshot(name);
  expect(content.replace(/\r\n/g, '\n')).toBe(expected!.replace(/\r\n/g, '\n'));
}

describe('compile', () => {
  it('basic-ci: simple two-job pipeline', () => {
    const p = pipeline('CI', {
      triggers: [triggers.pullRequest(), triggers.push({ branches: ['main'] })],
      jobs: [
        job('lint', {
          runner: Runner.ubicloud('standard-2'),
          steps: [step.checkout(), node.setup('20'), node.install(), node.lint()],
        }),
        job('test', {
          runner: Runner.ubicloud('standard-4'),
          needs: ['lint'],
          steps: [step.checkout(), node.setup('20'), node.install(), node.test()],
        }),
      ],
    });
    const yaml = compileForSnapshot('basic-ci', p);
    assertSnapshot('basic-ci', yaml);
  });

  it('matrix-build: parallel matrix strategy', () => {
    const p = pipeline('Matrix', {
      triggers: [triggers.pullRequest()],
      jobs: [
        job('test', {
          runner: Runner.ubicloud('standard-2'),
          matrix: {
            variables: { node: ['18', '20', '22'] },
            failFast: false,
          },
          steps: [step.checkout(), node.setup('${{ matrix.node }}'), node.install(), node.test()],
        }),
      ],
    });
    const yaml = compileForSnapshot('matrix-build', p);
    assertSnapshot('matrix-build', yaml);
  });

  it('agent-aware: gates a step on agent label', () => {
    const p = pipeline('Agent CI', {
      triggers: [triggers.pullRequest()],
      jobs: [
        job('test', {
          runner: Runner.ubicloud('standard-4'),
          steps: [
            step.checkout(),
            node.setup('20'),
            node.install(),
            node.test(true),
            {
              ...step.run('echo "Extra agent verification"'),
              condition: isAgentAuthored(),
              name: 'Agent verify',
            },
          ],
        }),
      ],
    });
    const yaml = compileForSnapshot('agent-aware', p);
    assertSnapshot('agent-aware', yaml);
  });

  it('monorepo: jobs with paths filters and outputs', () => {
    const p = pipeline('Monorepo', {
      triggers: [triggers.pullRequest({ paths: ['packages/**'] })],
      jobs: [
        job('detect', {
          runner: Runner.ubicloud('standard-2'),
          outputs: { affected: '${{ steps.affected.outputs.list }}' },
          steps: [step.checkout(), { ...step.run('echo hello'), id: 'affected', name: 'Detect' }],
        }),
        job('build', {
          runner: Runner.ubicloud('standard-4'),
          needs: ['detect'],
          condition: "needs.detect.outputs.affected != ''",
          steps: [step.checkout(), node.setup('20'), node.install(), node.build()],
        }),
      ],
    });
    const yaml = compileForSnapshot('monorepo', p);
    assertSnapshot('monorepo', yaml);
  });

  it('deploy-cloudflare: uses environment + secrets', () => {
    const p = pipeline('Deploy', {
      triggers: [triggers.push({ branches: ['main'] })],
      jobs: [
        job('deploy', {
          runner: Runner.ubicloud('standard-2'),
          environment: 'production',
          permissions: { contents: 'read', idToken: 'write' },
          steps: [
            step.checkout(),
            node.setup('20'),
            node.install(),
            node.build(),
            step.action('cloudflare/wrangler-action@v3', {
              with: { apiToken: '${{ secrets.CLOUDFLARE_API_TOKEN }}' },
              name: 'Deploy to Cloudflare',
            }),
          ],
        }),
      ],
    });
    const yaml = compileForSnapshot('deploy-cloudflare', p);
    assertSnapshot('deploy-cloudflare', yaml);
  });

  it('full-featured: schedule + concurrency + permissions', () => {
    const p = pipeline('Full', {
      triggers: [triggers.pullRequest(), triggers.schedule('0 6 * * *')],
      concurrency: { group: 'full-${{ github.ref }}', cancelInProgress: true },
      permissions: 'read-all',
      env: { CI: 'true' },
      jobs: [
        job('test', {
          runner: Runner.ubicloud('standard-4'),
          timeoutMinutes: 30,
          steps: [step.checkout(), node.setup('20'), node.install(), node.test()],
        }),
      ],
    });
    const yaml = compileForSnapshot('full-featured', p);
    assertSnapshot('full-featured', yaml);
  });
});
