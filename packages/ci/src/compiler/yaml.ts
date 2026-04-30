/**
 * Minimal YAML serializer tailored for GitHub Actions output.
 * Intentionally narrow — supports the value shapes we emit, nothing more.
 *
 * Rules:
 * - Strings containing `${{` → single-quoted
 * - Strings with YAML-special chars → single-quoted
 * - Booleans / numbers → unquoted
 * - Multiline strings (containing `\n`) → `|` block scalar
 * - null / undefined values → omitted
 * - Empty objects / arrays → omitted
 */

const SPECIAL_CHARS = /[:#{}\[\]'"*&!%`,@>?|]/;
const RESERVED_LITERALS = new Set([
  'true',
  'false',
  'True',
  'False',
  'TRUE',
  'FALSE',
  'null',
  'Null',
  'NULL',
  'yes',
  'no',
  'Yes',
  'No',
  'YES',
  'NO',
  'on',
  'off',
  'On',
  'Off',
  'ON',
  'OFF',
  '~',
  '',
]);

function needsQuoting(s: string): boolean {
  if (s.length === 0) return true;
  if (RESERVED_LITERALS.has(s)) return true;
  if (s.includes('${{')) return true;
  if (SPECIAL_CHARS.test(s)) return true;
  if (/^[\s-]/.test(s)) return true;
  if (/\s$/.test(s)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return true;
  return false;
}

function quoteString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function isMultiline(s: string): boolean {
  return s.includes('\n');
}

function blockScalar(s: string, indent: string): string {
  const lines = s.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const body = lines.map((l) => `${indent}  ${l}`).join('\n');
  return `|\n${body}`;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function serializeScalar(value: unknown, indent: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return quoteString(String(value));
    }
    return String(value);
  }
  if (typeof value === 'string') {
    if (isMultiline(value)) return blockScalar(value, indent);
    if (needsQuoting(value)) return quoteString(value);
    return value;
  }
  return quoteString(String(value));
}

function serializeValue(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    return serializeArray(value, indent);
  }
  if (value !== null && typeof value === 'object') {
    return serializeObject(value as Record<string, unknown>, indent);
  }
  return serializeScalar(value, indent);
}

function serializeArray(arr: unknown[], indent: string): string {
  const items = arr.filter((v) => !isEmpty(v));
  if (items.length === 0) return '[]';
  const lines: string[] = [];
  for (const item of items) {
    if (Array.isArray(item)) {
      const nested = serializeArray(item, `${indent}  `);
      lines.push(`${indent}- ${nested.startsWith('[]') ? '[]' : nested.replace(new RegExp(`^${indent}  `), '')}`);
    } else if (item !== null && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const entries = Object.entries(obj).filter(([, v]) => !isEmpty(v));
      if (entries.length === 0) {
        lines.push(`${indent}- {}`);
        continue;
      }
      const [firstKey, firstVal] = entries[0]!;
      const restEntries = entries.slice(1);
      lines.push(`${indent}- ${serializeKeyValue(firstKey, firstVal, `${indent}  `)}`);
      for (const [k, v] of restEntries) {
        lines.push(`${indent}  ${serializeKeyValue(k, v, `${indent}  `)}`);
      }
    } else {
      lines.push(`${indent}- ${serializeScalar(item, `${indent}  `)}`);
    }
  }
  return lines.join('\n');
}

function serializeKeyValue(key: string, value: unknown, indent: string): string {
  const keyStr = needsKeyQuoting(key) ? quoteString(key) : key;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${keyStr}: []`;
    const arr = serializeArray(value, indent);
    return `${keyStr}:\n${arr}`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => !isEmpty(v));
    if (entries.length === 0) return `${keyStr}: {}`;
    const obj = serializeObject(value as Record<string, unknown>, indent);
    return `${keyStr}:\n${obj}`;
  }
  const scalar = serializeScalar(value, indent);
  if (scalar.startsWith('|')) {
    return `${keyStr}: ${scalar}`;
  }
  return `${keyStr}: ${scalar}`;
}

function needsKeyQuoting(key: string): boolean {
  if (!key) return true;
  if (/^[A-Za-z_][\w-]*$/.test(key)) return false;
  return SPECIAL_CHARS.test(key) || /\s/.test(key);
}

function serializeObject(obj: Record<string, unknown>, indent: string): string {
  const entries = Object.entries(obj).filter(([, v]) => !isEmpty(v));
  if (entries.length === 0) return `${indent}{}`;
  return entries.map(([k, v]) => `${indent}${serializeKeyValue(k, v, indent)}`).join('\n');
}

/** Serialize an object to YAML with 2-space indentation. */
export function toYaml(value: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isEmpty(v)) filtered[k] = v;
  }
  return `${serializeObject(filtered, '')}\n`;
}

export const _internal = {
  needsQuoting,
  quoteString,
  serializeScalar,
  serializeValue,
};
