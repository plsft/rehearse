/**
 * `if:` expression that matches PRs where Rehearse has applied any
 * `agent:*` label. Use on a step or job to gate behavior to agent-authored PRs.
 */
export function isAgentAuthored(): string {
  return "contains(github.event.pull_request.labels.*.name, 'agent:')";
}

/**
 * `if:` expression that matches a specific agent provider label
 * (e.g. `agent:claude`, `agent:cursor`).
 */
export function isProvider(provider: string): string {
  if (!provider || !provider.trim()) {
    throw new Error('isProvider(): provider name is required');
  }
  return `contains(github.event.pull_request.labels.*.name, 'agent:${provider}')`;
}
