/**
 * Three-way merge implementation using diff3 algorithm.
 *
 * Strategy: independently diff base→ours and base→theirs, then
 * classify each base line as unchanged/changed-by-ours/changed-by-theirs/
 * changed-by-both. Walk line by line to produce merged output.
 */

import { myersDiff } from './diff.js';

// ============================================================
// Types
// ============================================================

export interface MergeResult {
  content: string;
  hasConflicts: boolean;
  conflicts: MergeConflict[];
}

export interface MergeConflict {
  startLine: number;
  endLine: number;
  oursContent: string;
  theirsContent: string;
  baseContent: string;
}

// ============================================================
// Three-way merge
// ============================================================

/**
 * Perform a three-way merge.
 *
 * For each base line, we track what "ours" and "theirs" did:
 * - kept it unchanged
 * - deleted it
 * - replaced it with different lines
 * - inserted new lines before it
 *
 * Then we combine the two edit scripts into a single output.
 */
export function threeWayMerge(
  base: string,
  ours: string,
  theirs: string,
): MergeResult {
  if (ours === base) return { content: theirs, hasConflicts: false, conflicts: [] };
  if (theirs === base) return { content: ours, hasConflicts: false, conflicts: [] };
  if (ours === theirs) return { content: ours, hasConflicts: false, conflicts: [] };

  const baseLines = splitLines(base);
  const oursLines = splitLines(ours);
  const theirsLines = splitLines(theirs);

  // Build per-base-line edit info for each side
  const oursEdits = buildLineEdits(baseLines, oursLines);
  const theirsEdits = buildLineEdits(baseLines, theirsLines);

  const result: string[] = [];
  const conflicts: MergeConflict[] = [];

  // Process insertions before line 0
  const oursInsertsBefore0 = oursEdits.insertionsBefore.get(0) ?? [];
  const theirsInsertsBefore0 = theirsEdits.insertionsBefore.get(0) ?? [];
  mergeInsertions(oursInsertsBefore0, theirsInsertsBefore0, result, conflicts);

  for (let i = 0; i < baseLines.length; i++) {
    const oursAction = oursEdits.lineActions[i]!;
    const theirsAction = theirsEdits.lineActions[i]!;

    if (oursAction.type === 'keep' && theirsAction.type === 'keep') {
      // Both kept the line
      result.push(baseLines[i]!);
    } else if (oursAction.type === 'keep' && theirsAction.type !== 'keep') {
      // Only theirs changed — take theirs
      if (theirsAction.type === 'replace') {
        result.push(...theirsAction.newLines);
      }
      // If 'delete', we skip the line (theirs deleted it)
    } else if (oursAction.type !== 'keep' && theirsAction.type === 'keep') {
      // Only ours changed — take ours
      if (oursAction.type === 'replace') {
        result.push(...oursAction.newLines);
      }
      // If 'delete', we skip the line
    } else {
      // Both sides changed the same base line
      const oursResult = oursAction.type === 'replace' ? oursAction.newLines : [];
      const theirsResult = theirsAction.type === 'replace' ? theirsAction.newLines : [];

      if (arraysEqual(oursResult, theirsResult)) {
        // Same change — no conflict
        result.push(...oursResult);
      } else {
        // Conflict
        const baseContent = baseLines[i]!;
        const oursText = oursResult.join('\n');
        const theirsText = theirsResult.join('\n');

        conflicts.push({
          startLine: result.length + 1,
          endLine: 0,
          oursContent: oursText,
          theirsContent: theirsText,
          baseContent,
        });

        result.push('<<<<<<< ours');
        result.push(...oursResult);
        result.push('=======');
        result.push(...theirsResult);
        result.push('>>>>>>> theirs');

        conflicts[conflicts.length - 1]!.endLine = result.length;
      }
    }

    // Process insertions after this line (before next line)
    const oursInserts = oursEdits.insertionsBefore.get(i + 1) ?? [];
    const theirsInserts = theirsEdits.insertionsBefore.get(i + 1) ?? [];
    mergeInsertions(oursInserts, theirsInserts, result, conflicts);
  }

  // Process trailing insertions (after last base line)
  // Skip if baseLines is empty — index 0 was already processed above
  if (baseLines.length > 0) {
    const trailing = baseLines.length;
    const oursTrailing = oursEdits.insertionsBefore.get(trailing) ?? [];
    const theirsTrailing = theirsEdits.insertionsBefore.get(trailing) ?? [];
    mergeInsertions(oursTrailing, theirsTrailing, result, conflicts);
  }

  const content = result.join('\n');
  return { content, hasConflicts: conflicts.length > 0, conflicts };
}

