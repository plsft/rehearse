import type { Step } from '../types.js';

/**
 * Emit a provenance event to the Rehearse Platform API. Best-effort: failures
 * do not break the job (`continue-on-error: true`).
 *
 * The step expects `secrets.REHEARSE_TOKEN` to be configured.
 */
export function provenanceEvent(eventType: string, data: Record<string, unknown> = {}): Step {
  if (!eventType || !eventType.trim()) {
    throw new Error('provenanceEvent(): eventType is required');
  }
  const payload = {
    type: eventType,
    pr: '${{ github.event.pull_request.number }}',
    repo: '${{ github.repository }}',
    sha: '${{ github.sha }}',
    runId: '${{ github.run_id }}',
    actor: '${{ github.actor }}',
    data,
  };
  const body = JSON.stringify(payload).replace(/'/g, "'\\''");
  const script = [
    'set -e',
    `curl -sS -X POST https://api.rehearse.sh/v1/provenance/events \\`,
    `  -H "Authorization: Bearer \${{ secrets.REHEARSE_TOKEN }}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${body}' || true`,
  ].join('\n');
  return {
    name: `Provenance: ${eventType}`,
    run: script,
    shell: 'bash',
    continueOnError: true,
  };
}
