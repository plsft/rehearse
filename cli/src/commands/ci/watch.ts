import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../utils/config.js';
import { error, info } from '../../utils/output.js';
import { runCompile } from './compile.js';

export async function runWatch(): Promise<number> {
  const cwd = process.cwd();
  const cfg = await loadConfig(cwd);
  const dir = path.resolve(cwd, cfg.pipelinesDir);
  if (!fs.existsSync(dir)) {
    error(`Pipelines directory not found: ${dir}`);
    return 1;
  }
  info(`Watching ${cfg.pipelinesDir} for changes (Ctrl-C to stop)`);
  await runCompile();
  let scheduled = false;
  fs.watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    if (!filename.endsWith('.ts') && !filename.endsWith('.js')) return;
    if (scheduled) return;
    scheduled = true;
    setTimeout(async () => {
      scheduled = false;
      info(`Change detected: ${filename}`);
      await runCompile();
    }, 100);
  });
  return await new Promise(() => 0);
}
