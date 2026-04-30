import { describe, expect, it } from 'vitest';
import { Runner, job, pipeline, step, triggers } from '../../src/index.js';

describe('pipeline()', () => {
  const j = () =>
    job('a', { runner: Runner.ubicloud('standard-2'), steps: [step.run('echo hi')] });

  it('returns a typed Pipeline object', () => {
    const p = pipeline('CI', { triggers: [triggers.push()], jobs: [j()] });
    expect(p.name).toBe('CI');
    expect(p.triggers).toHaveLength(1);
    expect(p.jobs).toHaveLength(1);
  });

  it('throws when name is empty', () => {
    expect(() => pipeline('', { triggers: [triggers.push()], jobs: [j()] })).toThrow(/name/);
  });

  it('throws when no triggers', () => {
    expect(() => pipeline('CI', { triggers: [], jobs: [j()] })).toThrow(/trigger/);
  });

  it('throws when no jobs', () => {
    expect(() => pipeline('CI', { triggers: [triggers.push()], jobs: [] })).toThrow(/job/);
  });
});
