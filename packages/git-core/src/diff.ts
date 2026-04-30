/**
 * Myers diff algorithm for line-level diffs.
 * Produces unified diff format output.
 *
 * Reference: Eugene W. Myers, "An O(ND) Difference Algorithm and Its Variations"
 */

// ============================================================
// Types
// ============================================================

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
}

export interface DiffStats {
  totalAdditions: number;
  totalDeletions: number;
  changedFiles: number;
}

// ============================================================
// Myers Diff Algorithm
// ============================================================

/**
 * Compute the shortest edit script (SES) between two sequences of lines
 * using the Myers diff algorithm.
 *
 * Returns an array of edit operations: 'equal', 'insert', or 'delete'.
 */
export function myersDiff(
  oldLines: string[],
  newLines: string[],
): Array<{ type: 'equal' | 'insert' | 'delete'; oldIdx?: number; newIdx?: number }> {
  const N = oldLines.length;
  const M = newLines.length;
  const MAX = N + M;

  if (MAX === 0) return [];

  // V[k] = x coordinate of the furthest reaching D-path on diagonal k
  // Offset by MAX to allow negative indices
  const V = new Int32Array(2 * MAX + 1);
  V[MAX + 1] = 0;

  // Trace stores V arrays for each D step (for backtracking)
  const trace: Int32Array[] = [];

  // Forward pass: find shortest edit script length
  let found = false;
  for (let D = 0; D <= MAX; D++) {
    trace.push(V.slice());

    for (let k = -D; k <= D; k += 2) {
      let x: number;

      // Choose whether to go down (insert) or right (delete)
      if (k === -D || (k !== D && V[MAX + k - 1]! < V[MAX + k + 1]!)) {
        x = V[MAX + k + 1]!; // move down (insert from new)
      } else {
        x = V[MAX + k - 1]! + 1; // move right (delete from old)
      }

      let y = x - k;

      // Follow diagonal (equal lines)
      while (x < N && y < M && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }

      V[MAX + k] = x;

      if (x >= N && y >= M) {
        found = true;
        break;
      }
    }

    if (found) break;
  }

  // Backtrack to find the actual edit operations
  const edits: Array<{ type: 'equal' | 'insert' | 'delete'; oldIdx?: number; newIdx?: number }> = [];

  let x = N;
  let y = M;

  for (let D = trace.length - 1; D >= 0; D--) {
    const prevV = trace[D]!;
    const k = x - y;

    let prevK: number;
    if (k === -D || (k !== D && prevV[MAX + k - 1]! < prevV[MAX + k + 1]!)) {
      prevK = k + 1; // came from above (insert)
    } else {
      prevK = k - 1; // came from left (delete)
    }

    const prevX = prevV[MAX + prevK]!;
    const prevY = prevX - prevK;

    // Diagonal moves (equal)
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.unshift({ type: 'equal', oldIdx: x, newIdx: y });
    }

    if (D > 0) {
      if (x === prevX) {
        // Insert
        y--;
        edits.unshift({ type: 'insert', newIdx: y });
      } else {
        // Delete
        x--;
        edits.unshift({ type: 'delete', oldIdx: x });
      }
    }
  }

  return edits;
}

// ============================================================
// Unified Diff Generation
// ============================================================

/**
 * Generate a unified diff between two strings.
 * Returns hunks with context lines (default: 3 lines of context).
 */
export function generateDiffHunks(
  oldContent: string,
  newContent: string,
  contextLines = 3,
): DiffHunk[] {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);

  const edits = myersDiff(oldLines, newLines);

  // Convert edits to diff lines
  const diffLines: DiffLine[] = [];
  for (const edit of edits) {
    switch (edit.type) {
      case 'equal':
        diffLines.push({
          type: 'context',
          content: oldLines[edit.oldIdx!]!,
          oldLineNumber: edit.oldIdx! + 1,
          newLineNumber: edit.newIdx! + 1,
        });
        break;
      case 'delete':
        diffLines.push({
          type: 'remove',
          content: oldLines[edit.oldIdx!]!,
          oldLineNumber: edit.oldIdx! + 1,
        });
        break;
      case 'insert':
        diffLines.push({
          type: 'add',
          content: newLines[edit.newIdx!]!,
          newLineNumber: edit.newIdx! + 1,
        });
        break;
    }
  }

  // Group into hunks with context
  return groupIntoHunks(diffLines, contextLines);
}

