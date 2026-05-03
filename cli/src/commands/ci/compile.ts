import { compile, type Pipeline } from '@rehearse/ci';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../utils/config.js';
import { error, info, success } from '../../utils/output.js';

async function listPipelineFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listPipelineFiles(full)));
    } else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js'))) {
      out.push(full);
    }
  }
  return out;
}

export interface CompileFlags {
  cwd?: string;
  outDir?: string;
  pipelinesDir?: string;
}

export async function runCompile(flags: CompileFlags = {}): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const cfg = await loadConfig(cwd);
  const pipelinesDir = path.resolve(cwd, flags.pipelinesDir ?? cfg.pipelinesDir);
  const outDir = path.resolve(cwd, flags.outDir ?? cfg.outputDir);

  let files: string[];
  try {
    files = await listPipelineFiles(pipelinesDir);
  } catch (err) {
    error(`Pipelines directory not found: ${pipelinesDir}`);
    return 1;
  }
  if (files.length === 0) {
    error(`No .ts pipeline files found under ${pipelinesDir}`);
    return 1;
  }

  await fs.mkdir(outDir, { recursive: true });
  let written = 0;
  for (const file of files) {
    const url = pathToFileURL(file).href;
    info(`Compiling ${path.relative(cwd, file)}`);
    const mod = (await import(url)) as Record<string, unknown>;
    const exports = Object.entries(mod).filter(
      ([key, val]) => isPipeline(val) && key !== 'default',
    );
    const candidates: Array<{ key: string; pipeline: Pipeline }> = exports.map(([key, val]) => ({
      key,
      pipeline: val as Pipeline,
    }));
    if (mod.default && isPipeline(mod.default)) {
      candidates.unshift({ key: 'default', pipeline: mod.default as Pipeline });
    }
    if (candidates.length === 0) {
      error(`${file}: no Pipeline export found`);
      return 1;
    }
    for (const { key, pipeline } of candidates) {
      const outName = candidates.length === 1
        ? path.basename(file, path.extname(file))
        : `${path.basename(file, path.extname(file))}-${key}`;
      const outPath = path.join(outDir, `${outName}.yml`);
      const yaml = compile(pipeline, {
        sourcePath: path.relative(cwd, file),
        url: 'https://rehearse.sh/docs/ci-quickstart',
      });
      await fs.writeFile(outPath, yaml, 'utf-8');
      success(`Wrote ${path.relative(cwd, outPath)}`);
      written += 1;
    }
  }
  success(`${written} workflow file${written === 1 ? '' : 's'} compiled`);
  return 0;
}

function isPipeline(val: unknown): val is Pipeline {
  return (
    !!val &&
    typeof val === 'object' &&
    'name' in val &&
    'triggers' in val &&
    'jobs' in val &&
    Array.isArray((val as Pipeline).jobs)
  );
}
