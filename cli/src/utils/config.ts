import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface GitGateConfig {
  pipelinesDir: string;
  outputDir: string;
  apiUrl?: string;
}

const DEFAULTS: GitGateConfig = {
  pipelinesDir: '.gitgate/pipelines',
  outputDir: '.github/workflows',
  apiUrl: 'https://api.gitgate.com',
};

export async function loadConfig(cwd: string = process.cwd()): Promise<GitGateConfig> {
  const candidates = [
    path.join(cwd, 'gitgate.config.ts'),
    path.join(cwd, 'gitgate.config.js'),
    path.join(cwd, 'gitgate.config.mjs'),
  ];
  for (const file of candidates) {
    try {
      await fs.access(file);
      const mod = (await import(pathToFileURL(file).href)) as { default?: Partial<GitGateConfig> };
      const cfg = mod.default ?? {};
      return { ...DEFAULTS, ...cfg };
    } catch {
      // try next candidate
    }
  }
  return DEFAULTS;
}

export async function readAuthToken(): Promise<string | null> {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  const file = path.join(home, '.gitgate', 'token');
  try {
    return (await fs.readFile(file, 'utf-8')).trim();
  } catch {
    return null;
  }
}
