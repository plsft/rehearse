import pc from 'picocolors';

export function info(msg: string): void {
  process.stderr.write(`${pc.cyan('ℹ')} ${msg}\n`);
}

export function success(msg: string): void {
  process.stderr.write(`${pc.green('✓')} ${msg}\n`);
}

export function warn(msg: string): void {
  process.stderr.write(`${pc.yellow('!')} ${msg}\n`);
}

export function error(msg: string): void {
  process.stderr.write(`${pc.red('✗')} ${msg}\n`);
}

export function dim(msg: string): string {
  return pc.dim(msg);
}

export function bold(msg: string): string {
  return pc.bold(msg);
}

export function table(rows: Array<Record<string, string | number>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const widths = headers.map((h) =>
    Math.max(h.length, ...rows.map((r) => String(r[h] ?? '').length)),
  );
  const headerLine = headers.map((h, i) => pc.bold(h.padEnd(widths[i]!))).join('  ');
  const sep = widths.map((w) => '─'.repeat(w)).join('  ');
  const body = rows
    .map((r) => headers.map((h, i) => String(r[h] ?? '').padEnd(widths[i]!)).join('  '))
    .join('\n');
  return `${headerLine}\n${sep}\n${body}`;
}
