import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectGitContext, normalizeRemoteUrl, redactToken } from '../src/runner/remote.js';

describe('normalizeRemoteUrl', () => {
  it('converts SCP-style SSH to HTTPS', () => {
    expect(normalizeRemoteUrl('git@github.com:honojs/hono.git')).toBe(
      'https://github.com/honojs/hono.git',
    );
  });
  it('converts ssh:// URL to HTTPS', () => {
    expect(normalizeRemoteUrl('ssh://git@github.com/honojs/hono.git')).toBe(
      'https://github.com/honojs/hono.git',
    );
  });
  it('strips ssh:// port number when present', () => {
    expect(normalizeRemoteUrl('ssh://git@gitlab.example.com:2222/team/repo.git')).toBe(
      'https://gitlab.example.com/team/repo.git',
    );
  });
  it('passes HTTPS URLs through unchanged', () => {
    expect(normalizeRemoteUrl('https://github.com/honojs/hono.git')).toBe(
      'https://github.com/honojs/hono.git',
    );
  });
});

describe('redactToken', () => {
  it('replaces embedded user:token@ with ***@', () => {
    expect(redactToken('https://x-access-token:gho_abc123@github.com/o/r.git')).toBe(
      'https://***@github.com/o/r.git',
    );
  });
  it('passes URLs without credentials through unchanged', () => {
    expect(redactToken('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
  });
});

describe('detectGitContext', () => {
  let dir: string;
  const originalRepoToken = process.env.REHEARSE_REPO_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;
  const originalGithubToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    delete process.env.REHEARSE_REPO_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    dir = mkdtempSync(join(tmpdir(), 'rh-git-ctx-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalRepoToken !== undefined) process.env.REHEARSE_REPO_TOKEN = originalRepoToken;
    if (originalGhToken !== undefined) process.env.GH_TOKEN = originalGhToken;
    if (originalGithubToken !== undefined) process.env.GITHUB_TOKEN = originalGithubToken;
  });

  it('returns nulls for a non-git directory', () => {
    expect(detectGitContext(dir)).toEqual({ repoUrl: null, repoRef: null, repoSubdir: null });
  });

  it('returns repo URL + sha + null subdir from a real git repo at the toplevel', () => {
    execSync('git init -q -b main', { cwd: dir });
    execSync('git remote add origin https://github.com/test/sample.git', { cwd: dir });
    execSync('git config user.email t@t', { cwd: dir });
    execSync('git config user.name t', { cwd: dir });
    writeFileSync(join(dir, 'a'), 'x');
    execSync('git add a && git commit -q -m i', { cwd: dir });

    const ctx = detectGitContext(dir);
    expect(ctx.repoUrl).toBe('https://github.com/test/sample.git');
    expect(ctx.repoRef).toMatch(/^[0-9a-f]{40}$/);
    expect(ctx.repoSubdir).toBeNull();
  });

  it('detects subdir when cwd is below the git toplevel', () => {
    execSync('git init -q -b main', { cwd: dir });
    execSync('git remote add origin https://github.com/test/sample.git', { cwd: dir });
    execSync('git config user.email t@t', { cwd: dir });
    execSync('git config user.name t', { cwd: dir });
    const sub = join(dir, 'examples', 'my-app');
    execSync(`mkdir -p "${sub.replace(/\\/g, '/')}"`, { shell: 'bash' });
    writeFileSync(join(sub, 'pkg.json'), '{}');
    execSync('git add . && git commit -q -m i', { cwd: dir });

    const ctx = detectGitContext(sub);
    expect(ctx.repoUrl).toBe('https://github.com/test/sample.git');
    expect(ctx.repoSubdir).toBe('examples/my-app');
  });

  it('normalizes SSH remote to HTTPS', () => {
    execSync('git init -q -b main', { cwd: dir });
    execSync('git remote add origin git@github.com:test/sample.git', { cwd: dir });
    expect(detectGitContext(dir).repoUrl).toBe('https://github.com/test/sample.git');
  });

  it('embeds REHEARSE_REPO_TOKEN into the URL when set', () => {
    process.env.REHEARSE_REPO_TOKEN = 'gho_secret';
    execSync('git init -q -b main', { cwd: dir });
    execSync('git remote add origin https://github.com/test/sample.git', { cwd: dir });
    const ctx = detectGitContext(dir);
    expect(ctx.repoUrl).toBe('https://x-access-token:gho_secret@github.com/test/sample.git');
    // Sanity: redaction must hide it for logs.
    expect(redactToken(ctx.repoUrl!)).toBe('https://***@github.com/test/sample.git');
  });

  it('falls back to GH_TOKEN, then GITHUB_TOKEN', () => {
    process.env.GH_TOKEN = 'gh_t';
    execSync('git init -q -b main', { cwd: dir });
    execSync('git remote add origin https://github.com/test/sample.git', { cwd: dir });
    expect(detectGitContext(dir).repoUrl).toContain('x-access-token:gh_t@');
  });

  it('returns just the SHA when origin is not set', () => {
    execSync('git init -q -b main', { cwd: dir });
    execSync('git config user.email t@t', { cwd: dir });
    execSync('git config user.name t', { cwd: dir });
    writeFileSync(join(dir, 'a'), 'x');
    execSync('git add a && git commit -q -m i', { cwd: dir });

    const ctx = detectGitContext(dir);
    expect(ctx.repoUrl).toBeNull();
    expect(ctx.repoRef).toMatch(/^[0-9a-f]{40}$/);
  });
});
