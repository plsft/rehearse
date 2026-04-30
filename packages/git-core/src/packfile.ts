/**
 * Git packfile parsing and generation.
 *
 * Packfile format:
 *   Header: "PACK" + version (4 bytes) + object count (4 bytes)
 *   Objects: sequence of packed objects
 *   Trailer: 20-byte SHA-1 checksum of everything above
 *
 * Each packed object:
 *   Type+size header (variable-length encoding)
 *   Object types: commit=1, tree=2, blob=3, tag=4, ofs_delta=6, ref_delta=7
 *   Content: zlib-deflated object data (or delta instructions for delta types)
 */

import pako from 'pako';
import { sha1, concat, encode, hexToBytes, bytesToHex, deflate } from './objects.js';

// ============================================================
// Types
// ============================================================

export interface PackObject {
  type: PackObjectType;
  data: Uint8Array;
}

export type PackObjectType = 'commit' | 'tree' | 'blob' | 'tag';

export interface PackedEntry {
  type: number; // raw type number (1-7)
  size: number; // uncompressed size
  data: Uint8Array; // decompressed data (for non-delta, this is the object content)
  offset: number; // byte offset in the packfile
  // For OFS_DELTA
  baseOffset?: number;
  // For REF_DELTA
  baseSha?: string;
}

export interface ResolvedPackObject {
  type: PackObjectType;
  data: Uint8Array;
  sha: string;
}

// Type number constants
const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_BLOB = 3;
const OBJ_TAG = 4;
const OBJ_OFS_DELTA = 6;
const OBJ_REF_DELTA = 7;

const TYPE_NAMES: Record<number, PackObjectType> = {
  [OBJ_COMMIT]: 'commit',
  [OBJ_TREE]: 'tree',
  [OBJ_BLOB]: 'blob',
  [OBJ_TAG]: 'tag',
};

function typeNameToNumber(type: PackObjectType): number {
  switch (type) {
    case 'commit': return OBJ_COMMIT;
    case 'tree': return OBJ_TREE;
    case 'blob': return OBJ_BLOB;
    case 'tag': return OBJ_TAG;
  }
}

// ============================================================
// Packfile Parsing
// ============================================================

export function parsePackHeader(data: Uint8Array): { version: number; count: number } {
  if (data.length < 12) throw new Error('Packfile too short for header');

  const sig = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
  if (sig !== 'PACK') throw new Error(`Invalid packfile signature: ${sig}`);

  const version = readUint32BE(data, 4);
  if (version !== 2 && version !== 3) throw new Error(`Unsupported pack version: ${version}`);

  const count = readUint32BE(data, 8);
  return { version, count };
}

/**
 * Parse all entries from a packfile.
 * Returns raw entries including deltas (not yet resolved).
 */
export function parsePackEntries(data: Uint8Array): PackedEntry[] {
  const { count } = parsePackHeader(data);
  const entries: PackedEntry[] = [];
  let offset = 12; // skip header

  for (let i = 0; i < count; i++) {
    const entryOffset = offset;

    // Read type + size from variable-length header
    let byte = data[offset]!;
    const type = (byte >> 4) & 0x07;
    let size = byte & 0x0f;
    let shift = 4;
    offset++;

    while (byte & 0x80) {
      byte = data[offset]!;
      size |= (byte & 0x7f) << shift;
      shift += 7;
      offset++;
    }

    let baseOffset: number | undefined;
    let baseSha: string | undefined;

    // For OFS_DELTA, read negative offset to base object
    if (type === OBJ_OFS_DELTA) {
      byte = data[offset]!;
      baseOffset = byte & 0x7f;
      offset++;
      while (byte & 0x80) {
        byte = data[offset]!;
        baseOffset = ((baseOffset + 1) << 7) | (byte & 0x7f);
        offset++;
      }
      baseOffset = entryOffset - baseOffset;
    }

    // For REF_DELTA, read 20-byte base SHA
    if (type === OBJ_REF_DELTA) {
      baseSha = bytesToHex(data.subarray(offset, offset + 20));
      offset += 20;
    }

    // Decompress the zlib data
    // We don't know the compressed size, so we try to decompress from the current position
    // and rely on the decompressor to stop at the right point.
    // For simplicity, we try progressively larger windows until decompression succeeds
    // with the expected output size.
    const decompressed = decompressAtOffset(data, offset, size);
    offset += decompressed.compressedSize;

    entries.push({
      type,
      size,
      data: decompressed.data,
      offset: entryOffset,
      ...(baseOffset !== undefined ? { baseOffset } : {}),
      ...(baseSha !== undefined ? { baseSha } : {}),
    });
  }

  return entries;
}

