/**
 * Local-fs artifact store, mirroring the contract of
 * `actions/upload-artifact@v4` / `actions/download-artifact@v4`.
 *
 * Layout under `<cwd>/.runner/artifacts/`:
 *   <name>/index.json    — { paths: ['dist/foo.js', 'dist/bar.js'] }
 *   <name>/files/...     — copies of the original files, preserving
 *                          relative paths from cwd (or basename for
 *                          paths outside cwd)
 *
 * Operations match the action's CLI surface enough that real workflows
 * (lint job uploads `dist/`, deploy job downloads it) Just Work.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

interface ArtifactManifest {
  version: 1;
  paths: string[];
  uploadedAt: number;
}

export class LocalArtifacts {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  private dirFor(name: string): string {
    return join(this.root, sanitize(name));
  }

  has(name: string): boolean {
    return existsSync(join(this.dirFor(name), 'index.json'));
  }

  list(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter((n) => existsSync(join(this.root, n, 'index.json')));
  }

  /**
   * Copy `paths` (each relative to `cwd`, or absolute) under
   * `<root>/<name>/files/...`. Glob patterns aren't supported in v1 —
   * just literal files and directories.
   */
  upload(name: string, paths: string[], cwd: string): { paths: string[] } {
    const dir = this.dirFor(name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'files'), { recursive: true });
    const stored: string[] = [];
    for (const p of paths) {
      const src = isAbsolute(p) ? p : resolve(cwd, p);
      if (!existsSync(src)) continue;
      const rel = relative(cwd, src);
      // For files outside cwd, fall back to the basename so we can still cp.
      const pathInArtifact = rel.startsWith('..') ? basename(src) : rel;
      const dest = join(dir, 'files', pathInArtifact);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true });
      stored.push(pathInArtifact);
    }
    const manifest: ArtifactManifest = { version: 1, paths: stored, uploadedAt: Math.floor(Date.now() / 1000) };
    writeFileSync(join(dir, 'index.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    return { paths: stored };
  }

  /**
   * Restore `name` (or all artifacts if `name` undefined) into `targetDir`.
   * Mirrors `download-artifact`: with a name, files land at the same
   * relative paths the upload used. Without a name, each artifact gets
   * a sibling subdirectory under `targetDir`.
   */
  download(name: string | undefined, targetDir: string, cwd: string): { count: number } {
    const target = isAbsolute(targetDir) ? targetDir : resolve(cwd, targetDir);
    mkdirSync(target, { recursive: true });
    if (name) {
      const dir = this.dirFor(name);
      if (!existsSync(dir)) return { count: 0 };
      return { count: copyTree(join(dir, 'files'), target) };
    }
    let count = 0;
    for (const entry of this.list()) {
      const dir = this.dirFor(entry);
      const sub = join(target, entry);
      mkdirSync(sub, { recursive: true });
      count += copyTree(join(dir, 'files'), sub);
    }
    return { count };
  }

  /** Drop everything (for tests). */
  clear(): void {
    rmSync(this.root, { recursive: true, force: true });
    mkdirSync(this.root, { recursive: true });
  }
}

function copyTree(src: string, dst: string): number {
  if (!existsSync(src)) return 0;
  const stat = statSync(src);
  if (stat.isFile()) {
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { force: true });
    return 1;
  }
  let count = 0;
  for (const entry of readdirSync(src)) {
    count += copyTree(join(src, entry), join(dst, entry));
  }
  return count;
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]+/g, '_');
}

/** Parse `with: { path: 'a\nb\nc' }` or `with: { path: ['a', 'b'] }`. */
export function parseArtifactPaths(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String).filter(Boolean);
  if (typeof input !== 'string') return [];
  return input.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
