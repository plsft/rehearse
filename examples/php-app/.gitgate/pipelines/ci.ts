/**
 * CI pipeline for the php-app example.
 *
 * Demonstrates:
 *   - shivammathur/setup-php@v2 — a JavaScript action (runs.using: node20).
 *     @gitgate/runner auto-clones the action at the requested ref into
 *     .runner/actions/<slug>/ on first use, then executes its main.js
 *     under the standard INPUT_* / GITHUB_OUTPUT contract. No host PHP
 *     pre-install required — the action provisions PHP itself.
 *   - matrix across PHP 8.2 / 8.3 / 8.4 — runs in parallel via per-cell
 *     git worktree
 *   - actions/cache for the Composer cache directory
 *   - PHPStan static analysis + PHPUnit tests
 */
import { hashFiles, job, pipeline, Runner, step, triggers } from '@gitgate/ci';

export const ci = pipeline('PHP app CI', {
  triggers: [
    triggers.pullRequest(),
    triggers.push({ branches: ['main'] }),
  ],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      matrix: {
        variables: { 'php-version': ['8.2', '8.3', '8.4'] },
        failFast: false,
      },
      steps: [
        step.checkout(),

        step.action('shivammathur/setup-php@v2', {
          name: 'Setup PHP ${{ matrix.php-version }}',
          with: {
            'php-version': '${{ matrix.php-version }}',
            extensions: 'mbstring, intl, json, xml',
            tools: 'composer:v2',
            coverage: 'none',
          },
        }),

        step.run('echo "composer-cache-dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT', {
          id: 'composer-cache',
          name: 'Get Composer cache directory',
        }),

        step.cache({
          path: '${{ steps.composer-cache.outputs.composer-cache-dir }}',
          key: `composer-\${{ runner.os }}-\${{ matrix.php-version }}-${hashFiles('**/composer.json')}`,
          restoreKeys: ['composer-${{ runner.os }}-${{ matrix.php-version }}-'],
        }),

        step.run('composer install --no-interaction --no-progress --prefer-dist', {
          name: 'Install Composer dependencies',
        }),

        step.run('composer analyse', { name: 'Static analysis (PHPStan)' }),
        step.run('composer test',    { name: 'Unit tests (PHPUnit)' }),
      ],
    }),
  ],
});
