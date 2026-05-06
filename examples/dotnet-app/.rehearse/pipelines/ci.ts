/**
 * CI pipeline for the dotnet-app example.
 *
 * Demonstrates:
 *   - actions/setup-dotnet@v4 — real shim in @rehearse/cli. Uses host
 *     `dotnet` if present at the right version; otherwise runs Microsoft's
 *     dotnet-install.sh and caches the SDK to ~/.dotnet/. On Pro VMs the
 *     SDK persists across runs (~7ms cached vs ~16s first install).
 *   - matrix across [net8.0, net9.0, net10.0] — runs in parallel via
 *     per-cell git worktree
 *   - dotnet restore / build / test pipeline with coverlet coverage
 *   - upload-artifact for the TRX test results per matrix cell
 *   - actions/cache for the NuGet packages directory
 */
import { hashFiles, job, pipeline, Runner, step, triggers } from '@rehearse/ci';

export const ci = pipeline('dotnet app CI', {
  triggers: [
    triggers.pullRequest(),
    triggers.push({ branches: ['main'] }),
  ],
  jobs: [
    job('test', {
      runner: Runner.github('ubuntu-latest'),
      matrix: {
        variables: { framework: ['net8.0', 'net9.0', 'net10.0'] },
        failFast: false,
      },
      env: {
        DOTNET_NOLOGO: 'true',
        DOTNET_CLI_TELEMETRY_OPTOUT: 'true',
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: 'true',
      },
      steps: [
        step.checkout(),

        step.action('actions/setup-dotnet@v4', {
          name: 'Setup .NET',
          with: {
            'dotnet-version': '8.0.x\n9.0.x\n10.0.x',
          },
        }),

        step.cache({
          path: '~/.nuget/packages',
          key: `nuget-\${{ runner.os }}-${hashFiles('**/*.csproj', '**/global.json')}`,
          restoreKeys: ['nuget-${{ runner.os }}-'],
        }),

        step.run('dotnet restore MyApp.sln', { name: 'Restore' }),

        step.run('dotnet build MyApp.sln --no-restore --configuration Release --framework ${{ matrix.framework }}', {
          name: 'Build (${{ matrix.framework }})',
        }),

        step.run('dotnet test MyApp.sln --no-build --configuration Release --framework ${{ matrix.framework }} --logger "trx;LogFileName=test-results.trx" --results-directory ./TestResults --collect:"XPlat Code Coverage"', {
          name: 'Test (${{ matrix.framework }})',
        }),

        step.uploadArtifact({
          name: 'test-results-${{ matrix.framework }}',
          path: 'TestResults/',
          ifNoFilesFound: 'warn',
        }),
      ],
    }),
  ],
});
