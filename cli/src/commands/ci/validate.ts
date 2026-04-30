import { error, success } from '../../utils/output.js';
import { runCompile } from './compile.js';

export async function runValidate(): Promise<number> {
  const code = await runCompile();
  if (code !== 0) {
    error('Validation failed');
    return code;
  }
  success('All pipelines compiled successfully');
  return 0;
}
