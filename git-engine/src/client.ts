/**
 * Git Smart HTTP Client — fetch refs and packfiles from remote repositories.
 *
 * Implements the client side of the git smart HTTP protocol:
 * - GET /info/refs?service=git-upload-pack (discover remote refs)
 * - POST /git-upload-pack (fetch objects via packfile)
 *
 * Used by GitHub import and mirror sync to pull objects into GitGate.
 *
 * Reference: https://git-scm.com/docs/http-protocol
 * Reference: https://git-scm.com/docs/pack-protocol
 */

import { encode, decode } from './objects.js';
import { pktLine, pktFlush, parseBinaryPktLines, type Ref } from './protocol.js';

// ============================================================
// Types
// ============================================================

export interface RemoteRefs {
  refs: Ref[];
  capabilities: string[];
}

export interface FetchResult {
  packfile: Uint8Array;
  acks: string[];
}

// Client capabilities to advertise when fetching
const CLIENT_CAPABILITIES = [
  'multi_ack',
  'thin-pack',
  'side-band-64k',
  'ofs-delta',
  'no-progress',
  'include-tag',
  'object-format=sha1',
];

// ============================================================
// Ref Discovery
// ============================================================

/**
 * Fetch and parse the ref advertisement from a remote git repository.
 *
 * Sends GET to {repoUrl}/info/refs?service=git-upload-pack and parses
 * the pkt-line response into structured refs and capabilities.
 */
