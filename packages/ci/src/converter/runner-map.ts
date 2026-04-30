/**
 * Map common GitHub-hosted runner labels to a constructor expression for the
 * SDK. The right-hand side is emitted as TypeScript source.
 */
export const RUNNER_MAP: Record<string, string> = {
  'ubuntu-latest': "Runner.ubicloud('standard-4')",
  'ubuntu-22.04': "Runner.ubicloud('standard-4')",
  'ubuntu-24.04': "Runner.ubicloud('standard-4')",
  'macos-latest': "Runner.github('macos-latest')",
  'macos-13': "Runner.github('macos-13')",
  'macos-14': "Runner.github('macos-14')",
  'macos-15': "Runner.github('macos-15')",
  'windows-latest': "Runner.github('windows-latest')",
  'windows-2022': "Runner.github('windows-2022')",
};

export function mapRunner(runsOn: string | string[]): string {
  if (Array.isArray(runsOn)) {
    if (runsOn.length === 1) return mapRunner(runsOn[0]!);
    return `Runner.custom(${JSON.stringify(runsOn)})`;
  }
  if (runsOn in RUNNER_MAP) return RUNNER_MAP[runsOn]!;
  if (runsOn.startsWith('ubicloud-')) {
    const size = runsOn.slice('ubicloud-'.length);
    return `Runner.ubicloud(${JSON.stringify(size)})`;
  }
  if (runsOn.startsWith('self-hosted')) {
    return `Runner.selfHosted(${JSON.stringify(runsOn)})`;
  }
  return `Runner.custom(${JSON.stringify(runsOn)})`;
}