/**
 * Resolve all entries in a packfile to full objects, applying delta chains.
 */
export async function resolvePackfile(
  data: Uint8Array,
  lookupBase?: (sha: string) => Promise<{ type: PackObjectType; data: Uint8Array } | null>,
): Promise<ResolvedPackObject[]> {
  const entries = parsePackEntries(data);

  // Build offset → index map for OFS_DELTA resolution
  const offsetMap = new Map<number, number>();
  for (let i = 0; i < entries.length; i++) {
    offsetMap.set(entries[i]!.offset, i);
  }

  // Resolved objects: index → resolved
  const resolved = new Map<number, { type: PackObjectType; data: Uint8Array }>();

  async function resolveEntry(idx: number): Promise<{ type: PackObjectType; data: Uint8Array }> {
    const cached = resolved.get(idx);
    if (cached) return cached;

    const entry = entries[idx]!;

    if (entry.type >= OBJ_COMMIT && entry.type <= OBJ_TAG) {
      // Non-delta object
      const result = { type: TYPE_NAMES[entry.type]!, data: entry.data };
      resolved.set(idx, result);
      return result;
    }

    if (entry.type === OBJ_OFS_DELTA) {
      const baseIdx = offsetMap.get(entry.baseOffset!);
      if (baseIdx === undefined) throw new Error(`OFS_DELTA base not found at offset ${entry.baseOffset}`);
      const base = await resolveEntry(baseIdx);
      const result = { type: base.type, data: applyDelta(base.data, entry.data) };
      resolved.set(idx, result);
      return result;
    }

    if (entry.type === OBJ_REF_DELTA) {
      // Try to find base in the packfile by SHA
      // First, compute SHAs for all non-delta entries
      let base: { type: PackObjectType; data: Uint8Array } | null = null;

      // Look up from external storage
      if (lookupBase) {
        base = await lookupBase(entry.baseSha!);
      }

      if (!base) {
        throw new Error(`REF_DELTA base not found: ${entry.baseSha}`);
      }

      const result = { type: base.type, data: applyDelta(base.data, entry.data) };
      resolved.set(idx, result);
      return result;
    }

    throw new Error(`Unknown object type: ${entry.type}`);
  }

  const results: ResolvedPackObject[] = [];
  for (let i = 0; i < entries.length; i++) {
    const { type, data: objData } = await resolveEntry(i);
    const header = encode(`${type} ${objData.length}\0`);
    const fullObj = concat(header, objData);
    const objSha = await sha1(fullObj);
    results.push({ type, data: objData, sha: objSha });
  }

  return results;
}

// ============================================================
// Delta application
// ============================================================

/**
 * Apply a git delta instruction stream to a base object.
 *
 * Delta format:
 *   - Source (base) size: variable-length integer
 *   - Target (result) size: variable-length integer
 *   - Instructions: sequence of copy or insert instructions
 *     - Copy: high bit set, followed by offset/size bytes
 *     - Insert: high bit clear, value is the number of literal bytes
 */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let pos = 0;

  // Read base size
  const { value: baseSize, bytesRead: br1 } = readDeltaSize(delta, pos);
  pos += br1;
  if (baseSize !== base.length) {
    throw new Error(`Delta base size mismatch: expected ${baseSize}, got ${base.length}`);
  }

  // Read target size
  const { value: targetSize, bytesRead: br2 } = readDeltaSize(delta, pos);
  pos += br2;

  const result = new Uint8Array(targetSize);
  let resultPos = 0;

  while (pos < delta.length) {
    const cmd = delta[pos]!;
    pos++;

    if (cmd & 0x80) {
      // Copy instruction: copy from base
      let copyOffset = 0;
      let copySize = 0;

      if (cmd & 0x01) { copyOffset = delta[pos]!; pos++; }
      if (cmd & 0x02) { copyOffset |= delta[pos]! << 8; pos++; }
      if (cmd & 0x04) { copyOffset |= delta[pos]! << 16; pos++; }
      if (cmd & 0x08) { copyOffset |= delta[pos]! << 24; pos++; }

      if (cmd & 0x10) { copySize = delta[pos]!; pos++; }
      if (cmd & 0x20) { copySize |= delta[pos]! << 8; pos++; }
      if (cmd & 0x40) { copySize |= delta[pos]! << 16; pos++; }

      if (copySize === 0) copySize = 0x10000;

      result.set(base.subarray(copyOffset, copyOffset + copySize), resultPos);
      resultPos += copySize;
    } else if (cmd > 0) {
      // Insert instruction: literal bytes from delta
      result.set(delta.subarray(pos, pos + cmd), resultPos);
      resultPos += cmd;
      pos += cmd;
    } else {
      throw new Error('Unexpected zero command in delta');
    }
  }

  if (resultPos !== targetSize) {
    throw new Error(`Delta result size mismatch: expected ${targetSize}, got ${resultPos}`);
  }

  return result;
}

