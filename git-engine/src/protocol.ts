/**
 * Git Smart HTTP Protocol implementation.
 *
 * Handles the server side of:
 * - GET /info/refs?service=git-upload-pack (ref advertisement for fetch/clone)
 * - POST /git-upload-pack (packfile generation for fetch/clone)
 * - GET /info/refs?service=git-receive-pack (ref advertisement for push)
 * - POST /git-receive-pack (receive packfile, update refs)
 *
 * Reference: https://git-scm.com/docs/http-protocol
 * Reference: https://git-scm.com/docs/pack-protocol
 */

import { encode, concat } from './objects.js';

// ============================================================
// Types
// ============================================================

export interface Ref {
  name: string;   // e.g. 'refs/heads/main', 'HEAD'
  sha: string;    // 40-char hex
}

export interface RefUpdate {
  oldSha: string; // 40-char hex (0000... for create)
  newSha: string; // 40-char hex (0000... for delete)
  name: string;   // ref name
}

export interface UploadPackRequest {
  wants: string[];     // SHAs the client wants
  haves: string[];     // SHAs the client already has
  done: boolean;
  shallow: string[];
  deepen: number;
  capabilities: string[];
}

export interface ReceivePackRequest {
  commands: RefUpdate[];
  capabilities: string[];
  packfileData: Uint8Array;
}

const ZERO_SHA = '0'.repeat(40);
const FLUSH_PKT = '0000';

// ============================================================
// Pkt-line encoding/decoding
// ============================================================

/**
 * Encode a string as a pkt-line (4-byte hex length prefix + data).
 */
export function pktLine(data: string): Uint8Array {
  const len = data.length + 4;
  const hex = len.toString(16).padStart(4, '0');
  return encode(hex + data);
}

/**
 * Encode a flush packet (0000).
 */
export function pktFlush(): Uint8Array {
  return encode(FLUSH_PKT);
}

/**
 * Encode a delimiter packet (0001) — used in protocol v2.
 */
export function pktDelim(): Uint8Array {
  return encode('0001');
}

/**
 * Parse pkt-lines from a buffer. Returns an array of decoded lines.
 * Flush packets are represented as null.
 */
export function parsePktLines(data: Uint8Array): Array<string | null> {
  const lines: Array<string | null> = [];
  const text = new TextDecoder().decode(data);
  let pos = 0;

  while (pos < text.length) {
    const lenHex = text.substring(pos, pos + 4);
    const len = parseInt(lenHex, 16);

    if (len === 0) {
      // Flush packet
      lines.push(null);
      pos += 4;
      continue;
    }

    if (len === 1) {
      // Delimiter packet
      lines.push(null);
      pos += 4;
      continue;
    }

    if (len < 4) {
      throw new Error(`Invalid pkt-line length: ${len}`);
    }

    const lineData = text.substring(pos + 4, pos + len);
    // Strip trailing newline if present
    lines.push(lineData.endsWith('\n') ? lineData.slice(0, -1) : lineData);
    pos += len;
  }

  return lines;
}

/**
 * Parse pkt-lines from binary data, returning both text lines and
 * the remaining binary data (for packfile extraction).
 */
export function parsePktLinesWithRemainder(data: Uint8Array): {
  lines: Array<string | null>;
  remainder: Uint8Array;
} {
  const lines: Array<string | null> = [];
  let pos = 0;

  while (pos + 4 <= data.length) {
    const lenHex = String.fromCharCode(data[pos]!, data[pos + 1]!, data[pos + 2]!, data[pos + 3]!);
    const len = parseInt(lenHex, 16);

    if (isNaN(len)) {
      // Not a valid pkt-line — remaining data is binary (packfile)
      break;
    }

    if (len === 0) {
      lines.push(null);
      pos += 4;
      continue;
    }

    if (len < 4 || pos + len > data.length) {
      break;
    }

    const lineBytes = data.subarray(pos + 4, pos + len);
    const lineStr = new TextDecoder().decode(lineBytes);
    lines.push(lineStr.endsWith('\n') ? lineStr.slice(0, -1) : lineStr);
    pos += len;
  }

  return { lines, remainder: data.subarray(pos) };
}

