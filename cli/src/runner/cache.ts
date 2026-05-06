/**
 * Local-fs cache — `actions/cache` semantics, hosted on the developer's disk.
 *
 * Layout under <cwd>/.runner/cache/:
 *   index.json          — { entries: [{ key, hash, paths, savedAt }] }
 *   <hash>/<files>      — content. Each entry is a directory containing the
 *                         tarred-from-paths content laid out path-equivalent
 *                         to the originals (rooted at the entry).
 *
 * Resolution rules match GitHub Actions:
 *   - Exact key hit: restore from the entry stored under that key.
 *   - Restore-key hit: longest-prefix match against existing entries; copy
 *     content but DO NOT save under the requested key (caller's save step
 *     does that if it wants to).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export interface CacheEntry {
  key: string;
  hash: string;
  paths: string[];
  savedAt: number;
}

export interface CacheIndex {
  version: 1;
  entries: CacheEntry[];
}

export type CacheHit = 'exact' | 'partial' | 'miss';

export interface ResolveResult {
  hit: CacheHit;
  matchedKey?: string;
  hash?: string;
}

export class LocalCache {
  readonly root: string;
  private indexPath: string;

  constructor(root: string) {
    this.root = root;
    this.indexPath = join(root, 'index.json');
    mkdirSync(root, { recursive: true });
    if (!existsSync(this.indexPath)) {
      this.writeIndex({ version: 1, entries: [] });
    }
  }

  private readIndex(): CacheIndex {
    try { return JSON.parse(readFileSync(this.indexPath, 'utf-8')) as CacheIndex; }
    catch { return { version: 1, entries: [] }; }
  }

  private writeIndex(idx: CacheIndex): void {
    writeFileSync(this.indexPath, JSON.stringify(idx, null, 2), 'utf-8');
  }

  /**
   * Look up a cache entry. Returns the longest-prefix match if no exact key
   * is found and `restoreKeys` are provided.
   */
  resolve(key: string, restoreKeys: string[] = []): ResolveResult {
    const idx = this.readIndex();
    const exact = idx.entries.find((e) => e.key === key);
    if (exact) return { hit: 'exact', matchedKey: exact.key, hash: exact.hash };

    // Longest restore-key prefix wins.
    let best: CacheEntry | undefined;
    let bestLen = -1;
    for (const rk of restoreKeys) {
      for (const e of idx.entries) {
        if (e.key.startsWith(rk) && rk.length > bestLen) {
          best = e;
          bestLen = rk.length;
        }
      }
    }
    if (best) return { hit: 'partial', matchedKey: best.key, hash: best.hash };
    return { hit: 'miss' };
  }

  /**
   * Restore the entry into the workspace. Copies files from the cache
   * directory back to their original paths, relative to `cwd`.
   */
  restore(matchedKey: string, cwd: string): void {
    const idx = this.readIndex();
    const entry = idx.entries.find((e) => e.key === matchedKey);
    if (!entry) return;
    const entryDir = join(this.root, entry.hash);
    if (!existsSync(entryDir)) return;
    for (const p of entry.paths) {
      const src = join(entryDir, sanitize(p));
      const dest = isAbsolute(p) ? p : resolve(cwd, p);
      if (!existsSync(src)) continue;
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true, force: true });
    }
  }

  /**
   * Save the workspace paths under `key`. Skips if an exact key already
   * exists (matches GitHub's "key already exists" semantics — caller's
   * step usually `if: steps.cache.outputs.cache-hit != 'true'`).
   */
  save(key: string, cwd: string, paths: string[]): boolean {
    const idx = this.readIndex();
    if (idx.entries.some((e) => e.key === key)) return false;
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
    const entryDir = join(this.root, hash);
    rmSync(entryDir, { recursive: true, force: true });
    mkdirSync(entryDir, { recursive: true });
    for (const p of paths) {
      const src = isAbsolute(p) ? p : resolve(cwd, p);
      if (!existsSync(src)) continue;
      const dest = join(entryDir, sanitize(p));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true, force: true });
    }
    idx.entries.push({ key, hash, paths, savedAt: Math.floor(Date.now() / 1000) });
    this.writeIndex(idx);
    return true;
  }

  /** Drop everything (used in tests). */
  clear(): void {
    rmSync(this.root, { recursive: true, force: true });
    mkdirSync(this.root, { recursive: true });
    this.writeIndex({ version: 1, entries: [] });
  }

  /** Pretty list — for the CLI's `runner cache ls` subcommand. */
  list(): CacheEntry[] { return this.readIndex().entries; }
}

function sanitize(p: string): string {
  // Collapse leading drive letters / leading slashes so cache dirs are
  // always relative to the cache root.
  return p.replace(/^[A-Za-z]:/, '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
}

/**
 * Parse `actions/cache`'s newline-separated `path:` and `restore-keys:`.
 * Both can be a single string or an array.
 */
export function parsePaths(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String).filter(Boolean);
  if (typeof input !== 'string') return [];
  return input.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Best-effort `hashFiles(...)` substitute used by `key:` interpolation.
 * Hashes file contents (plus a salt of relative paths) into a short hex
 * fingerprint compatible with what GitHub generates.
 */
export function hashFiles(globRoot: string, patterns: string[]): string {
  const hash = createHash('sha256');
  for (const pattern of patterns) {
    const matches = expandSimpleGlob(globRoot, pattern);
    matches.sort();
    for (const file of matches) {
      hash.update(file);
      try { hash.update(readFileSync(file)); } catch { /* skip unreadable */ }
    }
  }
  return hash.digest('hex');
}

function expandSimpleGlob(root: string, pattern: string): string[] {
  // Tiny glob: supports **/<name> and <name> (no other star semantics).
  // Good enough for `**/package-lock.json`-style cache keys; defers to
  // `git ls-files` for anything richer.
  const r = spawnSync('git', ['ls-files', pattern], { cwd: root, encoding: 'utf-8' });
  if (r.status === 0) {
    return r.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((rel) => resolve(root, rel));
  }
  return [];
}