function readDeltaSize(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  let byte: number;

  do {
    byte = data[offset + bytesRead]!;
    value |= (byte & 0x7f) << shift;
    shift += 7;
    bytesRead++;
  } while (byte & 0x80);

  return { value, bytesRead };
}

// ============================================================
// Delta Creation
// ============================================================

/**
 * Encode a variable-length size for the delta header.
 * Each byte stores 7 bits of the value; the high bit signals continuation.
 */
function encodeDeltaSize(size: number): Uint8Array {
  const bytes: number[] = [];
  let remaining = size;
  do {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return new Uint8Array(bytes);
}

/**
 * Create a git delta instruction stream that transforms `base` into `target`.
 *
 * Delta format:
 *   - Variable-length encoded base size
 *   - Variable-length encoded target size
 *   - Sequence of copy (0x80 | flags) or insert (count + literal) instructions
 *
 * Copy instructions reference byte ranges in the base object.
 * Insert instructions embed literal bytes from the target.
 *
 * Uses a hash table of 3-byte sequences in the base for fast matching.
 */
export function createDelta(base: Uint8Array, target: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];

  // Write header sizes
  parts.push(encodeDeltaSize(base.length));
  parts.push(encodeDeltaSize(target.length));

  // Build a hash index of 3-byte sequences in the base for fast matching.
  // Maps hash(3-byte-seq) -> list of offsets in base
  const HASH_WINDOW = 3;
  const hashTable = new Map<number, number[]>();

  if (base.length >= HASH_WINDOW) {
    for (let i = 0; i <= base.length - HASH_WINDOW; i++) {
      const h = hashBytes3(base, i);
      let bucket = hashTable.get(h);
      if (!bucket) {
        bucket = [];
        hashTable.set(h, bucket);
      }
      bucket.push(i);
    }
  }

  let targetPos = 0;
  let insertStart = -1; // start of pending insert run in target (-1 = none)

  function flushInsert(end: number): void {
    if (insertStart < 0) return;
    let pos = insertStart;
    while (pos < end) {
      // Insert instruction can encode at most 127 bytes at a time
      const len = Math.min(end - pos, 127);
      const instr = new Uint8Array(1 + len);
      instr[0] = len; // high bit clear = insert
      instr.set(target.subarray(pos, pos + len), 1);
      parts.push(instr);
      pos += len;
    }
    insertStart = -1;
  }

  while (targetPos < target.length) {
    // Try to find a copy match
    let bestOffset = 0;
    let bestLength = 0;

    if (target.length - targetPos >= HASH_WINDOW) {
      const h = hashBytes3(target, targetPos);
      const candidates = hashTable.get(h);
      if (candidates) {
        for (const cand of candidates) {
          // Verify the 3-byte match and extend it
          let matchLen = 0;
          const maxLen = Math.min(base.length - cand, target.length - targetPos, 0xffffff); // copy size max 24 bits
          while (matchLen < maxLen && base[cand + matchLen] === target[targetPos + matchLen]) {
            matchLen++;
          }
          if (matchLen > bestLength) {
            bestOffset = cand;
            bestLength = matchLen;
          }
        }
      }
    }

    // Only use copy if it's at least 4 bytes (otherwise insert is more compact)
    if (bestLength >= 4) {
      // Flush any pending insert data
      flushInsert(targetPos);

      // Encode copy instruction
      parts.push(encodeCopyInstruction(bestOffset, bestLength));
      targetPos += bestLength;
    } else {
      // Accumulate insert data
      if (insertStart < 0) insertStart = targetPos;
      targetPos++;
    }
  }

  // Flush any trailing insert data
  flushInsert(targetPos);

  return concat(...parts);
}

/** Simple hash of 3 consecutive bytes. */
function hashBytes3(data: Uint8Array, offset: number): number {
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16)) >>> 0;
}

/**
 * Encode a copy instruction: 0x80 | offset/size flag bits, followed by
 * the non-zero bytes of offset (up to 4) and size (up to 3).
 */
