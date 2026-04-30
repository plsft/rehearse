import { convert } from '@gitgate/ci';
import fs from 'node:fs/promises';
import path from 'node:path';
import { error, info, success, warn } from '../../utils/output.js';

export async function runConvert(input: string, options: { out?: string } = {}): Promise<number> {
  const cwd = process.cwd();
  let yamlSource: string;
  try {
    yamlSource = await fs.readFile(path.resolve(cwd, input), 'utf-8');
  } catch {
    error(`Could not read ${input}`);
    return 1;
  }
  const baseName = path.basename(input, path.extname(input));
  const outDir = options.out ? path.resolve(cwd, options.out) : path.join(cwd, '.gitgate', 'pipelines');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${baseName}.ts`);

  const result = convert(yamlSource, { exportName: 'workflow' });
  await fs.writeFile(outPath, result.source, 'utf-8');
  success(`Wrote ${path.relative(cwd, outPath)}`);
  for (const w of result.warnings) {
    warn(w);
  }
  info(`Converted ${input} → ${path.relative(cwd, outPath)}`);
  return 0;
}