/**
 * Generate a complete unified diff string.
 */
export function generateUnifiedDiff(
  oldPath: string,
  newPath: string,
  oldContent: string,
  newContent: string,
  contextLines = 3,
): string {
  const hunks = generateDiffHunks(oldContent, newContent, contextLines);

  if (hunks.length === 0) return '';

  const lines: string[] = [];
  lines.push(`--- a/${oldPath}`);
  lines.push(`+++ b/${newPath}`);

  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    for (const line of hunk.lines) {
      switch (line.type) {
        case 'context':
          lines.push(` ${line.content}`);
          break;
        case 'add':
          lines.push(`+${line.content}`);
          break;
        case 'remove':
          lines.push(`-${line.content}`);
          break;
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Compute diff stats from hunks.
 */
export function computeDiffStats(hunks: DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions++;
      if (line.type === 'remove') deletions++;
    }
  }
  return { additions, deletions };
}

/**
 * Check if content appears to be binary (contains null bytes).
 */
export function isBinaryContent(data: Uint8Array): boolean {
  // Check first 8000 bytes for null bytes (same heuristic as git)
  const checkLen = Math.min(data.length, 8000);
  for (let i = 0; i < checkLen; i++) {
    if (data[i] === 0) return true;
  }
  return false;
}

// ============================================================
// Helpers
// ============================================================

function splitLines(content: string): string[] {
  if (content === '') return [];
  // Split on newlines, preserving empty final line
  return content.split('\n');
}

function groupIntoHunks(diffLines: DiffLine[], contextLines: number): DiffHunk[] {
  // Find change regions (non-context lines)
  const changes: Array<{ start: number; end: number }> = [];
  let inChange = false;
  let changeStart = 0;

  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i]!.type !== 'context') {
      if (!inChange) {
        changeStart = i;
        inChange = true;
      }
    } else if (inChange) {
      changes.push({ start: changeStart, end: i });
      inChange = false;
    }
  }
  if (inChange) {
    changes.push({ start: changeStart, end: diffLines.length });
  }

  if (changes.length === 0) return [];

  // Merge changes that are close together (within 2*contextLines)
  const merged: Array<{ start: number; end: number }> = [changes[0]!];
  for (let i = 1; i < changes.length; i++) {
    const prev = merged[merged.length - 1]!;
    const curr = changes[i]!;
    if (curr.start - prev.end <= 2 * contextLines) {
      prev.end = curr.end;
    } else {
      merged.push(curr);
    }
  }

  // Build hunks with context
  const hunks: DiffHunk[] = [];
  for (const region of merged) {
    const start = Math.max(0, region.start - contextLines);
    const end = Math.min(diffLines.length, region.end + contextLines);

    const hunkLines = diffLines.slice(start, end);

    // Compute old/new start and count
    let oldStart = 0;
    let oldCount = 0;
    let newStart = 0;
    let newCount = 0;

    for (const line of hunkLines) {
      if (line.type === 'context' || line.type === 'remove') {
        if (oldStart === 0 && line.oldLineNumber) oldStart = line.oldLineNumber;
        oldCount++;
      }
      if (line.type === 'context' || line.type === 'add') {
        if (newStart === 0 && line.newLineNumber) newStart = line.newLineNumber;
        newCount++;
      }
    }

    // Default to 1 if we couldn't determine start
    if (oldStart === 0) oldStart = 1;
    if (newStart === 0) newStart = 1;

    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }

  return hunks;
}
