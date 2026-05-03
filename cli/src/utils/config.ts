import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface RehearseConfig {
  pipelinesDir: string;
  outputDir: string;
  apiUrl?: string;
}

const DEFAULTS: RehearseConfig = {
  pipelinesDir: '.rehearse/pipelines',
  outputDir: '.github/workflows',
  apiUrl: 'https://api.rehearse.sh',
};

export async function loadConfig(cwd: string = process.cwd()): Promise<RehearseConfig> {
  const candidates = [
    path.join(cwd, 'rehearse.config.ts'),
    path.join(cwd, 'rehearse.config.js'),
    path.join(cwd, 'rehearse.config.mjs'),
  ];
  for (const file of candidates) {
    try {
      await fs.access(file);
      const mod = (await import(pathToFileURL(file).href)) as { default?: Partial<RehearseConfig> };
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
  const file = path.join(home, '.rehearse', 'token');
  try {
    return (await fs.readFile(file, 'utf-8')).trim();
  } catch {
    return null;
  }
}
