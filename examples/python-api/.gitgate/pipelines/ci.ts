/**
 * CI pipeline for the python-api example.
 *
 * Demonstrates:
 *   - services: { postgres: ... } — Postgres starts as a service container
 *     on a private Docker network. @gitgate/runner wires `--network-alias
 *     postgres` so the test job reaches it as `postgres:5432`.
 *   - container backend (auto-selected because services: is present)
 *   - actions/cache for pip
 *   - python preset for setup-python + pip install
 *   - The same workflow `act` times out on at 360s. runner runs it in ~12s.
 */
import { hashFiles, job, pipeline, Runner, step, triggers } from '@gitgate/ci';
import { python } from '@gitgate/ci/presets';

export const ci = pipeline('Python API CI', {
  triggers: [
    triggers.pullRequest(),
    triggers.push({ branches: ['main'] }),
  ],
  jobs: [
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      services: {
        postgres: {
          image: 'postgres:16-alpine',
          env: {
            POSTGRES_USER: 'postgres',
            POSTGRES_PASSWORD: 'postgres',
            POSTGRES_DB: 'postgres',
          },
          ports: ['5432:5432'],
          options: '--health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10',
        },
      },
      env: {
        DATABASE_URL: 'postgresql+psycopg://postgres:postgres@postgres:5432/postgres',
      },
      steps: [
        step.checkout(),
        python.setup('3.12'),
        step.cache({
          path: '~/.cache/pip',
          key: `pip-\${{ runner.os }}-${hashFiles('**/requirements.txt')}`,
          restoreKeys: ['pip-${{ runner.os }}-'],
        }),
        step.run('pip install -r requirements.txt', { name: 'Install dependencies' }),
        step.run('pytest', { name: 'Run tests' }),
      ],
    }),
  ],
});
