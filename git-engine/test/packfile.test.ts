import { describe, it, expect } from 'vitest';
import {
  parsePackHeader,
  generatePackfile,
  resolvePackfile,
  applyDelta,
  createDelta,
  type PackObjectType,
} from '../src/packfile';
import { encode, sha1, concat, hexToBytes } from '../src/objects';

describe('parsePackHeader', () => {
  it('parses a valid v2 header', () => {
    const header = new Uint8Array(12);
    header[0] = 0x50; // P
    header[1] = 0x41; // A
    header[2] = 0x43; // C
    header[3] = 0x4b; // K
    // version 2
    header[7] = 2;
    // count = 5
    header[11] = 5;

    const { version, count } = parsePackHeader(header);
    expect(version).toBe(2);
    expect(count).toBe(5);
  });

  it('rejects invalid signature', () => {
    const header = new Uint8Array(12);
    header[0] = 0x42; // B
    header[1] = 0x41; // A
    header[2] = 0x44; // D
    header[3] = 0x21; // !
    expect(() => parsePackHeader(header)).toThrow('Invalid packfile signature');
  });

  it('rejects too-short data', () => {
    expect(() => parsePackHeader(new Uint8Array(8))).toThrow('too short');
  });
});

describe('applyDelta', () => {
  it('applies a simple insert-only delta', () => {
    // Build a delta that produces "hello" from an empty base
    // Base size = 0 (varint: 0x00)
    // Target size = 5 (varint: 0x05)
    // Insert 5 bytes: 0x05 followed by "hello"
    const base = new Uint8Array(0);
    const delta = new Uint8Array([
      0x00, // base size = 0
      0x05, // target size = 5
      0x05, // insert 5 bytes
      0x68, 0x65, 0x6c, 0x6c, 0x6f, // "hello"
    ]);

    const result = applyDelta(base, delta);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });

  it('applies a copy-only delta', () => {
    const base = encode('Hello, World!');
    // Build a delta that copies the entire base
    // Base size = 13
    // Target size = 13
    // Copy: cmd=0x91 (0x80 | 0x01 | 0x10), offset_byte=0, size_byte=13
    const delta = new Uint8Array([
      13, // base size
      13, // target size
      0x91, // copy: offset in byte0, size in byte4
      0x00, // offset = 0
      13,   // size = 13
    ]);

    const result = applyDelta(base, delta);
    expect(new TextDecoder().decode(result)).toBe('Hello, World!');
  });

  it('applies a mixed copy+insert delta', () => {
    const base = encode('AAABBBCCC');
    // Target: "AAADDDBBB" = copy(0,3) + insert("DDD") + copy(3,3)
    const delta = new Uint8Array([
      9,  // base size
      9,  // target size
      // Copy "AAA" from offset 0, size 3
      0x91, 0x00, 0x03,
      // Insert "DDD"
      0x03, 0x44, 0x44, 0x44,
      // Copy "BBB" from offset 3, size 3
      0x91, 0x03, 0x03,
    ]);

    const result = applyDelta(base, delta);
    expect(new TextDecoder().decode(result)).toBe('AAADDDBBB');
  });

  it('rejects base size mismatch', () => {
    const base = encode('hi');
    const delta = new Uint8Array([
      10, // claims base is 10 bytes
      2,  // target size
      0x02, 0x68, 0x69, // insert "hi"
    ]);

    expect(() => applyDelta(base, delta)).toThrow('base size mismatch');
  });
});

describe('generatePackfile + resolvePackfile round-trip', () => {
  it('packs and unpacks a single blob', async () => {
    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: encode('Hello, Packfile!\n') },
    ];

    const pack = await generatePackfile(objects);

    // Verify header
    const { version, count } = parsePackHeader(pack);
    expect(version).toBe(2);
    expect(count).toBe(1);

    // Verify checksum (last 20 bytes)
    const checksumBytes = pack.subarray(pack.length - 20);
    const packBody = pack.subarray(0, pack.length - 20);
    const expectedChecksum = await sha1(packBody);
    expect(expectedChecksum).toBe(
      Array.from(checksumBytes, (b) => b.toString(16).padStart(2, '0')).join(''),
    );

    // Resolve and verify contents
    const resolved = await resolvePackfile(pack);
    expect(resolved.length).toBe(1);
    expect(resolved[0]!.type).toBe('blob');
    expect(new TextDecoder().decode(resolved[0]!.data)).toBe('Hello, Packfile!\n');
  });

  it('packs and unpacks multiple objects', async () => {
    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: encode('file1.txt content\n') },
      { type: 'blob', data: encode('file2.txt content\n') },
      { type: 'commit', data: encode('tree aaaa\nauthor Test <t@t.com> 1700000000 +0000\ncommitter Test <t@t.com> 1700000000 +0000\n\ntest commit\n') },
    ];

    const pack = await generatePackfile(objects);
    const resolved = await resolvePackfile(pack);

    expect(resolved.length).toBe(3);
    const types = resolved.map((r) => r.type).sort();
    expect(types).toEqual(['blob', 'blob', 'commit']);
  });

  it('produces deterministic packfiles', async () => {
    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: encode('deterministic test\n') },
    ];

    const pack1 = await generatePackfile(objects);
    const pack2 = await generatePackfile(objects);

    // Packfiles should be identical (no randomness)
    expect(pack1.length).toBe(pack2.length);
    for (let i = 0; i < pack1.length; i++) {
      expect(pack1[i]).toBe(pack2[i]);
    }
  });
});

