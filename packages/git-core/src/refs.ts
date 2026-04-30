/**
 * Git reference management.
 *
 * Handles symbolic ref resolution, ref advertisement formatting,
 * and ref update parsing for the smart HTTP protocol.
 */

// ============================================================
// Types
// ============================================================

export interface RefEntry {
  name: string;
  sha: string;
}

export interface RefUpdateCommand {
  oldSha: string;
  newSha: string;
  refName: string;
}

// ============================================================
// Symbolic Ref Resolution
// ============================================================

/**
 * Resolve a symbolic ref (e.g. HEAD) to the concrete ref it points to.
 *
 * `lookupRef` is a callback that returns the value stored for a given ref name.
 * For a symbolic ref the stored value looks like "ref: refs/heads/main".
 * For a direct ref the stored value is the SHA itself.
 *
 * Returns the final ref name (e.g. "refs/heads/main") or null if the chain
 * cannot be resolved.  Protects against circular references with a depth limit.
 */
export function resolveSymbolicRef(
  refName: string,
  lookupRef: (name: string) => string | null | undefined,
  maxDepth = 10,
): string | null {
  let current = refName;

  for (let depth = 0; depth < maxDepth; depth++) {
    const value = lookupRef(current);
    if (value == null) return null;

    // If the value starts with "ref: " it is symbolic — follow the chain
    if (value.startsWith('ref: ')) {
      current = value.slice(5).trim();
      continue;
    }

    // Otherwise we have reached a concrete ref; return its name
    return current;
  }

  // Exceeded max depth — likely a circular reference
  return null;
}

// ============================================================
// Ref Advertisement Formatting
// ============================================================

/**
 * Format a list of refs and capabilities into the pkt-line-ready advertisement
 * body used by GET /info/refs.
 *
 * Returns an array of advertisement lines (without pkt-line length prefixes).
 * The first line carries capabilities after a NUL byte.
 * An empty refs list produces a single zero-id capabilities line.
 */
export function formatRefAdvertisement(
  refEntries: RefEntry[],
  capabilities: string[] = [],
): string[] {
  const ZERO_SHA = '0'.repeat(40);
  const capsStr = capabilities.join(' ');
  const lines: string[] = [];

  if (refEntries.length === 0) {
    // Empty repo — advertise zero-id with capabilities
    lines.push(`${ZERO_SHA} capabilities^{}\0${capsStr}`);
  } else {
    // First ref carries capabilities after NUL
    const first = refEntries[0]!;
    lines.push(`${first.sha} ${first.name}\0${capsStr}`);

    for (let i = 1; i < refEntries.length; i++) {
      const ref = refEntries[i]!;
      lines.push(`${ref.sha} ${ref.name}`);
    }
  }

  return lines;
}

// ============================================================
// Ref Update Parsing
// ============================================================

/**
 * Parse a single ref-update line from a receive-pack request.
 *
 * Expected format: "<old-sha> <new-sha> <refname>"
 * The line may optionally include capabilities after a NUL byte
 * (which are stripped before parsing).
 *
 * Returns a `RefUpdateCommand` or null if the line cannot be parsed.
 */
export function parseRefUpdate(line: string): RefUpdateCommand | null {
  // Strip capabilities (everything after NUL)
  const nullIdx = line.indexOf('\0');
  const commandPart = nullIdx >= 0 ? line.substring(0, nullIdx) : line;

  const trimmed = commandPart.trim();
  const parts = trimmed.split(' ');

  if (parts.length < 3) return null;

  const oldSha = parts[0]!;
  const newSha = parts[1]!;
  // Ref name may contain spaces in theory, but in practice it won't.
  // Join remaining parts to be safe.
  const refName = parts.slice(2).join(' ');

  // Basic validation: SHAs must be 40 hex chars
  const shaRegex = /^[0-9a-f]{40}$/;
  if (!shaRegex.test(oldSha) || !shaRegex.test(newSha)) return null;
  if (refName.length === 0) return null;

  return { oldSha, newSha, refName };
}

/**
 * Detect whether a ref update represents a create, delete, or update.
 */
export function classifyRefUpdate(cmd: RefUpdateCommand): 'create' | 'delete' | 'update' {
  const ZERO_SHA = '0'.repeat(40);
  if (cmd.oldSha === ZERO_SHA) return 'create';
  if (cmd.newSha === ZERO_SHA) return 'delete';
  return 'update';
}

/**
 * Validate that a ref name follows basic git naming rules.
 *
 * A simplified check — ensures the name starts with "refs/" and does not
 * contain disallowed sequences like "..", "~", "^", ":", or control chars.
 */
export function isValidRefName(refName: string): boolean {
  if (!refName.startsWith('refs/')) return false;
  if (refName.endsWith('/')) return false;
  if (refName.endsWith('.lock')) return false;
  if (refName.includes('..')) return false;
  if (refName.includes('~')) return false;
  if (refName.includes('^')) return false;
  if (refName.includes(':')) return false;
  if (refName.includes('\\')) return false;
  if (refName.includes(' ')) return false;
  // No control characters
  for (let i = 0; i < refName.length; i++) {
    if (refName.charCodeAt(i) < 32 || refName.charCodeAt(i) === 127) return false;
  }
  return true;
}
