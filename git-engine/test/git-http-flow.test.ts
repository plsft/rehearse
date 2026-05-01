/**
 * Comprehensive end-to-end tests for the git smart HTTP protocol flow.
 *
 * Tests the full round-trip: object creation -> packfile generation ->
 * protocol wrapping -> parsing -> object extraction.
 */
import { describe, it, expect } from 'vitest';
import {
  serializeObject,
  hashObject,
  encode,
  parseObjectAsync,
  sha1,
  concat,
  type GitBlob,
  type GitTree,
  type GitCommit,
} from '../src/objects';
import {
  generatePackfile,
  resolvePackfile,
  createDelta,
  type PackObjectType,
} from '../src/packfile';
import {
  advertiseRefs,
  parseUploadPackRequest,
  createUploadPackResponse,
  parseReceivePackRequest,
  createReceivePackResponse,
  parsePktLines,
  pktLine,
  pktFlush,
} from '../src/protocol';
import { formatRefAdvertisement } from '../src/refs';

// ============================================================
// Shared test helpers
// ============================================================

const ZERO_SHA = '0'.repeat(40);

const testAuthor = {
  name: 'Test User',
  email: 'test@example.com',
  timestamp: 1700000000,
  tzOffset: '+0000',
};

/** Create a well-formed blob, tree, and commit with correct SHA linkage. */
async function createTestRepoObjects() {
  const blob: GitBlob = { type: 'blob', data: encode('hello world') };
  const blobRaw = serializeObject(blob);
  const blobSha = await sha1(blobRaw);

  const tree: GitTree = {
    type: 'tree',
    entries: [{ mode: '100644', name: 'hello.txt', sha: blobSha }],
  };
  const treeRaw = serializeObject(tree);
  const treeSha = await sha1(treeRaw);

  const commit: GitCommit = {
    type: 'commit',
    treeSha,
    parents: [],
    author: testAuthor,
    committer: testAuthor,
    message: 'initial commit\n',
  };
  const commitRaw = serializeObject(commit);
  const commitSha = await sha1(commitRaw);

  return { blob, blobSha, blobRaw, tree, treeSha, treeRaw, commit, commitSha, commitRaw };
}

/** Extract raw sideband-1 (packfile) data from an upload-pack response. */
function extractPackfileFromSideband(response: Uint8Array): Uint8Array {
  const text = new TextDecoder();
  const parts: Uint8Array[] = [];
  let pos = 0;

  while (pos + 4 <= response.length) {
    const lenHex = text.decode(response.subarray(pos, pos + 4));
    const len = parseInt(lenHex, 16);

    if (len === 0) {
      // flush
      pos += 4;
      continue;
    }

    if (len < 5) {
      // pkt-line too short for sideband — skip (e.g. NAK/ACK line)
      pos += len;
      continue;
    }

    const band = response[pos + 4];
    if (band === 0x01) {
      // band 1 = packfile data
      parts.push(response.subarray(pos + 5, pos + len));
    }
    // band 2 = progress, band 3 = error — skip

    pos += len;
  }

  return concat(...parts);
}