describe('packfile with all object types', () => {
  it('packs commit, tree, blob, and tag', async () => {
    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: encode('content\n') },
      { type: 'tree', data: new Uint8Array([
        // "100644 file\0" + 20 bytes of SHA
        ...encode('100644 file\0'),
        ...new Uint8Array(20),
      ])},
      { type: 'commit', data: encode('tree ' + '0'.repeat(40) + '\nauthor A <a@a> 0 +0000\ncommitter A <a@a> 0 +0000\n\nmsg\n') },
      { type: 'tag', data: encode('object ' + '0'.repeat(40) + '\ntype commit\ntag v1\ntagger A <a@a> 0 +0000\n\ntag msg\n') },
    ];

    const pack = await generatePackfile(objects);
    const resolved = await resolvePackfile(pack);

    expect(resolved.length).toBe(4);
    const types = resolved.map((r) => r.type).sort();
    expect(types).toEqual(['blob', 'commit', 'tag', 'tree']);
  });
});

describe('createDelta', () => {
  it('produces a delta that applyDelta can reconstruct', () => {
    const base = encode('Hello, World! This is a test of the delta compression system.\n');
    const target = encode('Hello, World! This is a TEST of the delta compression system.\n');

    const delta = createDelta(base, target);
    const reconstructed = applyDelta(base, delta);
    expect(new TextDecoder().decode(reconstructed)).toBe(
      'Hello, World! This is a TEST of the delta compression system.\n',
    );
  });

  it('produces a delta smaller than the target for similar inputs', () => {
    // Create a large-ish base and a target that differs only slightly
    const baseStr = 'Line of text that repeats with some variation. '.repeat(100);
    const targetStr = baseStr.substring(0, 200) + 'MODIFIED SECTION' + baseStr.substring(216);
    const base = encode(baseStr);
    const target = encode(targetStr);

    const delta = createDelta(base, target);
    // Delta should be significantly smaller than the target
    expect(delta.length).toBeLessThan(target.length);
  });
});

describe('delta compression in packfile generation', () => {
  it('generates a smaller packfile with delta compression for similar blobs', async () => {
    // Create two similar blobs -- the second is a small modification of the first
    const baseContent = 'This is line ' + 'A'.repeat(500) + '\n'
      + 'Another line of content ' + 'B'.repeat(500) + '\n'
      + 'Yet more data for the blob ' + 'C'.repeat(500) + '\n';
    const modifiedContent = 'This is line ' + 'A'.repeat(500) + '\n'
      + 'A MODIFIED line of content ' + 'B'.repeat(500) + '\n'
      + 'Yet more data for the blob ' + 'C'.repeat(500) + '\n';

    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: encode(baseContent) },
      { type: 'blob', data: encode(modifiedContent) },
    ];

    const packWithDeltas = await generatePackfile(objects);

    // For comparison, manually compute the "no delta" size:
    // Each object would be the full compressed blob + header + packfile overhead.
    // We verify that the delta-compressed pack is smaller by computing an
    // approximate no-delta size from the two objects' individual compressed sizes.
    const obj1Compressed = await compress(objects[0]!.data);
    const obj2Compressed = await compress(objects[1]!.data);
    // No-delta pack size = 12 (header) + type/size headers (~2 each) + compressed data + 20 (checksum)
    const noDelteEstimate = 12 + 2 + obj1Compressed.length + 2 + obj2Compressed.length + 20;

    expect(packWithDeltas.length).toBeLessThan(noDelteEstimate);
  });

  it('round-trips similar blobs through delta compression', async () => {
    const baseContent = 'Shared prefix content. ' + 'X'.repeat(400) + '\n'
      + 'Middle section with data ' + 'Y'.repeat(400) + '\n'
      + 'Trailing content here. ' + 'Z'.repeat(400) + '\n';
    const modifiedContent = 'Shared prefix content. ' + 'X'.repeat(400) + '\n'
      + 'CHANGED section with data ' + 'Y'.repeat(400) + '\n'
      + 'Trailing content here. ' + 'Z'.repeat(400) + '\n';

    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: encode(baseContent) },
      { type: 'blob', data: encode(modifiedContent) },
    ];

    const pack = await generatePackfile(objects);
    const resolved = await resolvePackfile(pack);

    expect(resolved.length).toBe(2);

    // Both blobs should be recovered, regardless of order
    const contents = resolved.map((r) => new TextDecoder().decode(r.data)).sort();
    const expected = [baseContent, modifiedContent].sort();
    expect(contents).toEqual(expected);

    // Both should be blobs
    expect(resolved[0]!.type).toBe('blob');
    expect(resolved[1]!.type).toBe('blob');

    // Verify SHA hashes are correct
    for (const obj of resolved) {
      const header = encode(`${obj.type} ${obj.data.length}\0`);
      const fullObj = concat(header, obj.data);
      const expectedSha = await sha1(fullObj);
      expect(obj.sha).toBe(expectedSha);
    }
  });

  it('does not use deltas across different object types', async () => {
    // A commit and a blob with similar content should NOT be delta-compressed against each other
    const similarContent = 'tree ' + '0'.repeat(40) + '\nauthor Test <t@t.com> 1700000000 +0000\ncommitter Test <t@t.com> 1700000000 +0000\n\ntest commit\n';
    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'commit', data: encode(similarContent) },
      { type: 'blob', data: encode(similarContent) },
    ];

    const pack = await generatePackfile(objects);
    const resolved = await resolvePackfile(pack);

    expect(resolved.length).toBe(2);
    const types = resolved.map((r) => r.type).sort();
    expect(types).toEqual(['blob', 'commit']);
  });
});

