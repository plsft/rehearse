import { describe, expect, it } from 'vitest';
import { convert } from '../../src/index.js';

const SAMPLE_YAML = `name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
`;

describe('convert', () => {
  it('produces TypeScript that imports from @rehearse/ci', () => {
    const { source } = convert(SAMPLE_YAML);
    expect(source).toContain("from '@rehearse/ci'");
    expect(source).toContain('pipeline');
    expect(source).toContain('triggers.pullRequest');
    expect(source).toContain('triggers.push');
    expect(source).toContain("Runner.ubicloud('standard-4')");
    expect(source).toContain('step.checkout');
    expect(source).toContain('step.run');
  });

  it('emits warnings for unmapped actions', () => {
    const { warnings } = convert(SAMPLE_YAML);
    // setup-node hint
    expect(warnings.some((w) => w.includes('setup-node'))).toBe(true);
  });
});
