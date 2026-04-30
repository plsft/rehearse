/**
 * Git object parsing and serialization.
 *
 * Git objects are stored as: "<type> <size>\0<content>"
 * The SHA-1 hash of this full string (header + content) is the object ID.
 *
 * Object types: blob, tree, commit, tag
 */

// ============================================================
// Types
// ============================================================

export interface GitBlob {
  type: 'blob';
  data: Uint8Array;
}

export interface TreeEntry {
  mode: string;   // e.g. '100644', '040000', '120000', '160000'
  name: string;
  sha: string;    // 40-char hex
}

export interface GitTree {
  type: 'tree';
  entries: TreeEntry[];
}

export interface GitAuthor {
  name: string;
  email: string;
  timestamp: number;  // Unix epoch seconds
  tzOffset: string;   // e.g. '+0000', '-0500'
}

export interface GitCommit {
  type: 'commit';
  treeSha: string;
  parents: string[];
  author: GitAuthor;
  committer: GitAuthor;
  message: string;
  gpgSignature?: string;
}

export interface GitTag {
  type: 'tag';
  objectSha: string;
  objectType: string;
  tagName: string;
  tagger: GitAuthor;
  message: string;
  gpgSignature?: string;
}

export type GitObject = GitBlob | GitTree | GitCommit | GitTag;

// ============================================================
// SHA-1 hashing
// ============================================================

export async function sha1(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function sha1Sync(data: Uint8Array): Promise<string> {
  return sha1(data);
}

// ============================================================
// Encoding helpers
// ============================================================

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encode(str: string): Uint8Array {
  return textEncoder.encode(str);
}

export function decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// Object serialization (object → raw bytes with header)
// ============================================================

export function serializeObject(obj: GitObject): Uint8Array {
  let content: Uint8Array;

  switch (obj.type) {
    case 'blob':
      content = obj.data;
      break;
    case 'tree':
      content = serializeTreeContent(obj.entries);
      break;
    case 'commit':
      content = encode(serializeCommitContent(obj));
      break;
    case 'tag':
      content = encode(serializeTagContent(obj));
      break;
  }

  const header = encode(`${obj.type} ${content.length}\0`);
  return concat(header, content);
}

export function serializeTreeContent(entries: TreeEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => {
    // Git sorts tree entries by name, with directories having a trailing '/'
    const aName = a.mode.startsWith('40') ? a.name + '/' : a.name;
    const bName = b.mode.startsWith('40') ? b.name + '/' : b.name;
    return aName < bName ? -1 : aName > bName ? 1 : 0;
  });

  const parts: Uint8Array[] = [];
  for (const entry of sorted) {
    parts.push(encode(`${entry.mode} ${entry.name}\0`));
    parts.push(hexToBytes(entry.sha));
  }
  return concat(...parts);
}

function serializeCommitContent(commit: GitCommit): string {
  const lines: string[] = [];
  lines.push(`tree ${commit.treeSha}`);
  for (const parent of commit.parents) {
    lines.push(`parent ${parent}`);
  }
  lines.push(`author ${formatAuthor(commit.author)}`);
  lines.push(`committer ${formatAuthor(commit.committer)}`);

  if (commit.gpgSignature) {
    lines.push(`gpgsig ${commit.gpgSignature.split('\n').join('\n ')}`);
  }

  lines.push('');
  lines.push(commit.message);

  return lines.join('\n');
}

function serializeTagContent(tag: GitTag): string {
  const lines: string[] = [];
  lines.push(`object ${tag.objectSha}`);
  lines.push(`type ${tag.objectType}`);
  lines.push(`tag ${tag.tagName}`);
  lines.push(`tagger ${formatAuthor(tag.tagger)}`);

  if (tag.gpgSignature) {
    lines.push(`gpgsig ${tag.gpgSignature.split('\n').join('\n ')}`);
  }

  lines.push('');
  lines.push(tag.message);

  return lines.join('\n');
}

function formatAuthor(author: GitAuthor): string {
  return `${author.name} <${author.email}> ${author.timestamp} ${author.tzOffset}`;
}

// ============================================================
// Object parsing (raw bytes → typed object)
// ============================================================

export function parseObject(raw: Uint8Array): { sha: string; object: GitObject } & { shaPromise: Promise<string> } {
  const nullIdx = raw.indexOf(0);
  if (nullIdx === -1) throw new Error('Invalid git object: no null byte in header');

  const header = decode(raw.subarray(0, nullIdx));
  const spaceIdx = header.indexOf(' ');
  if (spaceIdx === -1) throw new Error('Invalid git object: malformed header');

  const type = header.substring(0, spaceIdx);
  const size = parseInt(header.substring(spaceIdx + 1), 10);
  const content = raw.subarray(nullIdx + 1);

  if (content.length !== size) {
    throw new Error(`Git object size mismatch: header says ${size}, got ${content.length}`);
  }

  const shaPromise = sha1(raw);

  let object: GitObject;
  switch (type) {
    case 'blob':
      object = { type: 'blob', data: content };
      break;
    case 'tree':
      object = { type: 'tree', entries: parseTreeContent(content) };
      break;
    case 'commit':
      object = parseCommitContent(decode(content));
      break;
    case 'tag':
      object = parseTagContent(decode(content));
      break;
    default:
      throw new Error(`Unknown git object type: ${type}`);
  }

  // Return with an empty sha that will be resolved asynchronously
  return { sha: '', object, shaPromise };
}