function encodeCopyInstruction(offset: number, size: number): Uint8Array {
  const bytes: number[] = [];
  let cmd = 0x80;

  // We'll fill in cmd byte at position 0 after computing flags
  bytes.push(0); // placeholder

  if (offset & 0x000000ff) { cmd |= 0x01; bytes.push(offset & 0xff); }
  if (offset & 0x0000ff00) { cmd |= 0x02; bytes.push((offset >> 8) & 0xff); }
  if (offset & 0x00ff0000) { cmd |= 0x04; bytes.push((offset >> 16) & 0xff); }
  if (offset & 0xff000000) { cmd |= 0x08; bytes.push((offset >> 24) & 0xff); }

  // Size: a size of 0x10000 is encoded as size=0 (special case in git)
  if (size !== 0x10000) {
    if (size & 0x0000ff) { cmd |= 0x10; bytes.push(size & 0xff); }
    if (size & 0x00ff00) { cmd |= 0x20; bytes.push((size >> 8) & 0xff); }
    if (size & 0xff0000) { cmd |= 0x40; bytes.push((size >> 16) & 0xff); }
  }

  bytes[0] = cmd;
  return new Uint8Array(bytes);
}

// ============================================================
// Packfile Generation
// ============================================================

/**
 * Generate a packfile from a set of objects.
 *
 * Uses delta compression: objects of the same type are sorted by size and
 * each object is compared against nearby same-type objects to find a good
 * delta base. If the delta is at least 20% smaller than the full object,
 * it is stored using OFS_DELTA encoding; otherwise the full object is stored.
 */
export async function generatePackfile(
  objects: Array<{ type: PackObjectType; data: Uint8Array }>,
): Promise<Uint8Array> {
  // Tag each object with its original index for stable ordering
  const indexed = objects.map((obj, i) => ({ ...obj, origIndex: i }));

  // Sort by type then size (ascending) to group similar objects together
  const typeOrder: Record<PackObjectType, number> = { commit: 0, tree: 1, blob: 2, tag: 3 };
  indexed.sort((a, b) => {
    const typeDiff = typeOrder[a.type] - typeOrder[b.type];
    if (typeDiff !== 0) return typeDiff;
    return a.data.length - b.data.length;
  });

  // For each object, decide whether to delta-encode it.
  // We search among same-type neighbors for a good base (preferring similar size).
  const DELTA_SEARCH_WINDOW = 10;

  interface PackEntry {
    origIndex: number;
    type: PackObjectType;
    data: Uint8Array;
    // If delta-encoded, these are set:
    isDelta: boolean;
    deltaData?: Uint8Array;  // raw delta instruction stream (before deflate)
    baseIdx?: number;        // index in `indexed` of the base object
  }

  const entries: PackEntry[] = indexed.map((obj) => ({
    origIndex: obj.origIndex,
    type: obj.type,
    data: obj.data,
    isDelta: false,
  }));

  // Try to find delta bases. We iterate in reverse so that larger objects
  // are tried as bases for smaller ones (common pattern: small edits to large files).
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const entryType = entry.type;
    let bestDelta: Uint8Array | undefined;
    let bestBaseIdx: number | undefined;
    let bestSaving = 0;

    // Look at PRECEDING same-type objects within the search window.
    // OFS_DELTA requires the base to appear BEFORE the delta in the packfile,
    // so we only search j < i to ensure the base is already written.
    for (let j = Math.max(0, i - DELTA_SEARCH_WINDOW); j < i; j++) {
      if (j === i) continue;
      const candidate = entries[j]!;
      if (candidate.type !== entryType) continue;
      // Don't chain deltas: only use non-delta objects as bases
      if (candidate.isDelta) continue;

      // Skip if the candidate is much smaller (delta would be pointless)
      if (candidate.data.length < entry.data.length * 0.1) continue;

      const delta = createDelta(candidate.data, entry.data);
      const saving = entry.data.length - delta.length;

      // Require at least 20% savings
      if (saving > bestSaving && delta.length < entry.data.length * 0.8) {
        bestDelta = delta;
        bestBaseIdx = j;
        bestSaving = saving;
      }
    }

    if (bestDelta !== undefined && bestBaseIdx !== undefined) {
      entry.isDelta = true;
      entry.deltaData = bestDelta;
      entry.baseIdx = bestBaseIdx;
    }
  }

  // Now write the packfile. We need to track byte offsets of each entry
  // so that OFS_DELTA entries can reference their base by negative offset.
  const parts: Uint8Array[] = [];

  // Header
  const header = new Uint8Array(12);
  header[0] = 0x50; // P
  header[1] = 0x41; // A
  header[2] = 0x43; // C
  header[3] = 0x4b; // K
  writeUint32BE(header, 4, 2); // version 2
  writeUint32BE(header, 8, entries.length);
  parts.push(header);

  let currentOffset = 12;
  const entryOffsets: number[] = new Array(entries.length);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    entryOffsets[i] = currentOffset;

    if (entry.isDelta && entry.deltaData !== undefined && entry.baseIdx !== undefined) {
      // OFS_DELTA encoding
      const baseOffset = entryOffsets[entry.baseIdx]!;
      const negativeOffset = currentOffset - baseOffset;

      // Type+size header: type=6 (OFS_DELTA), size = uncompressed delta size
      const sizeHeader = encodeTypeAndSize(OBJ_OFS_DELTA, entry.deltaData.length);

      // Encode the negative offset (variable-length, MSB encoding)
      const ofsBytes = encodeOfsOffset(negativeOffset);

      // Compress the delta data
      const compressed = await deflate(entry.deltaData);

      parts.push(sizeHeader);
      parts.push(ofsBytes);
      parts.push(compressed);
      currentOffset += sizeHeader.length + ofsBytes.length + compressed.length;
    } else {
      // Full object encoding
      const typeNum = typeNameToNumber(entry.type);
      const sizeHeader = encodeTypeAndSize(typeNum, entry.data.length);
      const compressed = await deflate(entry.data);

      parts.push(sizeHeader);
      parts.push(compressed);
      currentOffset += sizeHeader.length + compressed.length;
    }
  }

  const packWithoutChecksum = concat(...parts);

  // Checksum: SHA-1 of everything
  const checksum = await sha1(packWithoutChecksum);
  const checksumBytes = hexToBytes(checksum);

  return concat(packWithoutChecksum, checksumBytes);
}

