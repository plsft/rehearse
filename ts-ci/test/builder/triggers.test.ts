import { describe, expect, it } from 'vitest';
import { triggers } from '../../src/index.js';

describe('triggers', () => {
  it('push with branches', () => {
    const t = triggers.push({ branches: ['main', 'release/*'] });
    expect(t.event).toBe('push');
    expect(t.config).toEqual({ branches: ['main', 'release/*'] });
  });

  it('pullRequest with types', () => {
    const t = triggers.pullRequest({ types: ['opened', 'synchronize'] });
    expect(t.event).toBe('pull_request');
    expect(t.config).toEqual({ types: ['opened', 'synchronize'] });
  });

  it('schedule requires non-empty cron', () => {
    expect(() => triggers.schedule('')).toThrow(/cron/);
    expect(triggers.schedule('0 0 * * *').config).toEqual({ cron: '0 0 * * *' });
  });

  it('workflowDispatch with inputs', () => {
    const t = triggers.workflowDispatch({
      inputs: { env: { description: 'env', required: true, type: 'string' } },
    });
    expect(t.event).toBe('workflow_dispatch');
  });
});
