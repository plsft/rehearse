/**
 * CI pipeline for the composite-action-demo example.
 *
 * Uses the local composite action at ./.github/actions/setup-deps to
 * bundle setup-node + cache + npm-ci into one logical step. The runner
 * inlines the composite's inner steps at execution time, with
 * ${{ inputs.* }} substituted from the parent's `with:`.
 */
import { job, pipeline, Runner, step, triggers } from '@gitgate/ci';

export const ci = pipeline('Composite action demo', {
  triggers: [
    triggers.pullRequest(),
    triggers.push({ branches: ['main'] }),
  ],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
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
