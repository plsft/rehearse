/**
 * CI pipeline for the node-app example.
 *
 * Demonstrates:
 *   - matrix across [18.x, 20.x, 22.x] — runs in parallel via per-cell
 *     git worktree when executed by @rehearse/runner
 *   - actions/cache for the npm install, keyed on package-lock.json
 *   - upload-artifact for coverage reports
 */
import { hashFiles, job, pipeline, Runner, step, triggers } from '@rehearse/ci';
import { node } from '@rehearse/ci/presets';

export const ci = pipeline('Node app CI', {
  triggers: [
    triggers.pullRequest(),
    triggers.push({ branches: ['main'] }),
  ],
  jobs: [
    job('test', {
      runner: Runner.github('ubuntu-latest'),
      matrix: {
        variables: { 'node-version': ['18.x', '20.x', '22.x'] },
        failFast: false,
      },
      steps: [
        step.checkout(),
        node.setup('${{ matrix.node-version }}'),
        step.cache({
          path: '~/.npm',
          key: `npm-\${{ runner.os }}-${hashFiles('**/package-lock.json')}`,
          restoreKeys: ['npm-${{ runner.os }}-'],
        }),
        node.install(),
        node.test(),
        step.uploadArtifact({
          name: 'coverage-${{ matrix.node-version }}',
          path: 'coverage/',
          ifNoFilesFound: 'warn',
        }),
      ],
    }),
  ],
});