/** Compress data using the same deflate as packfile generation (for size estimates). */
async function compress(data: Uint8Array): Promise<Uint8Array> {
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

// ============================================================
// 1. Full clone flow simulation
// ============================================================

describe('Full clone flow simulation', () => {
  it('creates objects with correct SHAs via hashObject', async () => {
    const blobData = encode('hello world');
    const sha = await hashObject('blob', blobData);
    // Git's well-known SHA for "blob 11\0hello world"
    expect(sha).toBe('95d09f2b10159347eece71399a7e2e907ea3df4f');
  });

  it('serializes and re-parses a blob correctly', async () => {
    const blob: GitBlob = { type: 'blob', data: encode('hello world') };
    const raw = serializeObject(blob);
    const parsed = await parseObjectAsync(raw);

    expect(parsed.object.type).toBe('blob');
    expect(new TextDecoder().decode((parsed.object as GitBlob).data)).toBe('hello world');
    expect(parsed.sha).toBe(await sha1(raw));
  });

  it('advertiseRefs produces output parseable by parsePktLines', () => {
    const refs = [
      { name: 'HEAD', sha: 'a'.repeat(40) },
      { name: 'refs/heads/main', sha: 'a'.repeat(40) },
    ];

    const advBytes = advertiseRefs('git-upload-pack', refs);
    const lines = parsePktLines(advBytes);

    // Should have: service header, null (flush), first ref with caps, second ref, null (flush)
    expect(lines.length).toBe(5);
    expect(lines[0]).toContain('# service=git-upload-pack');
    expect(lines[1]).toBeNull(); // flush after service header
    expect(lines[2]).toContain('a'.repeat(40));
    expect(lines[2]).toContain('HEAD');
    expect(lines[3]).toContain('refs/heads/main');
    expect(lines[4]).toBeNull(); // trailing flush
  });

  it('createUploadPackResponse wrapping a generated packfile produces valid output', async () => {
    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: encode('hello world') },
    ];

    const packfile = await generatePackfile(objects);
    const response = createUploadPackResponse(packfile);

    // Should start with NAK pkt-line
    const firstLine = parsePktLines(response.subarray(0, 12));
    expect(firstLine[0]).toBe('NAK');

    // Should contain band 1 data
    const extracted = extractPackfileFromSideband(response);
    expect(extracted.length).toBe(packfile.length);
    // Verify it starts with PACK signature
    expect(String.fromCharCode(extracted[0]!, extracted[1]!, extracted[2]!, extracted[3]!)).toBe('PACK');
  });

  it('full round-trip: serialize -> packfile -> upload-pack -> extract -> resolve -> verify', async () => {
    const { blob, blobSha, tree, treeSha, commit, commitSha } = await createTestRepoObjects();

    // Build packfile objects from the raw content (not the serialized with-header form)
    const packObjects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: blob.data },
      { type: 'tree', data: serializeObject(tree).subarray(serializeObject(tree).indexOf(0) + 1) },
      { type: 'commit', data: serializeObject(commit).subarray(serializeObject(commit).indexOf(0) + 1) },
    ];

    const packfile = await generatePackfile(packObjects);
    const response = createUploadPackResponse(packfile, 'Counting objects: 3, done.\n');

    // Extract packfile from sideband
    const extractedPack = extractPackfileFromSideband(response);
    expect(extractedPack.length).toBe(packfile.length);

    // Resolve all objects
    const resolved = await resolvePackfile(extractedPack);
    expect(resolved.length).toBe(3);

    // Build a map for easy lookup
    const byType = new Map<string, typeof resolved>();
    for (const obj of resolved) {
      if (!byType.has(obj.type)) byType.set(obj.type, []);
      byType.get(obj.type)!.push(obj);
    }

    // Verify blob
    const blobs = byType.get('blob')!;
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.sha).toBe(blobSha);
    expect(new TextDecoder().decode(blobs[0]!.data)).toBe('hello world');

    // Verify tree
    const trees = byType.get('tree')!;
    expect(trees.length).toBe(1);
    expect(trees[0]!.sha).toBe(treeSha);

    // Verify commit
    const commits = byType.get('commit')!;
    expect(commits.length).toBe(1);
    expect(commits[0]!.sha).toBe(commitSha);
  });

  it('round-trip preserves tree entry structure', async () => {
    const { tree, treeSha, blobSha } = await createTestRepoObjects();

    const treeContent = serializeObject(tree);
    const treeData = treeContent.subarray(treeContent.indexOf(0) + 1);

    const packfile = await generatePackfile([{ type: 'tree', data: treeData }]);
    const resolved = await resolvePackfile(packfile);

    expect(resolved.length).toBe(1);
    expect(resolved[0]!.type).toBe('tree');
    expect(resolved[0]!.sha).toBe(treeSha);

    // Parse the tree content to verify the entry
    const { parseTreeContent } = await import('../src/objects');
    const entries = parseTreeContent(resolved[0]!.data);
    expect(entries.length).toBe(1);
    expect(entries[0]!.mode).toBe('100644');
    expect(entries[0]!.name).toBe('hello.txt');
    expect(entries[0]!.sha).toBe(blobSha);
  });
});

// ============================================================
// 2. Full push flow simulation
// ============================================================