/**
 * Parse pkt-lines from binary data without text decoding.
 * Returns raw Uint8Array payloads — essential for sideband packfile
 * extraction where TextDecoder would corrupt binary data.
 * Flush packets are represented as null.
 */
export function parseBinaryPktLines(data: Uint8Array): Array<Uint8Array | null> {
  const lines: Array<Uint8Array | null> = [];
  let pos = 0;

  while (pos + 4 <= data.length) {
    const lenHex = String.fromCharCode(data[pos]!, data[pos + 1]!, data[pos + 2]!, data[pos + 3]!);
    const len = parseInt(lenHex, 16);

    if (isNaN(len)) break;

    if (len === 0) {
      // Flush packet
      lines.push(null);
      pos += 4;
      continue;
    }

    if (len === 1) {
      // Delimiter packet
      lines.push(null);
      pos += 4;
      continue;
    }

    if (len < 4 || pos + len > data.length) break;

    lines.push(data.slice(pos + 4, pos + len));
    pos += len;
  }

  return lines;
}

// ============================================================
// Ref Advertisement (GET /info/refs)
// ============================================================

const DEFAULT_UPLOAD_CAPS = [
  'multi_ack',
  'multi_ack_detailed',
  'thin-pack',
  'side-band',
  'side-band-64k',
  'ofs-delta',
  'shallow',
  'no-progress',
  'include-tag',
  'allow-tip-sha1-in-want',
  'allow-reachable-sha1-in-want',
  'no-done',
  'object-format=sha1',
];

const DEFAULT_RECEIVE_CAPS = [
  'report-status',
  'delete-refs',
  'quiet',
  'atomic',
  'ofs-delta',
  'push-options',
  'object-format=sha1',
];

/**
 * Build the ref advertisement response for GET /info/refs.
 *
 * Format:
 *   pkt-line("# service=git-upload-pack\n")
 *   flush
 *   pkt-line("<sha> <ref>\0<capabilities>\n")  (first ref has caps)
 *   pkt-line("<sha> <ref>\n")                   (subsequent refs)
 *   ...
 *   flush
 */
export function advertiseRefs(
  service: 'git-upload-pack' | 'git-receive-pack',
  refs: Ref[],
  capabilities?: string[],
): Uint8Array {
  const parts: Uint8Array[] = [];

  // Service header
  parts.push(pktLine(`# service=${service}\n`));
  parts.push(pktFlush());

  const caps = capabilities ?? (service === 'git-upload-pack' ? DEFAULT_UPLOAD_CAPS : DEFAULT_RECEIVE_CAPS);
  const capsStr = caps.join(' ');

  if (refs.length === 0) {
    // Empty repo: advertise zero-id with capabilities
    parts.push(pktLine(`${ZERO_SHA} capabilities^{}\0${capsStr}\n`));
  } else {
    // First ref includes capabilities
    const first = refs[0]!;
    parts.push(pktLine(`${first.sha} ${first.name}\0${capsStr}\n`));

    // Remaining refs
    for (let i = 1; i < refs.length; i++) {
      const ref = refs[i]!;
      parts.push(pktLine(`${ref.sha} ${ref.name}\n`));
    }
  }

  parts.push(pktFlush());
  return concat(...parts);
}

// ============================================================
// Upload Pack (POST /git-upload-pack)
// ============================================================

/**
 * Parse a git-upload-pack request body.
 *
 * Client sends:
 *   want <sha> [capabilities]\n
 *   want <sha>\n
 *   ...
 *   have <sha>\n
 *   ...
 *   done\n
 */
export function parseUploadPackRequest(data: Uint8Array): UploadPackRequest {
  const lines = parsePktLines(data);
  const wants: string[] = [];
  const haves: string[] = [];
  const shallow: string[] = [];
  let done = false;
  let deepen = 0;
  let capabilities: string[] = [];

  for (const line of lines) {
    if (line === null) continue; // flush

    if (line.startsWith('want ')) {
      const parts = line.substring(5).split(' ');
      wants.push(parts[0]!);
      // First want line may include capabilities
      if (parts.length > 1) {
        capabilities = parts.slice(1);
      }
    } else if (line.startsWith('have ')) {
      haves.push(line.substring(5));
    } else if (line === 'done') {
      done = true;
    } else if (line.startsWith('shallow ')) {
      shallow.push(line.substring(8));
    } else if (line.startsWith('deepen ')) {
      deepen = parseInt(line.substring(7), 10);
    }
  }

  return { wants, haves, done, shallow, deepen, capabilities };
}

