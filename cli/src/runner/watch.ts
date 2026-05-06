/**
 * Watch mode — re-run a workflow whenever .yml / .ts files change.
 *
 * Coalesces bursts of fs events; cancels an in-flight re-run if a new
 * change arrives mid-run. Stays foreground so the CLI exits with Ctrl-C.
 */
import { watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pc from 'picocolors';
import { run } from './orchestrator.js';
import type { RunOptions } from './types.js';

const WATCH_EXTENSIONS = ['.yml', '.yaml', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'];
const DEBOUNCE_MS = 150;

export async function watchWorkflow(options: RunOptions): Promise<void> {
  const wfPath = resolve(process.cwd(), options.workflowPath);
  const cwd = options.cwd ?? deriveRoot(wfPath);

  let running = false;
  let queued = false;
  let debounceTimer: NodeJS.Timeout | undefined;

  async function trigger(reason: string): Promise<void> {
    if (running) {
      queued = true;
      console.log(pc.gray(`  (re-run queued: ${reason})`));
      return;
    }
    running = true;
    console.log('\n' + pc.bold(pc.cyan(`▶ ${reason}`)) + ' ' + pc.gray(new Date().toLocaleTimeString()));
    try {
      await run({ ...options, workflowPath: wfPath, cwd });
    } catch (err) {
      console.error(pc.red(`✗ ${(err as Error).message}`));
    } finally {
      running = false;
      if (queued) { queued = false; await trigger('queued change'); }
    }
  }

  function schedule(reason: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => trigger(reason), DEBOUNCE_MS);
  }

  // Initial run.
  await trigger('initial run');

  console.log(pc.gray('\nwatching for changes (Ctrl-C to stop)…'));

  const watcher = watch(cwd, { recursive: true, persistent: true }, (_event, filename) => {
    if (!filename) return;
    const fname = filename.toString();
    // Ignore our own outputs and git internals
    if (fname.includes('.runner') || fname.includes('node_modules') || fname.includes('.git/') || fname.includes('dist/')) return;
    if (!WATCH_EXTENSIONS.some((ext) => fname.endsWith(ext))) return;
    schedule(`${fname} changed`);
  });

  // Block forever; Ctrl-C exits the process.
  process.on('SIGINT', () => { watcher.close(); process.exit(0); });
  return new Promise(() => { /* never resolves */ });
}

function deriveRoot(workflowPath: string): string {
  const norm = dirname(workflowPath).replace(/\\/g, '/');
  if (norm.endsWith('/.github/workflows')) return dirname(dirname(dirname(workflowPath)));
  return dirname(workflowPath);
}