describe('Full push flow simulation', () => {
  it('creates objects, packs them, wraps in receive-pack format, and parses back', async () => {
    const { blob, tree, commit } = await createTestRepoObjects();

    const treeRaw = serializeObject(tree);
    const treeData = treeRaw.subarray(treeRaw.indexOf(0) + 1);
    const commitRaw = serializeObject(commit);
    const commitData = commitRaw.subarray(commitRaw.indexOf(0) + 1);

    const packObjects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: blob.data },
      { type: 'tree', data: treeData },
      { type: 'commit', data: commitData },
    ];

    const packfile = await generatePackfile(packObjects);
    const commitSha = await sha1(commitRaw);

    // Build a receive-pack request: command pkt-lines + flush + packfile
    const request = concat(
      pktLine(`${ZERO_SHA} ${commitSha} refs/heads/main\0report-status side-band-64k\n`),
      pktFlush(),
      packfile,
    );

    const parsed = parseReceivePackRequest(request);

    expect(parsed.commands.length).toBe(1);
    expect(parsed.commands[0]!.oldSha).toBe(ZERO_SHA);
    expect(parsed.commands[0]!.newSha).toBe(commitSha);
    expect(parsed.commands[0]!.name).toBe('refs/heads/main');
    expect(parsed.capabilities).toContain('report-status');
    expect(parsed.capabilities).toContain('side-band-64k');
    expect(parsed.packfileData.length).toBe(packfile.length);
  });

  it('resolvePackfile on extracted packfile recovers all objects', async () => {
    const { blob, blobSha, tree, treeSha, commit, commitSha } = await createTestRepoObjects();

    const treeRaw = serializeObject(tree);
    const treeData = treeRaw.subarray(treeRaw.indexOf(0) + 1);
    const commitRaw = serializeObject(commit);
    const commitData = commitRaw.subarray(commitRaw.indexOf(0) + 1);

    const packfile = await generatePackfile([
      { type: 'blob', data: blob.data },
      { type: 'tree', data: treeData },
      { type: 'commit', data: commitData },
    ]);

    // Simulate receive-pack parse
    const request = concat(
      pktLine(`${ZERO_SHA} ${commitSha} refs/heads/main\0report-status\n`),
      pktFlush(),
      packfile,
    );

    const parsed = parseReceivePackRequest(request);
    const resolved = await resolvePackfile(parsed.packfileData);

    expect(resolved.length).toBe(3);
    const shas = resolved.map((r) => r.sha).sort();
    const expectedShas = [blobSha, treeSha, commitSha].sort();
    expect(shas).toEqual(expectedShas);
  });

  it('createReceivePackResponse produces parseable output', () => {
    const response = createReceivePackResponse('ok', [
      { name: 'refs/heads/main', status: 'ok' },
      { name: 'refs/heads/feature', status: 'ok' },
    ]);

    const lines = parsePktLines(response);
    // unpack ok, ok refs/heads/main, ok refs/heads/feature, flush
    expect(lines.length).toBe(4);
    expect(lines[0]).toBe('unpack ok');
    expect(lines[1]).toBe('ok refs/heads/main');
    expect(lines[2]).toBe('ok refs/heads/feature');
    expect(lines[3]).toBeNull(); // flush
  });

  it('parses ref update commands: create (old=0000)', async () => {
    const newSha = 'a'.repeat(40);
    const packfile = await generatePackfile([{ type: 'blob', data: encode('x') }]);

    const request = concat(
      pktLine(`${ZERO_SHA} ${newSha} refs/heads/new-branch\0report-status\n`),
      pktFlush(),
      packfile,
    );

    const parsed = parseReceivePackRequest(request);
    expect(parsed.commands[0]!.oldSha).toBe(ZERO_SHA);
    expect(parsed.commands[0]!.newSha).toBe(newSha);
    expect(parsed.commands[0]!.name).toBe('refs/heads/new-branch');
  });

  it('parses ref update commands: update (old=abc, new=def)', async () => {
    const oldSha = 'a'.repeat(40);
    const newSha = 'b'.repeat(40);
    const packfile = await generatePackfile([{ type: 'blob', data: encode('x') }]);

    const request = concat(
      pktLine(`${oldSha} ${newSha} refs/heads/main\n`),
      pktFlush(),
      packfile,
    );

    const parsed = parseReceivePackRequest(request);
    expect(parsed.commands[0]!.oldSha).toBe(oldSha);
    expect(parsed.commands[0]!.newSha).toBe(newSha);
  });

  it('parses ref update commands: delete (new=0000)', async () => {
    const oldSha = 'c'.repeat(40);
    const packfile = await generatePackfile([{ type: 'blob', data: encode('x') }]);

    const request = concat(
      pktLine(`${oldSha} ${ZERO_SHA} refs/heads/old-branch\n`),
      pktFlush(),
      packfile,
    );

    const parsed = parseReceivePackRequest(request);
    expect(parsed.commands[0]!.oldSha).toBe(oldSha);
    expect(parsed.commands[0]!.newSha).toBe(ZERO_SHA);
    expect(parsed.commands[0]!.name).toBe('refs/heads/old-branch');
  });

  it('handles multiple ref updates in a single push', async () => {
    const packfile = await generatePackfile([{ type: 'blob', data: encode('multi') }]);
    const sha1Val = 'a'.repeat(40);
    const sha2Val = 'b'.repeat(40);
    const sha3Val = 'c'.repeat(40);

    const request = concat(
      pktLine(`${ZERO_SHA} ${sha1Val} refs/heads/branch1\0report-status\n`),
      pktLine(`${sha2Val} ${sha3Val} refs/heads/branch2\n`),
      pktLine(`${sha1Val} ${ZERO_SHA} refs/heads/branch3\n`),
      pktFlush(),
      packfile,
    );

    const parsed = parseReceivePackRequest(request);
    expect(parsed.commands.length).toBe(3);
    expect(parsed.commands[0]!.name).toBe('refs/heads/branch1');
    expect(parsed.commands[1]!.name).toBe('refs/heads/branch2');
    expect(parsed.commands[2]!.name).toBe('refs/heads/branch3');
    expect(parsed.commands[2]!.newSha).toBe(ZERO_SHA); // delete
  });
});

