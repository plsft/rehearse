/**
 * v0.6.16: workflow_dispatch input resolution.
 *
 * Pre-v0.6.16 declared inputs were ignored — `${{ inputs.X }}` collapsed to
 * '' silently. resolveInputs now honors CLI > opts > default > prompt > error
 * and validates choice/boolean/number types.
 */
import { describe, expect, it } from 'vitest';
import { declaredInputs, resolveInputs } from '../src/runner/workflow-inputs.js';
import type { ParsedWorkflow } from '@rehearse/ci';

describe('declaredInputs', () => {
  it('extracts inputs from on.workflow_dispatch.inputs', () => {
    const wf = {
      on: {
        workflow_dispatch: {
          inputs: {
            env: { description: 'target env', type: 'choice', options: ['dev', 'prod'] },
            tag: { description: 'release tag', required: true },
          },
        },
      },
      jobs: {},
    } as unknown as ParsedWorkflow;
    const out = declaredInputs(wf);
    expect(Object.keys(out)).toEqual(['env', 'tag']);
    expect(out.env!.type).toBe('choice');
  });

  it('returns {} for the three "no inputs" shapes (string, array, object-without-dispatch)', () => {
    expect(declaredInputs({ on: 'push', jobs: {} } as unknown as ParsedWorkflow)).toEqual({});
    expect(declaredInputs({ on: ['push', 'pull_request'], jobs: {} } as unknown as ParsedWorkflow)).toEqual({});
    expect(declaredInputs({ on: { push: { branches: ['main'] } }, jobs: {} } as unknown as ParsedWorkflow)).toEqual({});
  });
});

describe('resolveInputs', () => {
  it('CLI override beats default', async () => {
    const out = await resolveInputs({
      declared: { env: { default: 'dev' } },
      provided: { env: 'prod' },
      interactive: false,
    });
    expect(out.env).toBe('prod');
  });

  it('falls back to default when not provided', async () => {
    const out = await resolveInputs({
      declared: { env: { default: 'dev' } },
      provided: {},
      interactive: false,
    });
    expect(out.env).toBe('dev');
  });

  it('optional input with no default resolves to empty string', async () => {
    const out = await resolveInputs({
      declared: { env: { description: 'optional' } },
      provided: {},
      interactive: false,
    });
    expect(out.env).toBe('');
  });

  it('throws on missing required input in non-interactive mode', async () => {
    await expect(
      resolveInputs({
        declared: { tag: { required: true } },
        provided: {},
        interactive: false,
      }),
    ).rejects.toThrow(/missing required.*tag/);
  });

  it('coerces boolean type — accepts true/false, rejects "yes"', async () => {
    const ok = await resolveInputs({
      declared: { dry: { type: 'boolean', required: true } },
      provided: { dry: 'TRUE' },
      interactive: false,
    });
    expect(ok.dry).toBe('true');
    await expect(
      resolveInputs({
        declared: { dry: { type: 'boolean', required: true } },
        provided: { dry: 'yes' },
        interactive: false,
      }),
    ).rejects.toThrow(/must be true\|false/);
  });

  it('coerces choice type — must be in options list', async () => {
    const ok = await resolveInputs({
      declared: { env: { type: 'choice', options: ['dev', 'prod'], required: true } },
      provided: { env: 'prod' },
      interactive: false,
    });
    expect(ok.env).toBe('prod');
    await expect(
      resolveInputs({
        declared: { env: { type: 'choice', options: ['dev', 'prod'], required: true } },
        provided: { env: 'staging' },
        interactive: false,
      }),
    ).rejects.toThrow(/must be one of/);
  });

  it('coerces number type — accepts numeric, rejects non-numeric', async () => {
    const ok = await resolveInputs({
      declared: { count: { type: 'number', required: true } },
      provided: { count: '42' },
      interactive: false,
    });
    expect(ok.count).toBe('42');
    await expect(
      resolveInputs({
        declared: { count: { type: 'number', required: true } },
        provided: { count: 'forty' },
        interactive: false,
      }),
    ).rejects.toThrow(/must be a number/);
  });

  it('mixed bag — multiple inputs with different sources', async () => {
    const out = await resolveInputs({
      declared: {
        env: { type: 'choice', options: ['dev', 'prod'], default: 'dev' },
        tag: { required: true },
        dry: { type: 'boolean', default: false },
      },
      provided: { tag: 'v1.2.3' },
      interactive: false,
    });
    expect(out).toEqual({ env: 'dev', tag: 'v1.2.3', dry: 'false' });
  });
});