/**
 * Encode a negative offset for OFS_DELTA using git's variable-length MSB encoding.
 *
 * The first byte stores the 7 low bits. Each subsequent byte stores 7 more bits
 * with the high bit set, and adds 1 before shifting (to avoid ambiguity).
 * This is the *encoding* side; parsePackEntries already handles decoding.
 */
function encodeOfsOffset(offset: number): Uint8Array {
  const bytes: number[] = [];
  bytes.push(offset & 0x7f);
  offset >>= 7;
  while (offset > 0) {
    offset--; // the decoder does (val + 1) << 7, so we subtract 1 here
    bytes.push(0x80 | (offset & 0x7f));
    offset >>= 7;
  }
  // The encoding is big-endian (MSB first), so reverse
  bytes.reverse();
  return new Uint8Array(bytes);
}

function encodeTypeAndSize(type: number, size: number): Uint8Array {
  const bytes: number[] = [];
  let firstByte = (type << 4) | (size & 0x0f);
  size >>= 4;

  if (size > 0) {
    firstByte |= 0x80;
  }
  bytes.push(firstByte);

  while (size > 0) {
    let byte = size & 0x7f;
    size >>= 7;
    if (size > 0) byte |= 0x80;
    bytes.push(byte);
  }

  return new Uint8Array(bytes);
}

// ============================================================
// Helpers
// ============================================================

function readUint32BE(data: Uint8Array, offset: number): number {
  return (
    ((data[offset]! << 24) |
      (data[offset + 1]! << 16) |
      (data[offset + 2]! << 8) |
      data[offset + 3]!) >>> 0
  );
}

function writeUint32BE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

/**
 * Decompress zlib-deflated data at a given offset in a packfile.
 *
 * Uses pako Inflate in chunked streaming mode to:
 * 1. Correctly stop at the zlib stream boundary (not consuming trailing data)
 * 2. Track exactly how many compressed bytes were consumed
 *
 * Feeds data in chunks and checks `inflator.ended` to detect stream end.
 */
function decompressAtOffset(
  data: Uint8Array,
  offset: number,
  _expectedSize: number,
): { data: Uint8Array; compressedSize: number } {
  const remaining = data.subarray(offset);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inflator = new pako.Inflate() as any;

  // Feed data one byte at a time to detect the exact stream boundary.
  // pako.Inflate sets `ended=true` when the zlib stream is complete.
  let consumed = 0;
  let pos = 0;
  while (pos < remaining.length && !inflator.ended) {
    inflator.push(remaining.subarray(pos, pos + 1), false);
    pos++;

    if (inflator.err && inflator.err !== 0) {
      throw new Error(`Zlib decompression error (${inflator.err}): ${inflator.msg}`);
    }
  }

  consumed = pos;

  const decompressed = inflator.result as Uint8Array;
  if (!decompressed) {
    throw new Error('Zlib decompression produced no output');
  }

  return { data: decompressed, compressedSize: consumed };
}