// ============================================================
// 3. Delta compression in protocol context
// ============================================================

describe('Delta compression in protocol context', () => {
  it('two similar blobs survive round-trip through upload-pack with delta compression', async () => {
    // Create two similar blobs where the second is a small edit
    const baseContent = 'Line one of the file with lots of shared content. ' + 'X'.repeat(500) + '\n'
      + 'Line two that also has plenty of data. ' + 'Y'.repeat(500) + '\n';
    const editedContent = 'Line one of the file with lots of shared content. ' + 'X'.repeat(500) + '\n'
      + 'MODIFIED line two with new data. ' + 'Y'.repeat(500) + '\n';

    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: encode(baseContent) },
      { type: 'blob', data: encode(editedContent) },
    ];

    const packfile = await generatePackfile(objects);
    const response = createUploadPackResponse(packfile);
    const extractedPack = extractPackfileFromSideband(response);

    const resolved = await resolvePackfile(extractedPack);
    expect(resolved.length).toBe(2);

    const contents = resolved.map((r) => new TextDecoder().decode(r.data)).sort();
    const expected = [baseContent, editedContent].sort();
    expect(contents).toEqual(expected);
  });

  it('delta-compressed packfile is smaller than sum of both blob sizes', async () => {
    const baseContent = 'Shared header content for the file. ' + 'A'.repeat(800) + '\n'
      + 'Shared footer content for the file. ' + 'B'.repeat(800) + '\n';
    const editedContent = 'Shared header content for the file. ' + 'A'.repeat(800) + '\n'
      + 'CHANGED footer content for the file. ' + 'B'.repeat(800) + '\n';

    const blob1 = encode(baseContent);
    const blob2 = encode(editedContent);

    const packfile = await generatePackfile([
      { type: 'blob', data: blob1 },
      { type: 'blob', data: blob2 },
    ]);

    // The packfile should be smaller than compressing each blob independently
    const compressed1 = await compress(blob1);
    const compressed2 = await compress(blob2);
    const noDeltaEstimate = 12 + 2 + compressed1.length + 2 + compressed2.length + 20;

    expect(packfile.length).toBeLessThan(noDeltaEstimate);
  });

  it('SHAs of delta-recovered objects match independently computed SHAs', async () => {
    const baseContent = 'Repetitive content block. ' + 'Q'.repeat(600) + '\n';
    const editedContent = 'Repetitive content block. ' + 'Q'.repeat(600) + ' EXTRA\n';

    const blob1Data = encode(baseContent);
    const blob2Data = encode(editedContent);
    const expectedSha1 = await hashObject('blob', blob1Data);
    const expectedSha2 = await hashObject('blob', blob2Data);

    const packfile = await generatePackfile([
      { type: 'blob', data: blob1Data },
      { type: 'blob', data: blob2Data },
    ]);

    const response = createUploadPackResponse(packfile);
    const extractedPack = extractPackfileFromSideband(response);
    const resolved = await resolvePackfile(extractedPack);

    const resolvedShas = resolved.map((r) => r.sha).sort();
    const expectedShas = [expectedSha1, expectedSha2].sort();
    expect(resolvedShas).toEqual(expectedShas);
  });

  it('delta works for tree objects with similar structure', async () => {
    // Two trees that differ only in one entry's SHA
    const sha1Hex = 'a'.repeat(40);
    const sha2Hex = 'b'.repeat(40);

    const tree1: GitTree = {
      type: 'tree',
      entries: [
        { mode: '100644', name: 'file.txt', sha: sha1Hex },
        { mode: '100644', name: 'other.txt', sha: sha1Hex },
      ],
    };
    const tree2: GitTree = {
      type: 'tree',
      entries: [
        { mode: '100644', name: 'file.txt', sha: sha2Hex },
        { mode: '100644', name: 'other.txt', sha: sha1Hex },
      ],
    };

    const tree1Raw = serializeObject(tree1);
    const tree1Data = tree1Raw.subarray(tree1Raw.indexOf(0) + 1);
    const tree2Raw = serializeObject(tree2);
    const tree2Data = tree2Raw.subarray(tree2Raw.indexOf(0) + 1);

    const tree1Sha = await sha1(tree1Raw);
    const tree2Sha = await sha1(tree2Raw);

    const packfile = await generatePackfile([
      { type: 'tree', data: tree1Data },
      { type: 'tree', data: tree2Data },
    ]);

    const resolved = await resolvePackfile(packfile);
    expect(resolved.length).toBe(2);

    const shas = resolved.map((r) => r.sha).sort();
    expect(shas).toEqual([tree1Sha, tree2Sha].sort());
  });
});