export async function parseObjectAsync(raw: Uint8Array): Promise<{ sha: string; object: GitObject }> {
  const result = parseObject(raw);
  const sha = await result.shaPromise;
  return { sha, object: result.object };
}

export function parseTreeContent(data: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let pos = 0;

  while (pos < data.length) {
    // Find space separating mode from name
    const spaceIdx = data.indexOf(0x20, pos);
    if (spaceIdx === -1) break;
    const mode = decode(data.subarray(pos, spaceIdx));

    // Find null byte after name
    const nullIdx = data.indexOf(0, spaceIdx + 1);
    if (nullIdx === -1) break;
    const name = decode(data.subarray(spaceIdx + 1, nullIdx));

    // 20 bytes of binary SHA
    const shaBytes = data.subarray(nullIdx + 1, nullIdx + 21);
    const sha = bytesToHex(shaBytes);

    entries.push({ mode, name, sha });
    pos = nullIdx + 21;
  }

  return entries;
}

export function parseCommitContent(content: string): GitCommit {
  const headerEnd = content.indexOf('\n\n');
  const headerSection = headerEnd === -1 ? content : content.substring(0, headerEnd);
  const message = headerEnd === -1 ? '' : content.substring(headerEnd + 2);

  let treeSha = '';
  const parents: string[] = [];
  let author: GitAuthor | undefined;
  let committer: GitAuthor | undefined;
  let gpgSignature: string | undefined;

  const lines = headerSection.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith('tree ')) {
      treeSha = line.substring(5);
    } else if (line.startsWith('parent ')) {
      parents.push(line.substring(7));
    } else if (line.startsWith('author ')) {
      author = parseAuthor(line.substring(7));
    } else if (line.startsWith('committer ')) {
      committer = parseAuthor(line.substring(10));
    } else if (line.startsWith('gpgsig ')) {
      // GPG signature spans multiple lines (continuation lines start with space)
      const sigLines = [line.substring(7)];
      while (i + 1 < lines.length && lines[i + 1]!.startsWith(' ')) {
        i++;
        sigLines.push(lines[i]!.substring(1));
      }
      gpgSignature = sigLines.join('\n');
    }
    i++;
  }

  if (!author || !committer) {
    throw new Error('Invalid commit: missing author or committer');
  }

  return {
    type: 'commit',
    treeSha,
    parents,
    author,
    committer,
    message,
    gpgSignature,
  };
}

function parseTagContent(content: string): GitTag {
  const headerEnd = content.indexOf('\n\n');
  const headerSection = headerEnd === -1 ? content : content.substring(0, headerEnd);
  const message = headerEnd === -1 ? '' : content.substring(headerEnd + 2);

  let objectSha = '';
  let objectType = '';
  let tagName = '';
  let tagger: GitAuthor | undefined;
  let gpgSignature: string | undefined;

  const lines = headerSection.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith('object ')) {
      objectSha = line.substring(7);
    } else if (line.startsWith('type ')) {
      objectType = line.substring(5);
    } else if (line.startsWith('tag ')) {
      tagName = line.substring(4);
    } else if (line.startsWith('tagger ')) {
      tagger = parseAuthor(line.substring(7));
    } else if (line.startsWith('gpgsig ')) {
      const sigLines = [line.substring(7)];
      while (i + 1 < lines.length && lines[i + 1]!.startsWith(' ')) {
        i++;
        sigLines.push(lines[i]!.substring(1));
      }
      gpgSignature = sigLines.join('\n');
    }
    i++;
  }

  if (!tagger) {
    throw new Error('Invalid tag: missing tagger');
  }

  return {
    type: 'tag',
    objectSha,
    objectType,
    tagName,
    tagger,
    message,
    gpgSignature,
  };
}

function parseAuthor(str: string): GitAuthor {
  // Format: "Name <email> timestamp tzoffset"
  const emailStart = str.indexOf('<');
  const emailEnd = str.indexOf('>');
  if (emailStart === -1 || emailEnd === -1) {
    throw new Error(`Invalid author format: ${str}`);
  }

  const name = str.substring(0, emailStart).trim();
  const email = str.substring(emailStart + 1, emailEnd);
  const rest = str.substring(emailEnd + 2).trim().split(' ');
  const timestamp = parseInt(rest[0] ?? '0', 10);
  const tzOffset = rest[1] ?? '+0000';

  return { name, email, timestamp, tzOffset };
}

// ============================================================
// Utility: hash an object without full parsing
// ============================================================

export async function hashObject(type: string, data: Uint8Array): Promise<string> {
  const header = encode(`${type} ${data.length}\0`);
  return sha1(concat(header, data));
}

// ============================================================
// Zlib compress/decompress for loose objects
// ============================================================

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  const writePromise = writer.write(data).then(() => writer.close());

  const chunks: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const result = await reader.read();
    if (result.value) chunks.push(result.value);
    done = result.done;
  }

  await writePromise;
  return concat(...chunks);
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  const writePromise = writer.write(data).then(() => writer.close());

  const chunks: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const result = await reader.read();
    if (result.value) chunks.push(result.value);
    done = result.done;
  }

  await writePromise;
  return concat(...chunks);
}

// Re-export helpers for use in other modules
export { concat, hexToBytes, bytesToHex };