// ============================================================
// Line-level edit extraction
// ============================================================

type LineAction =
  | { type: 'keep' }
  | { type: 'delete' }
  | { type: 'replace'; newLines: string[] };

interface LineEdits {
  lineActions: LineAction[];
  // Insertions keyed by the base line index they appear BEFORE
  // e.g., insertionsBefore[3] = lines inserted between base line 2 and 3
  insertionsBefore: Map<number, string[]>;
}

/**
 * Given base and modified, compute what happened to each base line
 * and where new lines were inserted.
 */
function buildLineEdits(baseLines: string[], modifiedLines: string[]): LineEdits {
  const edits = myersDiff(baseLines, modifiedLines);

  const lineActions: LineAction[] = baseLines.map(() => ({ type: 'keep' as const }));
  const insertionsBefore = new Map<number, string[]>();

  // Track which base line we'd insert before
  let currentBasePos = 0;

  for (const edit of edits) {
    if (edit.type === 'equal') {
      currentBasePos = edit.oldIdx! + 1;
    } else if (edit.type === 'delete') {
      lineActions[edit.oldIdx!] = { type: 'delete' };
      currentBasePos = edit.oldIdx! + 1;
    } else if (edit.type === 'insert') {
      // Figure out where to attach this insertion
      const insertAt = currentBasePos;
      const existing = insertionsBefore.get(insertAt) ?? [];
      existing.push(modifiedLines[edit.newIdx!]!);
      insertionsBefore.set(insertAt, existing);
    }
  }

  // Convert adjacent delete+insert into replace
  // Look at each deleted base line — if there are insertions at the same position,
  // combine them into a 'replace' action
  for (let i = 0; i < baseLines.length; i++) {
    if (lineActions[i]!.type === 'delete') {
      const inserts = insertionsBefore.get(i);
      if (inserts && inserts.length > 0) {
        lineActions[i] = { type: 'replace', newLines: [...inserts] };
        insertionsBefore.delete(i);
      }
    }
  }

  return { lineActions, insertionsBefore };
}

// ============================================================
// Merge insertions from both sides
// ============================================================

function mergeInsertions(
  oursInserts: string[],
  theirsInserts: string[],
  result: string[],
  conflicts: MergeConflict[],
): void {
  if (oursInserts.length === 0 && theirsInserts.length === 0) return;

  if (oursInserts.length === 0) {
    result.push(...theirsInserts);
    return;
  }

  if (theirsInserts.length === 0) {
    result.push(...oursInserts);
    return;
  }

  // Both sides inserted at the same position
  if (arraysEqual(oursInserts, theirsInserts)) {
    result.push(...oursInserts);
  } else {
    // Conflict on insertions
    conflicts.push({
      startLine: result.length + 1,
      endLine: 0,
      oursContent: oursInserts.join('\n'),
      theirsContent: theirsInserts.join('\n'),
      baseContent: '',
    });

    result.push('<<<<<<< ours');
    result.push(...oursInserts);
    result.push('=======');
    result.push(...theirsInserts);
    result.push('>>>>>>> theirs');

    conflicts[conflicts.length - 1]!.endLine = result.length;
  }
}

// ============================================================
// Fast-forward detection
// ============================================================

export function canFastForward(baseSha: string, oursSha: string): boolean {
  return baseSha === oursSha;
}

// ============================================================
// Helpers
// ============================================================

function splitLines(content: string): string[] {
  if (content === '') return [];
  return content.split('\n');
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
