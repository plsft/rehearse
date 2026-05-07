/**
 * Compat scoreboard — nightly + PR gate.
 *
 * The honest-take justification: the strategic decision to NOT use the
 * official GH Actions runner binary (vs redwoodjs/agent-ci) is
 * defensible only if compat with GH Actions semantics stays good. Unit
 * tests can't catch behavioral drift — only running real-world OSS
 * workflows can. This pipeline runs `bench/compat/run.mjs` against a
 * curated fixture list (kleur, typey, changed-files, is-plain-obj) and
 * fails the build if any fixture's expected outcome regresses.
 *
 * Runs on:
 *   - Every PR that touches cli/, ts-ci/, or bench/compat/
 *   - Nightly at 07:00 UTC
 *   - Manually via workflow_dispatch with optional `cli` input
 *
 * Gating semantics: any fixture failing its `expected` outcome is a
 * red CI run. Add a fixture (don't loosen one) when reality changes.
 */
import { Runner, job, pipeline, step, triggers } from '@rehearse/ci';

export const compat = pipeline('Compat scoreboard', {
  triggers: [
    triggers.pullRequest({ paths: ['cli/**', 'ts-ci/**', 'bench/compat/**'] }),
    triggers.schedule('0 7 * * *'), // 07:00 UTC nightly
    triggers.workflowDispatch({
      inputs: {
        cli: {
          description: 'CLI package spec to test (default = published @latest)',
          required: false,
          default: '@rehearse/cli@latest',
          type: 'string',
        },
      },
    }),
  ],
  permissions: { contents: 'read' },
  jobs: [
    job('compat', {
      runner: Runner.github('ubuntu-latest'),
      timeoutMinutes: 20,
      steps: [
        step.checkout(),
        step.action('actions/setup-node@v4', {
          with: { 'node-version': '22' },
          name: 'Setup Node 22',
        }),
        step.run(
          'node bench/compat/run.mjs --cli "${{ github.event.inputs.cli || \'@rehearse/cli@latest\' }}"',
          { name: 'Run compat scoreboard' },
        ),
        step.action('actions/upload-artifact@v4', {
          name: 'Upload results',
          condition: 'always()',
          with: {
            name: 'compat-results',
            path: 'bench/compat/results.json',
          },
        }),
      ],
    }),
  ],
});
