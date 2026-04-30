import { describe, expect, it } from 'vitest';
import { isAgentAuthored, isProvider } from '../../src/agent/index.js';

describe('agent conditions', () => {
  it('isAgentAuthored returns the agent: prefix expression', () => {
    expect(isAgentAuthored()).toBe(
      "contains(github.event.pull_request.labels.*.name, 'agent:')",
    );
  });

  it('isProvider matches a specific provider', () => {
    expect(isProvider('claude')).toBe(
      "contains(github.event.pull_request.labels.*.name, 'agent:claude')",
    );
  });

  it('isProvider rejects empty input', () => {
    expect(() => isProvider('')).toThrow(/provider/);
  });
});