/**
 * Create the response for git-upload-pack.
 * Wraps a packfile in sideband-64k format.
 *
 * If commonShas is provided (client sent 'have' SHAs we recognize),
 * send ACK for the most recent common commit. Otherwise send NAK.
 */
export function createUploadPackResponse(
  packfile: Uint8Array,
  progress?: string,
  commonShas?: string[],
): Uint8Array {
  const parts: Uint8Array[] = [];

  // ACK/NAK based on negotiation
  if (commonShas && commonShas.length > 0) {
    // ACK the first common commit (most recent)
    parts.push(pktLine(`ACK ${commonShas[0]}\n`));
  } else {
    parts.push(pktLine('NAK\n'));
  }

  // Send packfile in sideband-64k (band 1)
  // Maximum sideband data per pkt-line: 65520 - 4 (pkt header) - 1 (band id)
  const MAX_DATA = 65515;
  let offset = 0;
  while (offset < packfile.length) {
    const chunkSize = Math.min(MAX_DATA, packfile.length - offset);
    const chunk = packfile.subarray(offset, offset + chunkSize);

    // pkt-line: 4-byte length + 1-byte band id + data
    const pktLen = 4 + 1 + chunkSize;
    const lenHex = pktLen.toString(16).padStart(4, '0');
    const header = encode(lenHex);
    const band = new Uint8Array([0x01]); // band 1 = packfile data
    parts.push(concat(header, band, chunk));

    offset += chunkSize;
  }

  // Optional progress message on band 2
  if (progress) {
    const progressBytes = encode(progress);
    const pktLen = 4 + 1 + progressBytes.length;
    const lenHex = pktLen.toString(16).padStart(4, '0');
    const header = encode(lenHex);
    const band = new Uint8Array([0x02]); // band 2 = progress
    parts.push(concat(header, band, progressBytes));
  }

  parts.push(pktFlush());
  return concat(...parts);
}

// ============================================================
// Receive Pack (POST /git-receive-pack)
// ============================================================

/**
 * Parse a git-receive-pack request body.
 *
 * Client sends:
 *   <old-sha> <new-sha> <ref-name>\0<capabilities>\n
 *   <old-sha> <new-sha> <ref-name>\n
 *   ...
 *   flush
 *   PACK<packfile data>
 */
export function parseReceivePackRequest(data: Uint8Array): ReceivePackRequest {
  const { lines, remainder } = parsePktLinesWithRemainder(data);

  const commands: RefUpdate[] = [];
  let capabilities: string[] = [];

  for (const line of lines) {
    if (line === null) continue; // flush

    // First command may include capabilities after \0
    const nullIdx = line.indexOf('\0');
    const commandPart = nullIdx >= 0 ? line.substring(0, nullIdx) : line;
    if (nullIdx >= 0) {
      capabilities = line.substring(nullIdx + 1).split(' ').filter(Boolean);
    }

    const parts = commandPart.split(' ');
    if (parts.length >= 3) {
      commands.push({
        oldSha: parts[0]!,
        newSha: parts[1]!,
        name: parts[2]!,
      });
    }
  }

  return { commands, capabilities, packfileData: remainder };
}

/**
 * Create the response for git-receive-pack.
 *
 * Response format:
 *   unpack ok\n (or unpack <error>)
 *   ok <ref>\n (or ng <ref> <error>)
 *   ...
 *   flush
 */
export function createReceivePackResponse(
  unpackResult: 'ok' | string,
  refResults: Array<{ name: string; status: 'ok' | string }>,
): Uint8Array {
  const parts: Uint8Array[] = [];

  parts.push(pktLine(`unpack ${unpackResult}\n`));

  for (const ref of refResults) {
    if (ref.status === 'ok') {
      parts.push(pktLine(`ok ${ref.name}\n`));
    } else {
      parts.push(pktLine(`ng ${ref.name} ${ref.status}\n`));
    }
  }

  parts.push(pktFlush());
  return concat(...parts);
}
