/**
 * Matrix expansion.
 *
 * Implements GitHub's documented algorithm:
 *   1. Cartesian product of all variables (excluding `include` and `exclude`).
 *   2. Apply `exclude`: drop any cell whose key/value pairs all match an exclude.
 *   3. Apply `include`:
 *        a) If the include matches an existing cell on its overlapping keys,
 *           merge into that cell (don't add a new one).
 *        b) Otherwise append it as a new cell.
 */

export type MatrixCell = Record<string, unknown>;

export interface MatrixSpec {
  variables: Record<string, unknown[]>;
  include?: MatrixCell[];
  exclude?: MatrixCell[];
}

export function parseMatrix(matrix: Record<string, unknown> | undefined): MatrixSpec | null {
  if (!matrix) return null;
  const variables: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(matrix)) {
    if (k === 'include' || k === 'exclude') continue;
    if (Array.isArray(v)) variables[k] = v;
  }
  const include = Array.isArray(matrix.include) ? (matrix.include as MatrixCell[]) : undefined;
  const exclude = Array.isArray(matrix.exclude) ? (matrix.exclude as MatrixCell[]) : undefined;
  return { variables, include, exclude };
}

export function expandMatrix(spec: MatrixSpec | null): MatrixCell[] {
  if (!spec) return [{}];
  const keys = Object.keys(spec.variables);
  if (keys.length === 0 && !(spec.include?.length)) return [{}];

  let cells: MatrixCell[] = [{}];
  for (const k of keys) {
    const vs = spec.variables[k]!;
    const next: MatrixCell[] = [];
    for (const cell of cells) {
      for (const v of vs) next.push({ ...cell, [k]: v });
    }
    cells = next;
  }

  if (spec.exclude?.length) {
    cells = cells.filter((cell) => !spec.exclude!.some((ex) => isSubsetMatch(ex, cell)));
  }

  if (spec.include?.length) {
    for (const inc of spec.include) {
      const incKeys = Object.keys(inc);
      const baseKeys = incKeys.filter((k) => keys.includes(k));
      // Find an existing cell whose base-keys all match
      const matchIdx = baseKeys.length === 0
        ? -1
        : cells.findIndex((c) => baseKeys.every((k) => looseEq(c[k], inc[k])));
      if (matchIdx >= 0) {
        cells[matchIdx] = { ...cells[matchIdx], ...inc };
      } else {
        cells.push({ ...inc });
      }
    }
  }

  return cells;
}

function isSubsetMatch(needle: MatrixCell, cell: MatrixCell): boolean {
  for (const [k, v] of Object.entries(needle)) {
    if (!looseEq(cell[k], v)) return false;
  }
  return true;
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  return String(a) === String(b);
}

/** Stable id derived from cell values, suitable for job ids. */
export function cellId(cell: MatrixCell): string {
  const keys = Object.keys(cell).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${slug(String(cell[k]))}`).join(',');
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]+/g, '_');
}
