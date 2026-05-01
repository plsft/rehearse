function nonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}: a non-empty string is required`);
  }
}

/**
 * Reference a repository or organization secret.
 *
 * @example
 * step.run('curl -H "Authorization: Bearer ' + secrets('API_TOKEN') + '"');
 * // → curl -H "Authorization: Bearer ${{ secrets.API_TOKEN }}"
 */
export function secrets(name: string): string {
  nonEmpty(name, 'secrets()');
  return `\${{ secrets.${name} }}`;
}

/**
 * Reference a repository or organization variable.
 *
 * @example
 * vars('DEPLOY_ENV');  // → ${{ vars.DEPLOY_ENV }}
 */
export function vars(name: string): string {
  nonEmpty(name, 'vars()');
  return `\${{ vars.${name} }}`;
}

/**
 * Reference a path on the `github` context (e.g. `event.pull_request.number`).
 *
 * @example
 * github('event.pull_request.number');  // → ${{ github.event.pull_request.number }}
 */
export function github(path: string): string {
  nonEmpty(path, 'github()');
  return `\${{ github.${path} }}`;
}

/**
 * Reference a job-level or step-level environment variable.
 *
 * @example
 * env('NODE_ENV');  // → ${{ env.NODE_ENV }}
 */
export function env(name: string): string {
  nonEmpty(name, 'env()');
  return `\${{ env.${name} }}`;
}

/**
 * Reference an output of an upstream job declared in `needs:`.
 */
export function needs(jobName: string, outputName: string): string {
  nonEmpty(jobName, 'needs()');
  nonEmpty(outputName, 'needs()');
  return `\${{ needs.${jobName}.outputs.${outputName} }}`;
}

/**
 * Reference an output of an earlier step (the step must have an `id`).
 */
export function steps(stepId: string, outputName: string): string {
  nonEmpty(stepId, 'steps()');
  nonEmpty(outputName, 'steps()');
  return `\${{ steps.${stepId}.outputs.${outputName} }}`;
}

/**
 * Wrap an arbitrary GitHub Actions expression in `${{ ... }}`.
 *
 * @example
 * expr("github.ref == 'refs/heads/main'");
 * // → ${{ github.ref == 'refs/heads/main' }}
 */
export function expr(expression: string): string {
  nonEmpty(expression, 'expr()');
  return `\${{ ${expression} }}`;
}

/**
 * Hash a set of files — useful as part of a cache key.
 *
 * @example
 * hashFiles('**\/package-lock.json');
 * // → ${{ hashFiles('**\/package-lock.json') }}
 */
export function hashFiles(...patterns: string[]): string {
  if (patterns.length === 0) {
    throw new Error('hashFiles(): at least one pattern is required');
  }
  for (const p of patterns) nonEmpty(p, 'hashFiles()');
  const inner = patterns.map((p) => `'${p}'`).join(', ');
  return `\${{ hashFiles(${inner}) }}`;
}