export async function fetchRemoteRefs(
  repoUrl: string,
  headers?: Record<string, string>,
): Promise<RemoteRefs> {
  const url = `${repoUrl.replace(/\/$/, '')}/info/refs?service=git-upload-pack`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'GitGate/1.0',
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch refs from ${url}: ${response.status} ${response.statusText}`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  return parseRefAdvertisement(data);
}

/**
 * Parse a ref advertisement response into refs and capabilities.
 * Exported for testing — use fetchRemoteRefs() for real fetches.
 */
export function parseRefAdvertisement(data: Uint8Array): RemoteRefs {
  const pktLines = parseBinaryPktLines(data);
  const refs: Ref[] = [];
  let capabilities: string[] = [];
  let pastServiceHeader = false;

  for (const line of pktLines) {
    if (line === null) {
      // Flush — marks end of service header or end of refs
      pastServiceHeader = true;
      continue;
    }

    const text = decode(line);

    // Skip the "# service=git-upload-pack" header line
    if (text.startsWith('# service=')) continue;

    if (!pastServiceHeader) continue;

    // Parse ref line: "<sha> <refname>\0<caps>" or "<sha> <refname>"
    const nullIdx = text.indexOf('\0');
    const refPart = nullIdx >= 0 ? text.substring(0, nullIdx) : text;
    const trimmed = refPart.endsWith('\n') ? refPart.slice(0, -1) : refPart;

    // Extract capabilities from first ref line
    if (nullIdx >= 0 && capabilities.length === 0) {
      const capStr = text.substring(nullIdx + 1).trim();
      capabilities = capStr.split(' ').filter(Boolean);
    }

    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) continue;

    const sha = trimmed.substring(0, spaceIdx);
    const name = trimmed.substring(spaceIdx + 1);

    // Skip zero-id capability advertisements for empty repos
    if (sha === '0'.repeat(40)) continue;

    refs.push({ sha, name });
  }

  return { refs, capabilities };
}

// ============================================================
// Upload-Pack Request Building
// ============================================================

/**
 * Build the request body for POST /git-upload-pack.
 *
 * Format:
 *   want <sha> <capabilities>\n   (first want includes caps)
 *   want <sha>\n                  (subsequent wants)
 *   flush
 *   have <sha>\n                  (for incremental fetch)
 *   ...
 *   done\n
 */
export function buildUploadPackRequest(
  wants: string[],
  haves: string[],
  capabilities?: string[],
): Uint8Array {
  if (wants.length === 0) {
    throw new Error('At least one want SHA is required');
  }

  const caps = capabilities ?? CLIENT_CAPABILITIES;
  const parts: Uint8Array[] = [];

  // First want line includes capabilities
  parts.push(pktLine(`want ${wants[0]} ${caps.join(' ')}\n`));

  // Remaining want lines
  for (let i = 1; i < wants.length; i++) {
    parts.push(pktLine(`want ${wants[i]}\n`));
  }

  // Flush separates wants from haves
  parts.push(pktFlush());

  // Have lines (for incremental fetch)
  for (const have of haves) {
    parts.push(pktLine(`have ${have}\n`));
  }

  // Done
  parts.push(pktLine('done\n'));

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

// ============================================================
// Sideband Extraction
// ============================================================

/**
 * Extract packfile data from a sideband-64k upload-pack response.
 *
 * Response format:
 *   pkt-line("NAK\n") or pkt-line("ACK <sha>\n")
 *   pkt-line(0x01 + <packfile chunk>)   band 1 = packfile data
 *   pkt-line(0x02 + <progress text>)    band 2 = progress
 *   pkt-line(0x03 + <error text>)       band 3 = error
 *   ...
 *   0000 (flush = end)
 */
export function extractPackfileFromSideband(data: Uint8Array): FetchResult {
  const pktLines = parseBinaryPktLines(data);
  const packChunks: Uint8Array[] = [];
  const acks: string[] = [];
  let totalPackSize = 0;

  for (const line of pktLines) {
    if (line === null) continue; // flush

    // Check if this is a text line (ACK/NAK) or sideband data
    // ACK/NAK lines start with ASCII 'A' (0x41) or 'N' (0x4E)
    // Sideband lines start with band byte 0x01, 0x02, or 0x03
    const firstByte = line[0]!;

    if (firstByte === 0x01) {
      // Band 1: packfile data
      const chunk = line.slice(1);
      packChunks.push(chunk);
      totalPackSize += chunk.length;
    } else if (firstByte === 0x02) {
      // Band 2: progress — ignore
    } else if (firstByte === 0x03) {
      // Band 3: error
      const errorMsg = decode(line.slice(1));
      throw new Error(`Remote error: ${errorMsg}`);
    } else {
      // Text line — parse ACK/NAK
      const text = decode(line).trim();
      if (text.startsWith('ACK ')) {
        acks.push(text.substring(4, 44)); // extract 40-char SHA
      }
      // NAK is expected for initial clones — just skip
    }
  }

  // Concatenate all packfile chunks
  const packfile = new Uint8Array(totalPackSize);
  let offset = 0;
  for (const chunk of packChunks) {
    packfile.set(chunk, offset);
    offset += chunk.length;
  }

  return { packfile, acks };
}

// ============================================================
// Full Fetch
// ============================================================

/**
 * Fetch a packfile from a remote git repository.
 *
 * Performs the full git smart HTTP fetch flow:
 * 1. POST to git-upload-pack with want/have/done
 * 2. Parse sideband-64k response
 * 3. Return the raw packfile bytes
 *
 * @param repoUrl - Base git URL (e.g. "https://github.com/owner/repo.git")
 * @param wants - SHAs the client wants (typically all remote ref SHAs)
 * @param haves - SHAs the client already has (empty for initial clone)
 * @param headers - Optional HTTP headers (e.g. Authorization)
 */
export async function fetchPackfile(
  repoUrl: string,
  wants: string[],
  haves: string[],
  headers?: Record<string, string>,
): Promise<FetchResult> {
  const url = `${repoUrl.replace(/\/$/, '')}/git-upload-pack`;
  const body = buildUploadPackRequest(wants, haves);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-git-upload-pack-request',
      'User-Agent': 'GitGate/1.0',
      ...headers,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch packfile from ${url}: ${response.status} ${response.statusText}`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  return extractPackfileFromSideband(data);
}
