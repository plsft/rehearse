import type { Step } from '../types.js';

export interface CoverageGateOptions {
  minCoverage: number;
  maxCoverageDecrease?: number;
  summaryPath?: string;
}

/**
 * A step that reads a `coverage-summary.json` file (Istanbul format) and
 * fails the job when the line coverage is below `minCoverage`.
 *
 * Optionally enforces that coverage has not decreased by more than
 * `maxCoverageDecrease` percentage points relative to a `coverage-base.json`
 * file in the same directory.
 */
export function coverageGate(options: CoverageGateOptions): Step {
  const summaryPath = options.summaryPath ?? './coverage/coverage-summary.json';
  const min = options.minCoverage;
  const maxDec = options.maxCoverageDecrease;
  const script = [
    'set -euo pipefail',
    `SUMMARY="${summaryPath}"`,
    `MIN=${min}`,
    'if [ ! -f "$SUMMARY" ]; then',
    '  echo "::error::Coverage summary not found at $SUMMARY" >&2',
    '  exit 1',
    'fi',
    'PCT=$(node -e "const s=require(\'./\'+process.argv[1]); console.log(s.total.lines.pct)" "$SUMMARY")',
    'echo "Line coverage: ${PCT}%"',
    'awk "BEGIN { exit !(${PCT} >= ${MIN}) }" || {',
    '  echo "::error::Coverage ${PCT}% is below the required ${MIN}%" >&2',
    '  exit 1',
    '}',
    ...(maxDec !== undefined
      ? [
          `MAX_DEC=${maxDec}`,
          'BASE="./coverage/coverage-base.json"',
          'if [ -f "$BASE" ]; then',
          '  BASE_PCT=$(node -e "const s=require(\'./\'+process.argv[1]); console.log(s.total.lines.pct)" "$BASE")',
          '  awk "BEGIN { exit !(${BASE_PCT} - ${PCT} <= ${MAX_DEC}) }" || {',
          '    echo "::error::Coverage decreased by more than ${MAX_DEC} points (was ${BASE_PCT}%, now ${PCT}%)" >&2',
          '    exit 1',
          '  }',
          'fi',
        ]
      : []),
  ].join('\n');
  return {
    name: 'Coverage gate',
    run: script,
    shell: 'bash',
  };
}
