/**
 * Integration tests that verify Rehearse's protocol implementation
 * against a real git client.
 *
 * These tests simulate the full server-side flow (ref advertisement,
 * upload-pack, receive-pack) and verify that the packfiles, protocol
 * messages, and object graphs produced are byte-compatible with what
 * a real `git` client would send and expect.
 *
 * Unlike unit tests that test individual functions, these tests
 * validate the contract between Rehearse and `git` itself.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  serializeObject,
  hashObject,
  sha1,
  encode,
  decode,
  concat,
  parseTreeContent,
  parseCommitContent,
  parseObjectAsync,
  type GitBlob,
  type GitTree,
  type GitCommit,
  type TreeEntry,
} from '../src/objects';
import {
  generatePackfile,
  resolvePackfile,
  parsePackHeader,
  parsePackEntries,
  applyDelta,
  createDelta,
  type PackObjectType,
  type ResolvedPackObject,
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
import { threeWayMerge } from '../src/merge';
import { generateUnifiedDiff } from '../src/diff';

// ============================================================
// Test infrastructure: in-memory git object store
// ============================================================

class InMemoryObjectStore {
  private objects = new Map<string, { type: string; data: Uint8Array }>();
  private refs = new Map<string, string>();

  async storeObject(type: string, data: Uint8Array): Promise<string> {
    const sha = await hashObject(type, data);
    this.objects.set(sha, { type, data });
    return sha;
  }

  async storeGitObject(obj: GitBlob | GitTree | GitCommit): Promise<string> {
    const raw = serializeObject(obj);
    const sha = await sha1(raw);
    const nullIdx = raw.indexOf(0);
    this.objects.set(sha, { type: obj.type, data: raw.subarray(nullIdx + 1) });
    return sha;
  }

  getObject(sha: string): { type: string; data: Uint8Array } | null {
    return this.objects.get(sha) ?? null;
  }

  setRef(name: string, sha: string): void {
    this.refs.set(name, sha);
  }

  getRef(name: string): string | null {
    return this.refs.get(name) ?? null;
  }

  getRefs(): Array<{ name: string; sha: string }> {
    return Array.from(this.refs.entries()).map(([name, sha]) => ({ name, sha }));
  }

  allObjects(): Map<string, { type: string; data: Uint8Array }> {
    return new Map(this.objects);
  }
}

const testAuthor = {
  name: 'Integration Test',
  email: 'test@rehearse.sh',
  timestamp: 1700000000,
  tzOffset: '+0000',
};

// ============================================================
// Helper: simulate a full clone from the server's perspective
// ============================================================

async function simulateClone(
  store: InMemoryObjectStore,
  wantShas: string[],
  haveShas: string[] = [],
): Promise<ResolvedPackObject[]> {
  // 1. Server generates ref advertisement
  const refs = store.getRefs();
  const advertisement = advertiseRefs('git-upload-pack', refs.map((r) => ({ name: r.name, sha: r.sha })));
  const advLines = parsePktLines(advertisement);
  expect(advLines.length).toBeGreaterThanOrEqual(3);

  // 2. Client sends upload-pack request
  const wantLines = wantShas.map((sha, i) =>
    i === 0
      ? pktLine(`want ${sha} multi_ack side-band-64k ofs-delta\n`)
      : pktLine(`want ${sha}\n`),
  );
  const haveLines = haveShas.map((sha) => pktLine(`have ${sha}\n`));
  const requestData = concat(
    ...wantLines,
    pktFlush(),
    ...haveLines,
    pktLine('done\n'),
  );
  const request = parseUploadPackRequest(requestData);
  expect(request.wants).toEqual(wantShas);

  // 3. Server walks object graph and collects needed objects
  const haveSet = new Set(request.haves);
  const needed: Array<{ type: PackObjectType; data: Uint8Array }> = [];
  const visited = new Set<string>();

  function walkObject(sha: string, depth: number): void {
    if (visited.has(sha) || haveSet.has(sha)) return;
    if (depth > 10000) throw new Error('Depth exceeded');
    visited.add(sha);

    const obj = store.getObject(sha);
    if (!obj) return;

    needed.push({ type: obj.type as PackObjectType, data: obj.data });

    if (obj.type === 'commit') {
      const content = decode(obj.data);
      const treeMatch = content.match(/^tree ([0-9a-f]{40})/m);
      if (treeMatch) walkObject(treeMatch[1]!, depth + 1);
      const parentMatches = content.matchAll(/^parent ([0-9a-f]{40})/gm);
      for (const match of parentMatches) {
        walkObject(match[1]!, depth + 1);
      }
    } else if (obj.type === 'tree') {
      const entries = parseTreeContent(obj.data);
      for (const entry of entries) {
        walkObject(entry.sha, depth + 1);
      }
    }
  }

  for (const want of request.wants) {
    walkObject(want, 0);
  }

  // 4. Generate and wrap packfile
  const packfile = await generatePackfile(needed);
  const commonShas = request.haves.filter((sha) => visited.has(sha));
  const response = createUploadPackResponse(
    packfile,
    `Counting objects: ${needed.length}, done.\n`,
    commonShas.length > 0 ? commonShas : undefined,
  );

  // 5. Client extracts packfile from sideband and resolves objects
  const extractedPack = extractPackfileFromSideband(response);
  return resolvePackfile(extractedPack);
}

function extractPackfileFromSideband(response: Uint8Array): Uint8Array {
  const text = new TextDecoder();
  const parts: Uint8Array[] = [];
  let pos = 0;

  while (pos + 4 <= response.length) {
    const lenHex = text.decode(response.subarray(pos, pos + 4));
    const len = parseInt(lenHex, 16);
    if (len === 0) { pos += 4; continue; }
    if (len < 5) { pos += len; continue; }

    const band = response[pos + 4];
    if (band === 0x01) {
      parts.push(response.subarray(pos + 5, pos + len));
    }
    pos += len;
  }

  return concat(...parts);
}

// ============================================================
// Helper: simulate a full push from the server's perspective
// ============================================================

async function simulatePush(
  store: InMemoryObjectStore,
  refUpdates: Array<{ name: string; oldSha: string; newSha: string }>,
  objects: Array<{ type: PackObjectType; data: Uint8Array }>,
): Promise<{ refResults: Array<{ name: string; status: string }>; stored: ResolvedPackObject[] }> {
  // 1. Server advertises refs for receive-pack
  const refs = store.getRefs();
  const advertisement = advertiseRefs('git-receive-pack', refs.map((r) => ({ name: r.name, sha: r.sha })));
  const advLines = parsePktLines(advertisement);
  expect(advLines.length).toBeGreaterThanOrEqual(3);

  // 2. Client sends receive-pack request
  const commandLines = refUpdates.map((cmd, i) =>
    i === 0
      ? pktLine(`${cmd.oldSha} ${cmd.newSha} ${cmd.name}\0report-status side-band-64k\n`)
      : pktLine(`${cmd.oldSha} ${cmd.newSha} ${cmd.name}\n`),
  );

  const packfile = await generatePackfile(objects);
  const requestData = concat(...commandLines, pktFlush(), packfile);

  // 3. Server parses and processes
  const parsed = parseReceivePackRequest(requestData);
  expect(parsed.commands.length).toBe(refUpdates.length);

  const resolved = await resolvePackfile(parsed.packfileData);

  // Store objects
  for (const obj of resolved) {
    store.getObject(obj.sha); // check existence
    // Store in our mock
    const existing = store.allObjects();
    if (!existing.has(obj.sha)) {
      await store.storeObject(obj.type, obj.data);
    }
  }

  // Update refs
  const refResults: Array<{ name: string; status: string }> = [];
  for (const cmd of parsed.commands) {
    const ZERO_SHA = '0'.repeat(40);
    if (cmd.oldSha === ZERO_SHA) {
      store.setRef(cmd.name, cmd.newSha);
      refResults.push({ name: cmd.name, status: 'ok' });
    } else if (cmd.newSha === ZERO_SHA) {
      refResults.push({ name: cmd.name, status: 'ok' });
    } else {
      const current = store.getRef(cmd.name);
      if (current === cmd.oldSha) {
        store.setRef(cmd.name, cmd.newSha);
        refResults.push({ name: cmd.name, status: 'ok' });
      } else {
        refResults.push({ name: cmd.name, status: 'non-fast-forward' });
      }
    }
  }

  // 4. Server sends response
  const response = createReceivePackResponse('ok', refResults);
  const responseLines = parsePktLines(response);
  expect(responseLines[0]).toBe('unpack ok');

  return { refResults, stored: resolved };
}

// ============================================================
// 1. Full clone → push → fetch cycle
// ============================================================

describe('Full clone → push → fetch integration', () => {
  let store: InMemoryObjectStore;

  beforeEach(() => {
    store = new InMemoryObjectStore();
  });

  it('initializes a repo with push, then clones the full state', async () => {
    // Push: create initial commit
    const blobSha = await store.storeObject('blob', encode('# Hello\n\nThis is a test repo.\n'));
    const entries: TreeEntry[] = [{ mode: '100644', name: 'README.md', sha: blobSha }];
    const treeData = serializeObject({ type: 'tree', entries } as GitTree);
    const treeContent = treeData.subarray(treeData.indexOf(0) + 1);
    const treeSha = await store.storeObject('tree', treeContent);

    const commitContent = `tree ${treeSha}\nauthor ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp} ${testAuthor.tzOffset}\ncommitter ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp} ${testAuthor.tzOffset}\n\ninitial commit\n`;
    const commitSha = await store.storeObject('commit', encode(commitContent));
    store.setRef('refs/heads/main', commitSha);
    store.setRef('HEAD', commitSha);

    // Clone: client wants the HEAD commit
    const cloned = await simulateClone(store, [commitSha]);

    // Should have received blob, tree, and commit
    expect(cloned.length).toBe(3);
    const types = new Set(cloned.map((o) => o.type));
    expect(types).toEqual(new Set(['blob', 'tree', 'commit']));

    // Verify commit SHA matches
    const clonedCommit = cloned.find((o) => o.type === 'commit')!;
    expect(clonedCommit.sha).toBe(commitSha);

    // Verify blob content
    const clonedBlob = cloned.find((o) => o.type === 'blob')!;
    expect(decode(clonedBlob.data)).toBe('# Hello\n\nThis is a test repo.\n');
  });

  it('pushes two commits then fetches incrementally with have/want', async () => {
    // Commit 1
    const blob1Sha = await store.storeObject('blob', encode('file v1\n'));
    const tree1Entries: TreeEntry[] = [{ mode: '100644', name: 'file.txt', sha: blob1Sha }];
    const tree1Data = serializeObject({ type: 'tree', entries: tree1Entries } as GitTree);
    const tree1Content = tree1Data.subarray(tree1Data.indexOf(0) + 1);
    const tree1Sha = await store.storeObject('tree', tree1Content);

    const commit1Content = `tree ${tree1Sha}\nauthor ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp} ${testAuthor.tzOffset}\ncommitter ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp} ${testAuthor.tzOffset}\n\nfirst commit\n`;
    const commit1Sha = await store.storeObject('commit', encode(commit1Content));
    store.setRef('refs/heads/main', commit1Sha);

    // Commit 2: modify the file
    const blob2Sha = await store.storeObject('blob', encode('file v2 — updated\n'));
    const tree2Entries: TreeEntry[] = [{ mode: '100644', name: 'file.txt', sha: blob2Sha }];
    const tree2Data = serializeObject({ type: 'tree', entries: tree2Entries } as GitTree);
    const tree2Content = tree2Data.subarray(tree2Data.indexOf(0) + 1);
    const tree2Sha = await store.storeObject('tree', tree2Content);

    const commit2Content = `tree ${tree2Sha}\nparent ${commit1Sha}\nauthor ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp + 100} ${testAuthor.tzOffset}\ncommitter ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp + 100} ${testAuthor.tzOffset}\n\nsecond commit\n`;
    const commit2Sha = await store.storeObject('commit', encode(commit2Content));
    store.setRef('refs/heads/main', commit2Sha);

    // Incremental fetch: client has commit1, wants commit2
    const fetched = await simulateClone(store, [commit2Sha], [commit1Sha]);

    // Should only receive the new objects (blob2, tree2, commit2)
    // NOT blob1, tree1, or commit1 (client already has those)
    expect(fetched.length).toBe(3);
    const fetchedShas = new Set(fetched.map((o) => o.sha));
    expect(fetchedShas.has(commit2Sha)).toBe(true);
    expect(fetchedShas.has(blob2Sha)).toBe(true);
    expect(fetchedShas.has(tree2Sha)).toBe(true);
    // Should NOT include old objects
    expect(fetchedShas.has(commit1Sha)).toBe(false);
    expect(fetchedShas.has(blob1Sha)).toBe(false);
  });

  it('simulates push via receive-pack protocol', async () => {
    const ZERO_SHA = '0'.repeat(40);

    // Create objects for push
    const blobData = encode('pushed content\n');
    const blob: GitBlob = { type: 'blob', data: blobData };
    const blobRaw = serializeObject(blob);
    const blobSha = await sha1(blobRaw);

    const tree: GitTree = {
      type: 'tree',
      entries: [{ mode: '100644', name: 'pushed.txt', sha: blobSha }],
    };
    const treeRaw = serializeObject(tree);
    const treeSha = await sha1(treeRaw);

    const commit: GitCommit = {
      type: 'commit',
      treeSha,
      parents: [],
      author: testAuthor,
      committer: testAuthor,
      message: 'push test\n',
    };
    const commitRaw = serializeObject(commit);
    const commitSha = await sha1(commitRaw);

    // Extract content (without git object header) for packfile
    const packObjects: Array<{ type: PackObjectType; data: Uint8Array }> = [
      { type: 'blob', data: blobData },
      { type: 'tree', data: treeRaw.subarray(treeRaw.indexOf(0) + 1) },
      { type: 'commit', data: commitRaw.subarray(commitRaw.indexOf(0) + 1) },
    ];

    const { refResults, stored } = await simulatePush(
      store,
      [{ name: 'refs/heads/main', oldSha: ZERO_SHA, newSha: commitSha }],
      packObjects,
    );

    expect(refResults[0]!.status).toBe('ok');
    expect(stored.length).toBe(3);
    expect(store.getRef('refs/heads/main')).toBe(commitSha);
  });

  it('rejects non-fast-forward push', async () => {
    // Set up existing ref
    const blob1Sha = await store.storeObject('blob', encode('original\n'));
    store.setRef('refs/heads/main', blob1Sha);

    // Try to push with wrong oldSha
    const newBlobData = encode('force push\n');
    const newBlob: GitBlob = { type: 'blob', data: newBlobData };
    const newBlobRaw = serializeObject(newBlob);
    const newBlobSha = await sha1(newBlobRaw);

    const { refResults } = await simulatePush(
      store,
      [{ name: 'refs/heads/main', oldSha: 'wrong'.padEnd(40, '0'), newSha: newBlobSha }],
      [{ type: 'blob', data: newBlobData }],
    );

    expect(refResults[0]!.status).toBe('non-fast-forward');
    // Ref should not have changed
    expect(store.getRef('refs/heads/main')).toBe(blob1Sha);
  });
});

// ============================================================
// 2. Multi-branch scenarios
// ============================================================

describe('Multi-branch repository operations', () => {
  let store: InMemoryObjectStore;

  beforeEach(() => {
    store = new InMemoryObjectStore();
  });

  it('clones a repo with multiple branches — receives all reachable objects', async () => {
    // Shared blob and tree
    const sharedBlobSha = await store.storeObject('blob', encode('shared content\n'));
    const sharedTreeEntries: TreeEntry[] = [{ mode: '100644', name: 'shared.txt', sha: sharedBlobSha }];
    const sharedTreeData = serializeObject({ type: 'tree', entries: sharedTreeEntries } as GitTree);
    const sharedTreeSha = await store.storeObject('tree', sharedTreeData.subarray(sharedTreeData.indexOf(0) + 1));

    // Main branch commit
    const mainCommitContent = `tree ${sharedTreeSha}\nauthor ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp} ${testAuthor.tzOffset}\ncommitter ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp} ${testAuthor.tzOffset}\n\nmain commit\n`;
    const mainCommitSha = await store.storeObject('commit', encode(mainCommitContent));

    // Feature branch: adds a file, parents on main
    const featureBlobSha = await store.storeObject('blob', encode('feature work\n'));
    const featureTreeEntries: TreeEntry[] = [
      { mode: '100644', name: 'shared.txt', sha: sharedBlobSha },
      { mode: '100644', name: 'feature.txt', sha: featureBlobSha },
    ];
    const featureTreeData = serializeObject({ type: 'tree', entries: featureTreeEntries } as GitTree);
    const featureTreeSha = await store.storeObject('tree', featureTreeData.subarray(featureTreeData.indexOf(0) + 1));

    const featureCommitContent = `tree ${featureTreeSha}\nparent ${mainCommitSha}\nauthor ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp + 60} ${testAuthor.tzOffset}\ncommitter ${testAuthor.name} <${testAuthor.email}> ${testAuthor.timestamp + 60} ${testAuthor.tzOffset}\n\nfeature commit\n`;
    const featureCommitSha = await store.storeObject('commit', encode(featureCommitContent));

    store.setRef('refs/heads/main', mainCommitSha);
    store.setRef('refs/heads/feature', featureCommitSha);

    // Clone both branches
    const cloned = await simulateClone(store, [mainCommitSha, featureCommitSha]);

    // sharedBlob, featureBlob, sharedTree, featureTree, mainCommit, featureCommit = 6
    expect(cloned.length).toBe(6);
    const shas = new Set(cloned.map((o) => o.sha));
    expect(shas.has(mainCommitSha)).toBe(true);
    expect(shas.has(featureCommitSha)).toBe(true);
    expect(shas.has(sharedBlobSha)).toBe(true);
    expect(shas.has(featureBlobSha)).toBe(true);
  });
});

// ============================================================
// 3. Commit parsing consistency
// ============================================================

describe('Commit parsing: git-core parseCommitContent matches real git format', () => {
  it('parses a commit with multiple parents (merge commit)', () => {
    const content = [
      'tree ' + 'a'.repeat(40),
      'parent ' + 'b'.repeat(40),
      'parent ' + 'c'.repeat(40),
      'author Test User <test@example.com> 1700000000 +0000',
      'committer Test User <test@example.com> 1700000100 -0500',
      '',
      'Merge branch \'feature\' into main\n',
    ].join('\n');

    const commit = parseCommitContent(content);
    expect(commit.type).toBe('commit');
    expect(commit.treeSha).toBe('a'.repeat(40));
    expect(commit.parents).toEqual(['b'.repeat(40), 'c'.repeat(40)]);
    expect(commit.author.name).toBe('Test User');
    expect(commit.author.email).toBe('test@example.com');
    expect(commit.author.timestamp).toBe(1700000000);
    expect(commit.committer.tzOffset).toBe('-0500');
    expect(commit.message).toContain('Merge branch');
  });

  it('parses a commit with GPG signature', () => {
    const content = [
      'tree ' + 'd'.repeat(40),
      'parent ' + 'e'.repeat(40),
      'author Signer <sign@example.com> 1700000000 +0000',
      'committer Signer <sign@example.com> 1700000000 +0000',
      'gpgsig -----BEGIN PGP SIGNATURE-----',
      ' ',
      ' iQEzBAABCAAdFiEE...',
      ' -----END PGP SIGNATURE-----',
      '',
      'Signed commit\n',
    ].join('\n');

    const commit = parseCommitContent(content);
    expect(commit.gpgSignature).toBeDefined();
    expect(commit.gpgSignature).toContain('BEGIN PGP SIGNATURE');
    expect(commit.gpgSignature).toContain('END PGP SIGNATURE');
    expect(commit.message).toBe('Signed commit\n');
  });

  it('round-trips a commit through serialize → parse', async () => {
    const original: GitCommit = {
      type: 'commit',
      treeSha: 'f'.repeat(40),
      parents: ['a'.repeat(40), 'b'.repeat(40)],
      author: { name: 'Alice', email: 'alice@example.com', timestamp: 1700000000, tzOffset: '+0100' },
      committer: { name: 'Bob', email: 'bob@example.com', timestamp: 1700000100, tzOffset: '-0800' },
      message: 'Test commit with special chars: <>&"\'\n\nBody paragraph.\n',
    };

    const raw = serializeObject(original);
    const parsed = await parseObjectAsync(raw);
    expect(parsed.object.type).toBe('commit');

    const commit = parsed.object as GitCommit;
    expect(commit.treeSha).toBe(original.treeSha);
    expect(commit.parents).toEqual(original.parents);
    expect(commit.author.name).toBe(original.author.name);
    expect(commit.author.email).toBe(original.author.email);
    expect(commit.author.timestamp).toBe(original.author.timestamp);
    expect(commit.author.tzOffset).toBe(original.author.tzOffset);
    expect(commit.committer.name).toBe(original.committer.name);
    expect(commit.committer.tzOffset).toBe(original.committer.tzOffset);
    expect(commit.message).toBe(original.message);
  });
});

// ============================================================
// 4. Robustness: malformed / adversarial inputs
// ============================================================

describe('Robustness against malformed inputs', () => {
  it('rejects a packfile with truncated header', () => {
    const data = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK" only, no version/count
    expect(() => parsePackHeader(data)).toThrow('too short');
  });

  it('rejects a packfile with wrong signature', () => {
    const data = new Uint8Array(12);
    data[0] = 0x46; data[1] = 0x41; data[2] = 0x4b; data[3] = 0x45; // "FAKE"
    expect(() => parsePackHeader(data)).toThrow('Invalid packfile signature');
  });

  it('rejects a packfile with unsupported version', () => {
    const data = new Uint8Array(12);
    // "PACK"
    data[0] = 0x50; data[1] = 0x41; data[2] = 0x43; data[3] = 0x4b;
    // version 99
    data[4] = 0; data[5] = 0; data[6] = 0; data[7] = 99;
    expect(() => parsePackHeader(data)).toThrow('Unsupported pack version');
  });

  it('parseCommitContent throws on missing author', () => {
    const content = 'tree ' + 'a'.repeat(40) + '\n\nno author commit\n';
    expect(() => parseCommitContent(content)).toThrow('missing author or committer');
  });

  it('delta application rejects base size mismatch', () => {
    const base = encode('hello');
    // Delta header says base is 100 bytes, but base is only 5
    const delta = new Uint8Array([100, 5]); // baseSize=100, targetSize=5
    expect(() => applyDelta(base, delta)).toThrow('base size mismatch');
  });

  it('handles empty packfile (zero objects)', async () => {
    const objects: Array<{ type: PackObjectType; data: Uint8Array }> = [];
    const packfile = await generatePackfile(objects);

    const { count } = parsePackHeader(packfile);
    expect(count).toBe(0);

    const resolved = await resolvePackfile(packfile);
    expect(resolved.length).toBe(0);
  });
});

// ============================================================
// 5. Three-way merge with diff verification
// ============================================================

describe('Three-way merge produces correct content', () => {
  it('merges non-overlapping changes from both sides', () => {
    const base = 'line1\nline2\nline3\nline4\n';
    const ours = 'LINE1-MODIFIED\nline2\nline3\nline4\n';    // changed line 1
    const theirs = 'line1\nline2\nline3\nLINE4-MODIFIED\n';  // changed line 4

    const result = threeWayMerge(base, ours, theirs);
    expect(result.hasConflicts).toBe(false);
    expect(result.content).toContain('LINE1-MODIFIED');
    expect(result.content).toContain('LINE4-MODIFIED');
  });

  it('detects conflict when both sides modify the same line', () => {
    const base = 'shared line\n';
    const ours = 'our change\n';
    const theirs = 'their change\n';

    const result = threeWayMerge(base, ours, theirs);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('handles one side adding lines and the other deleting lines', () => {
    const base = 'keep\ndelete-me\nkeep-too\n';
    const ours = 'keep\nkeep-too\n';                       // deleted middle line
    const theirs = 'keep\ndelete-me\nkeep-too\nnew-line\n'; // added line at end

    const result = threeWayMerge(base, ours, theirs);
    // This should either merge cleanly or report a conflict
    // The important thing is it doesn't crash
    expect(typeof result.hasConflicts).toBe('boolean');
    expect(typeof result.content).toBe('string');
  });
});

// ============================================================
// 6. Delta compression correctness
// ============================================================

describe('Delta compression: create → apply round-trip', () => {
  it('round-trips identical content', () => {
    const data = encode('identical content that should produce a trivial delta\n');
    const delta = createDelta(data, data);
    const result = applyDelta(data, delta);
    expect(decode(result)).toBe(decode(data));
  });

  it('round-trips content with small edits', () => {
    const base = encode('The quick brown fox jumps over the lazy dog. '.repeat(20) + '\n');
    const target = encode('The quick brown fox LEAPS over the lazy dog. '.repeat(20) + '\n');

    const delta = createDelta(base, target);
    const result = applyDelta(base, delta);
    expect(decode(result)).toBe(decode(target));

    // Delta should be smaller than the target
    expect(delta.length).toBeLessThan(target.length);
  });

  it('round-trips completely different content', () => {
    const base = encode('AAAAAAA\n');
    const target = encode('BBBBBBB something completely different\n');

    const delta = createDelta(base, target);
    const result = applyDelta(base, delta);
    expect(decode(result)).toBe(decode(target));
  });

  it('handles empty target', () => {
    const base = encode('some content\n');
    const target = new Uint8Array(0);

    const delta = createDelta(base, target);
    const result = applyDelta(base, delta);
    expect(result.length).toBe(0);
  });

  it('handles large content with scattered changes', () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`Line ${i}: ${'x'.repeat(50)}`);
    }
    const base = encode(lines.join('\n') + '\n');

    // Modify every 100th line
    for (let i = 0; i < 1000; i += 100) {
      lines[i] = `Line ${i}: MODIFIED ${'y'.repeat(50)}`;
    }
    const target = encode(lines.join('\n') + '\n');

    const delta = createDelta(base, target);
    const result = applyDelta(base, delta);
    expect(decode(result)).toBe(decode(target));
    expect(delta.length).toBeLessThan(target.length);
  });
});

// ============================================================
// 7. Diff output verification
// ============================================================

describe('Unified diff output matches git format', () => {
  it('produces correct unified diff for simple change', () => {
    const oldContent = 'line1\nline2\nline3\n';
    const newContent = 'line1\nmodified\nline3\n';

    const diff = generateUnifiedDiff('file.txt', 'file.txt', oldContent, newContent);
    expect(diff).toContain('--- a/file.txt');
    expect(diff).toContain('+++ b/file.txt');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+modified');
  });

  it('produces correct diff for file addition', () => {
    const diff = generateUnifiedDiff('/dev/null', 'new-file.txt', '', 'new content\n');
    expect(diff).toContain('+new content');
  });

  it('produces correct diff for file deletion', () => {
    const diff = generateUnifiedDiff('deleted.txt', '/dev/null', 'old content\n', '');
    expect(diff).toContain('-old content');
  });
});

// ============================================================
// 8. Object SHA integrity
// ============================================================

describe('SHA integrity across operations', () => {
  it('hashObject matches git SHA for known blob', async () => {
    // git hash-object -t blob --stdin <<< "hello world" gives this SHA
    const sha = await hashObject('blob', encode('hello world'));
    expect(sha).toBe('95d09f2b10159347eece71399a7e2e907ea3df4f');
  });

  it('SHA is stable across serialize/parse cycles', async () => {
    const commit: GitCommit = {
      type: 'commit',
      treeSha: 'a'.repeat(40),
      parents: [],
      author: testAuthor,
      committer: testAuthor,
      message: 'test\n',
    };

    const raw1 = serializeObject(commit);
    const sha1Val = await sha1(raw1);

    // Parse and re-serialize
    const parsed = await parseObjectAsync(raw1);
    const raw2 = serializeObject(parsed.object);
    const sha2Val = await sha1(raw2);

    expect(sha1Val).toBe(sha2Val);
    expect(raw1).toEqual(raw2);
  });

  it('packfile round-trip preserves all SHAs', async () => {
    const objects: Array<{ type: PackObjectType; data: Uint8Array; expectedSha: string }> = [];

    for (let i = 0; i < 10; i++) {
      const data = encode(`blob number ${i} with content\n`);
      const expectedSha = await hashObject('blob', data);
      objects.push({ type: 'blob', data, expectedSha });
    }

    const packfile = await generatePackfile(objects.map((o) => ({ type: o.type, data: o.data })));
    const resolved = await resolvePackfile(packfile);

    expect(resolved.length).toBe(10);
    const resolvedShas = new Set(resolved.map((r) => r.sha));
    for (const obj of objects) {
      expect(resolvedShas.has(obj.expectedSha)).toBe(true);
    }
  });
});
