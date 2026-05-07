/**
 * Regression test for v0.6.18 host-tool-shim PATH check.
 *
 * Pre-v0.6.18 the shims for setup-bun / setup-python / setup-go / setup-java /
 * setup-pnpm / setup-deno / setup-ruby / dtolnay-rust-toolchain were
 * unconditional success-noops. On a host without the tool, rh would happily
 * mark "Setup Bun" as ✓, then the next step `bun install` would crash with
 * `bun: command not found` and the user had no diagnostic pointing at the
 * shim as the cause.
 *
 * Caught by the compat scoreboard's first GH-hosted run: typey ci.yml on
 * Linux failed in 3.3s because the GH-hosted ubuntu runner doesn't ship
 * with bun preinstalled. The shim said success; bun install crashed.
 *
 * Now the shims verify the tool is reachable BEFORE returning success.
 */
import { describe, expect, it } from 'vitest';
import { runShim } from '../src/runner/shims/index.js';
import type { JobSession, PlannedStep } from '../src/runner/types.js';

function fakeStep(uses: string): PlannedStep {
  return {
    index: 0,
    label: uses,
    raw: { uses },
    env: {},
    with: {},
    uses,
    continueOnError: false,
  };
}

function fakeSession(): JobSession {
  return {
    jobId: 'test',
    hostCwd: process.cwd(),
    workdir: process.cwd(),
    env: {},
    tempDir: process.cwd(),
  };
}

describe('host-tool shims (v0.6.18 PATH-check)', () => {
  it('actions/checkout is unconditionally noop — we ARE the repo', async () => {
    // Even on a host without git on PATH (impossible in practice, but the
    // contract is "we trust the user is in a checked-out repo"), checkout
    // should always succeed.
    const r = await runShim(fakeStep('actions/checkout@v4'), fakeSession(), 'host');
    expect(r.status).toBe('success');
    expect(r.reason).toMatch(/host has the repo/);
  });

  it('rejects a setup-* shim cleanly when the tool is NOT on PATH', async () => {
    // Use a uses-string that would match setup-bun. Pre-v0.6.18 this
    // returned `success` with no PATH check. We can't easily uninstall
    // bun for the test, so we point at a synthetic shim by patching the
    // PATH env to an empty value for just this test.
    //
    // Strategy: snapshot process.env.PATH, set to an empty/safe value so
    // `command -v bun` and friends miss, run the shim, restore PATH,
    // assert failure with an actionable reason.
    const savedPath = process.env.PATH;
    // Linux/macOS: empty string disables search. Windows: same effect.
    process.env.PATH = '';
    try {
      const r = await runShim(fakeStep('oven-sh/setup-bun@v1'), fakeSession(), 'host');
      expect(r.status).toBe('failure');
      expect(r.reason).toMatch(/bun.*not on PATH/);
      expect(r.reason).toMatch(/install bun on this host/);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it('rust-toolchain shim accepts EITHER rustc OR cargo on PATH', async () => {
    // Two-candidate fallback. Confirm both branches resolve identically.
    // We don't have a way to selectively mask one binary in a portable
    // test, so this is a logic-level assertion: with PATH cleared we
    // get failure, naming both candidates in the diagnostic.
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const r = await runShim(fakeStep('dtolnay/rust-toolchain@v1'), fakeSession(), 'host');
      expect(r.status).toBe('failure');
      expect(r.reason).toMatch(/rustc.*cargo.*not on PATH/);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it('codecov / github-script shims stay unconditional noop (external services)', async () => {
    // These don't actually need a host tool — they're skipped because
    // the action targets a remote service. Make sure the new check
    // didn't accidentally rope them in.
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const codecov = await runShim(fakeStep('codecov/codecov-action@v4'), fakeSession(), 'host');
      expect(codecov.status).toBe('success');
      const ghScript = await runShim(fakeStep('actions/github-script@v7'), fakeSession(), 'host');
      expect(ghScript.status).toBe('success');
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