describe('OFS_DELTA ordering regression', () => {
  it('delta bases always precede their deltas in the packfile (no forward references)', async () => {
    // Regression test for: "offset value out of bound for delta base object"
    // Bug: generatePackfile searched for delta bases at indices AFTER the current
    // entry (j > i), creating OFS_DELTA entries that referenced bases not yet
    // written. Git clients rejected these with invalid offset errors.
    //
    // This test creates many similar blobs that are likely to trigger delta
    // compression, then verifies the packfile round-trips correctly through
    // parse + resolve (which validates OFS_DELTA offsets).

    const blobs: Array<{ type: PackObjectType; data: Uint8Array }> = [];
    const baseContent = 'A'.repeat(800);

    // Create 20 similar blobs — high delta compression opportunity
    for (let i = 0; i < 20; i++) {
      const modified = baseContent.substring(0, i * 40) + `===BLOCK_${i}===` + baseContent.substring(i * 40 + 16);
      blobs.push({ type: 'blob', data: encode(modified) });
    }

    const pack = await generatePackfile(blobs);
    const resolved = await resolvePackfile(pack);

    // All 20 blobs must survive the round-trip
    expect(resolved.length).toBe(20);
    for (const obj of resolved) {
      expect(obj.type).toBe('blob');
      // Verify SHA integrity
      const header = encode(`${obj.type} ${obj.data.length}\0`);
      const fullObj = concat(header, obj.data);
      const expectedSha = await sha1(fullObj);
      expect(obj.sha).toBe(expectedSha);
    }
  });

  it('packfile with mixed types and sizes round-trips with delta compression', async () => {
    // Simulate a realistic repo: commits, trees, and blobs of varying sizes
    // This catches ordering issues where sort-by-type-then-size interleaves objects
    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [];

    // 5 commits (small, similar)
    for (let i = 0; i < 5; i++) {
      objects.push({
        type: 'commit',
        data: encode(`tree ${'a'.repeat(40)}\nparent ${'b'.repeat(40)}\nauthor Dev <d@d.com> ${1700000000 + i} +0000\ncommitter Dev <d@d.com> ${1700000000 + i} +0000\n\nCommit ${i}\n`),
      });
    }

    // 3 trees (medium, similar binary structure)
    for (let i = 0; i < 3; i++) {
      const treeContent = `100644 file${i}.ts\0` + String.fromCharCode(...new Array(20).fill(i + 0x30));
      objects.push({ type: 'tree', data: encode(treeContent) });
    }

    // 10 blobs (large, similar — high delta potential)
    const largeBase = 'function process(input: string): string {\n' + '  // processing logic\n'.repeat(50) + '  return input;\n}\n';
    for (let i = 0; i < 10; i++) {
      const modified = largeBase.replace(`processing logic`, `processing logic v${i}`);
      objects.push({ type: 'blob', data: encode(modified) });
    }

    const pack = await generatePackfile(objects);
    const resolved = await resolvePackfile(pack);

    expect(resolved.length).toBe(18); // 5 commits + 3 trees + 10 blobs

    const types = resolved.map(r => r.type);
    expect(types.filter(t => t === 'commit').length).toBe(5);
    expect(types.filter(t => t === 'tree').length).toBe(3);
    expect(types.filter(t => t === 'blob').length).toBe(10);

    // Every object must have a valid SHA
    for (const obj of resolved) {
      const header = encode(`${obj.type} ${obj.data.length}\0`);
      const fullObj = concat(header, obj.data);
      const expectedSha = await sha1(fullObj);
      expect(obj.sha).toBe(expectedSha);
    }
  });

  it('single-object packfile has no delta (edge case)', async () => {
    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: encode('solo file content') },
    ];

    const pack = await generatePackfile(objects);
    const resolved = await resolvePackfile(pack);

    expect(resolved.length).toBe(1);
    expect(new TextDecoder().decode(resolved[0]!.data)).toBe('solo file content');
  });
});

// Helper: compress data using the same deflate as packfile generation
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
  const totalLength = chunks.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of chunks) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