// ============================================================
// 4. ACK/NAK negotiation
// ============================================================

describe('ACK/NAK negotiation', () => {
  it('createUploadPackResponse with no commonShas produces NAK', async () => {
    const packfile = await generatePackfile([{ type: 'blob', data: encode('test') }]);
    const response = createUploadPackResponse(packfile);

    // Parse the first pkt-line: should be NAK
    const text = new TextDecoder().decode(response);
    const lenHex = text.substring(0, 4);
    const len = parseInt(lenHex, 16);
    const firstLine = text.substring(4, len).trim();
    expect(firstLine).toBe('NAK');
  });

  it('createUploadPackResponse with commonShas produces ACK', async () => {
    const packfile = await generatePackfile([{ type: 'blob', data: encode('test') }]);
    const commonSha = 'f'.repeat(40);
    const response = createUploadPackResponse(packfile, undefined, [commonSha]);

    // Parse the first pkt-line: should be ACK <sha>
    const text = new TextDecoder().decode(response);
    const lenHex = text.substring(0, 4);
    const len = parseInt(lenHex, 16);
    const firstLine = text.substring(4, len).trim();
    expect(firstLine).toBe(`ACK ${commonSha}`);
  });

  it('createUploadPackResponse with multiple commonShas ACKs the first', async () => {
    const packfile = await generatePackfile([{ type: 'blob', data: encode('test') }]);
    const sha1Val = 'a'.repeat(40);
    const sha2Val = 'b'.repeat(40);
    const response = createUploadPackResponse(packfile, undefined, [sha1Val, sha2Val]);

    const text = new TextDecoder().decode(response);
    const lenHex = text.substring(0, 4);
    const len = parseInt(lenHex, 16);
    const firstLine = text.substring(4, len).trim();
    expect(firstLine).toBe(`ACK ${sha1Val}`);
  });

  it('parseUploadPackRequest correctly extracts wants, haves, and done flag', () => {
    const wantSha1 = 'a'.repeat(40);
    const wantSha2 = 'b'.repeat(40);
    const haveSha1 = 'c'.repeat(40);
    const haveSha2 = 'd'.repeat(40);

    const data = concat(
      pktLine(`want ${wantSha1} multi_ack side-band-64k ofs-delta\n`),
      pktLine(`want ${wantSha2}\n`),
      pktFlush(),
      pktLine(`have ${haveSha1}\n`),
      pktLine(`have ${haveSha2}\n`),
      pktLine('done\n'),
    );

    const result = parseUploadPackRequest(data);
    expect(result.wants).toEqual([wantSha1, wantSha2]);
    expect(result.haves).toEqual([haveSha1, haveSha2]);
    expect(result.done).toBe(true);
    expect(result.capabilities).toContain('multi_ack');
    expect(result.capabilities).toContain('side-band-64k');
    expect(result.capabilities).toContain('ofs-delta');
  });

  it('parseUploadPackRequest with no haves and done=false', () => {
    const wantSha = 'e'.repeat(40);

    const data = concat(
      pktLine(`want ${wantSha}\n`),
      pktFlush(),
    );

    const result = parseUploadPackRequest(data);
    expect(result.wants).toEqual([wantSha]);
    expect(result.haves).toEqual([]);
    expect(result.done).toBe(false);
  });

  it('parseUploadPackRequest handles shallow and deepen', () => {
    const wantSha = 'a'.repeat(40);
    const shallowSha = 'b'.repeat(40);

    const data = concat(
      pktLine(`want ${wantSha}\n`),
      pktLine(`shallow ${shallowSha}\n`),
      pktLine('deepen 3\n'),
      pktFlush(),
      pktLine('done\n'),
    );

    const result = parseUploadPackRequest(data);
    expect(result.wants).toEqual([wantSha]);
    expect(result.shallow).toEqual([shallowSha]);
    expect(result.deepen).toBe(3);
    expect(result.done).toBe(true);
  });
});

