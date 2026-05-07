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
  // contents: write so we can commit the latest results.json back to main
  // after each scheduled / dispatched run. The /compat page on rehearse.sh
  // reads it directly via raw.githubusercontent.com — public, no auth,
  // cacheable by Cloudflare. Without the commit step, scoreboard data
  // would only be reachable by clicking into a workflow run and manually
  // downloading the artifact.
  permissions: { contents: 'write' },
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
        // Install the host tools the compat fixtures expect to find on
        // PATH. The rh runner's host-shim path assumes these are
        // installed locally (mirrors a developer's machine running
        // their own workflows); the GH-hosted ubuntu runner doesn't
        // ship them. Pre-v0.6.18 the shim silently lied; v0.6.18 fails
        // loudly when missing — which means the scoreboard runner
        // actually needs them. Add new tools here when fixtures need
        // them, not by softening the assertion.
        step.action('oven-sh/setup-bun@v1', {
          with: { 'bun-version': 'latest' },
          name: 'Install bun (host tool for typey fixture)',
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
        // Commit results.json back to main so the /compat page on
        // rehearse.sh can fetch it from raw.githubusercontent.com without
        // needing GH auth. Skipped on PR runs (the PR head isn't main),
        // skipped if the file didn't actually change (avoids commit-loop
        // noise on nights where every fixture stays at its previous score).
        // [skip ci] in the message keeps the commit from re-triggering
        // any of our workflows.
        step.run(
          [
            'set -euo pipefail',
            'if [ "${{ github.event_name }}" = "pull_request" ]; then',
            '  echo "skipping commit on PR run"',
            '  exit 0',
            'fi',
            'if git diff --quiet bench/compat/results.json; then',
            '  echo "results.json unchanged — nothing to commit"',
            '  exit 0',
            'fi',
            'git config user.name "rehearse-bot"',
            'git config user.email "bot@rehearse.sh"',
            'git add bench/compat/results.json',
            'git commit -m "compat: nightly results $(jq -r .ran_at bench/compat/results.json) [skip ci]"',
            'git push',
          ].join('\n'),
          {
            name: 'Commit results to main (so /compat can read it)',
            condition: 'always()',
          },
        ),
      ],
    }),
  ],
});