// ============================================================
// 5. Edge cases
// ============================================================

describe('Edge cases', () => {
  it('empty repo: advertiseRefs with empty ref list', () => {
    const advBytes = advertiseRefs('git-upload-pack', []);
    const lines = parsePktLines(advBytes);

    // service header, flush, zero-id caps line, flush
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('# service=git-upload-pack');
    expect(lines[1]).toBeNull();
    expect(lines[2]).toContain(ZERO_SHA);
    expect(lines[2]).toContain('capabilities^{}');
    expect(lines[3]).toBeNull();
  });

  it('empty repo advertiseRefs for receive-pack', () => {
    const advBytes = advertiseRefs('git-receive-pack', []);
    const lines = parsePktLines(advBytes);

    expect(lines[2]).toContain('capabilities^{}');
    expect(lines[2]).toContain('report-status');
    expect(lines[2]).toContain('delete-refs');
  });

  it('large object: blob > 64KB survives sideband chunking', async () => {
    // Create a blob larger than 64KB. Even though deflate compresses it,
    // the uncompressed object data must survive the full sideband round-trip.
    const size = 100_000;
    const blobData = new Uint8Array(size);
    // Fill with a mix of patterns to get a non-trivial packfile
    for (let i = 0; i < size; i++) {
      blobData[i] = i % 256;
    }
    const expectedSha = await hashObject('blob', blobData);

    const packfile = await generatePackfile([{ type: 'blob', data: blobData }]);
    const response = createUploadPackResponse(packfile, 'Processing...\n');

    // The original blob is > 64KB — key property under test
    expect(blobData.length).toBeGreaterThan(65535);

    // Extract and verify full round-trip
    const extractedPack = extractPackfileFromSideband(response);
    expect(extractedPack.length).toBe(packfile.length);

    const resolved = await resolvePackfile(extractedPack);
    expect(resolved.length).toBe(1);
    expect(resolved[0]!.sha).toBe(expectedSha);
    expect(resolved[0]!.data.length).toBe(size);
    // Verify data integrity byte-by-byte
    expect(resolved[0]!.data).toEqual(blobData);
  });

  it('binary content in blob: null bytes preserved through round-trip', async () => {
    // Create a blob with null bytes and various binary content
    const binaryData = new Uint8Array([0x00, 0x01, 0xFF, 0x00, 0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x00]);
    const expectedSha = await hashObject('blob', binaryData);

    const packfile = await generatePackfile([{ type: 'blob', data: binaryData }]);
    const resolved = await resolvePackfile(packfile);

    expect(resolved.length).toBe(1);
    expect(resolved[0]!.sha).toBe(expectedSha);
    expect(resolved[0]!.data.length).toBe(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      expect(resolved[0]!.data[i]).toBe(binaryData[i]);
    }
  });

  it('binary blob with null bytes through full upload-pack flow', async () => {
    const binaryData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) binaryData[i] = i; // all byte values 0x00..0xFF
    const expectedSha = await hashObject('blob', binaryData);

    const packfile = await generatePackfile([{ type: 'blob', data: binaryData }]);
    const response = createUploadPackResponse(packfile);
    const extractedPack = extractPackfileFromSideband(response);
    const resolved = await resolvePackfile(extractedPack);

    expect(resolved.length).toBe(1);
    expect(resolved[0]!.sha).toBe(expectedSha);
    expect(resolved[0]!.data).toEqual(binaryData);
  });

  it('formatRefAdvertisement produces correct lines for parsing', () => {
    const refs = [
      { name: 'HEAD', sha: 'f'.repeat(40) },
      { name: 'refs/heads/main', sha: 'f'.repeat(40) },
      { name: 'refs/tags/v1.0', sha: 'e'.repeat(40) },
    ];
    const caps = ['multi_ack', 'side-band-64k'];

    const lines = formatRefAdvertisement(refs, caps);
    expect(lines.length).toBe(3);

    // First line has capabilities after NUL
    expect(lines[0]).toContain('\0');
    expect(lines[0]).toContain('multi_ack side-band-64k');
    expect(lines[0]).toContain('f'.repeat(40) + ' HEAD');

    // Subsequent lines have no NUL
    expect(lines[1]).toBe('f'.repeat(40) + ' refs/heads/main');
    expect(lines[2]).toBe('e'.repeat(40) + ' refs/tags/v1.0');
  });

  it('progress messages appear on band 2 in upload-pack response', async () => {
    const packfile = await generatePackfile([{ type: 'blob', data: encode('progress test') }]);
    const progressMsg = 'Compressing objects: 100% (1/1)\n';
    const response = createUploadPackResponse(packfile, progressMsg);

    // Scan for band 2 data
    const text = new TextDecoder();
    let pos = 0;
    let foundProgress = false;
    while (pos + 4 <= response.length) {
      const lenHex = text.decode(response.subarray(pos, pos + 4));
      const len = parseInt(lenHex, 16);
      if (len === 0) { pos += 4; continue; }
      if (len < 5) { pos += len; continue; }

      const band = response[pos + 4];
      if (band === 0x02) {
        const msg = text.decode(response.subarray(pos + 5, pos + len));
        if (msg === progressMsg) {
          foundProgress = true;
        }
      }
      pos += len;
    }
    expect(foundProgress).toBe(true);
  });

  it('receive-pack response with mixed success and failure', () => {
    const response = createReceivePackResponse('ok', [
      { name: 'refs/heads/main', status: 'ok' },
      { name: 'refs/heads/protected', status: 'deny updating a hidden ref' },
      { name: 'refs/heads/feature', status: 'ok' },
    ]);

    const lines = parsePktLines(response);
    expect(lines.length).toBe(5); // unpack + 3 refs + flush
    expect(lines[0]).toBe('unpack ok');
    expect(lines[1]).toBe('ok refs/heads/main');
    expect(lines[2]).toBe('ng refs/heads/protected deny updating a hidden ref');
    expect(lines[3]).toBe('ok refs/heads/feature');
    expect(lines[4]).toBeNull();
  });
});
