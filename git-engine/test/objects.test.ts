import { describe, it, expect } from 'vitest';
import {
  serializeObject,
  parseObjectAsync,
  parseTreeContent,
  serializeTreeContent,
  hashObject,
  encode,
  decode,
  sha1,
  concat,
  hexToBytes,
  bytesToHex,
  type GitBlob,
  type GitTree,
  type GitCommit,
  type GitTag,
  type TreeEntry,
} from '../src/objects';

describe('sha1', () => {
  it('hashes empty string correctly', async () => {
    const hash = await sha1(new Uint8Array(0));
    expect(hash).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('hashes "hello" correctly', async () => {
    const hash = await sha1(encode('hello'));
    expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
  });
});

describe('hexToBytes / bytesToHex', () => {
  it('round-trips correctly', () => {
    const hex = 'aabbccdd00112233';
    expect(bytesToHex(hexToBytes(hex))).toBe(hex);
  });

  it('converts known values', () => {
    const bytes = hexToBytes('ff00');
    expect(bytes[0]).toBe(255);
    expect(bytes[1]).toBe(0);
  });
});

describe('blob', () => {
  it('serializes and parses a blob', async () => {
    const blob: GitBlob = { type: 'blob', data: encode('Hello, World!\n') };
    const raw = serializeObject(blob);

    // Check header
    const header = decode(raw.subarray(0, raw.indexOf(0)));
    expect(header).toBe('blob 14');

    // Parse back
    const parsed = await parseObjectAsync(raw);
    expect(parsed.object.type).toBe('blob');
    expect(decode((parsed.object as GitBlob).data)).toBe('Hello, World!\n');

    // Verify SHA matches git's expected hash for "Hello, World!\n"
    const expectedSha = await hashObject('blob', encode('Hello, World!\n'));
    expect(parsed.sha).toBe(expectedSha);
  });

  it('computes correct SHA for known git blob', async () => {
    // "git hash-object -t blob --stdin <<< 'hello'" produces:
    // ce013625030ba8dba906f756967f9e9ca394464a for "hello\n"
    const sha = await hashObject('blob', encode('hello\n'));
    expect(sha).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('handles empty blob', async () => {
    const blob: GitBlob = { type: 'blob', data: new Uint8Array(0) };
    const raw = serializeObject(blob);
    const parsed = await parseObjectAsync(raw);
    expect(parsed.object.type).toBe('blob');
    expect((parsed.object as GitBlob).data.length).toBe(0);

    // git hash-object -t blob /dev/null = e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
    const sha = await hashObject('blob', new Uint8Array(0));
    expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });
});

describe('tree', () => {
  it('serializes and parses tree entries', () => {
    const entries: TreeEntry[] = [
      { mode: '100644', name: 'file.txt', sha: 'a'.repeat(40) },
      { mode: '040000', name: 'dir', sha: 'b'.repeat(40) },
    ];

    const serialized = serializeTreeContent(entries);
    const parsed = parseTreeContent(serialized);

    // Should be sorted: dir comes before file.txt (dirs get trailing /)
    expect(parsed.length).toBe(2);
    expect(parsed[0]!.name).toBe('dir');
    expect(parsed[0]!.mode).toBe('040000');
    expect(parsed[0]!.sha).toBe('b'.repeat(40));
    expect(parsed[1]!.name).toBe('file.txt');
    expect(parsed[1]!.mode).toBe('100644');
    expect(parsed[1]!.sha).toBe('a'.repeat(40));
  });

  it('round-trips a full tree object', async () => {
    const tree: GitTree = {
      type: 'tree',
      entries: [
        { mode: '100644', name: 'README.md', sha: 'ce013625030ba8dba906f756967f9e9ca394464a' },
        { mode: '100755', name: 'run.sh', sha: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d' },
        { mode: '040000', name: 'src', sha: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' },
      ],
    };

    const raw = serializeObject(tree);
    const parsed = await parseObjectAsync(raw);
    expect(parsed.object.type).toBe('tree');

    const entries = (parsed.object as GitTree).entries;
    expect(entries.length).toBe(3);
    // Verify sorting: src/ (dir) < README.md < run.sh
    expect(entries[0]!.name).toBe('README.md');
    expect(entries[1]!.name).toBe('run.sh');
    expect(entries[2]!.name).toBe('src');
  });

  it('handles symlinks and submodules', () => {
    const entries: TreeEntry[] = [
      { mode: '120000', name: 'link', sha: 'a'.repeat(40) },
      { mode: '160000', name: 'submodule', sha: 'b'.repeat(40) },
    ];

    const serialized = serializeTreeContent(entries);
    const parsed = parseTreeContent(serialized);
    expect(parsed.length).toBe(2);
    expect(parsed[0]!.mode).toBe('120000');
    expect(parsed[1]!.mode).toBe('160000');
  });
});

describe('commit', () => {
  it('round-trips a commit object', async () => {
    const commit: GitCommit = {
      type: 'commit',
      treeSha: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      parents: ['aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'],
      author: {
        name: 'Alice',
        email: 'alice@example.com',
        timestamp: 1700000000,
        tzOffset: '+0000',
      },
      committer: {
        name: 'Alice',
        email: 'alice@example.com',
        timestamp: 1700000000,
        tzOffset: '+0000',
      },
      message: 'Initial commit\n',
    };

    const raw = serializeObject(commit);
    const parsed = await parseObjectAsync(raw);
    expect(parsed.object.type).toBe('commit');

    const c = parsed.object as GitCommit;
    expect(c.treeSha).toBe(commit.treeSha);
    expect(c.parents).toEqual(commit.parents);
    expect(c.author.name).toBe('Alice');
    expect(c.author.email).toBe('alice@example.com');
    expect(c.author.timestamp).toBe(1700000000);
    expect(c.committer.name).toBe('Alice');
    expect(c.message).toBe('Initial commit\n');
  });

  it('handles commit with no parents (root commit)', async () => {
    const commit: GitCommit = {
      type: 'commit',
      treeSha: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      parents: [],
      author: {
        name: 'Bob',
        email: 'bob@example.com',
        timestamp: 1700000000,
        tzOffset: '-0500',
      },
      committer: {
        name: 'Bob',
        email: 'bob@example.com',
        timestamp: 1700000000,
        tzOffset: '-0500',
      },
      message: 'Root commit\n',
    };

    const raw = serializeObject(commit);
    const parsed = await parseObjectAsync(raw);
    const c = parsed.object as GitCommit;
    expect(c.parents.length).toBe(0);
    expect(c.author.tzOffset).toBe('-0500');
  });

  it('handles merge commit with multiple parents', async () => {
    const commit: GitCommit = {
      type: 'commit',
      treeSha: 'a'.repeat(40),
      parents: ['b'.repeat(40), 'c'.repeat(40)],
      author: {
        name: 'Alice',
        email: 'alice@example.com',
        timestamp: 1700000000,
        tzOffset: '+0000',
      },
      committer: {
        name: 'Alice',
        email: 'alice@example.com',
        timestamp: 1700000000,
        tzOffset: '+0000',
      },
      message: 'Merge branch feature\n',
    };

    const raw = serializeObject(commit);
    const parsed = await parseObjectAsync(raw);
    const c = parsed.object as GitCommit;
    expect(c.parents.length).toBe(2);
    expect(c.parents[0]).toBe('b'.repeat(40));
    expect(c.parents[1]).toBe('c'.repeat(40));
  });
});

describe('tag', () => {
  it('round-trips a tag object', async () => {
    const tag: GitTag = {
      type: 'tag',
      objectSha: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      objectType: 'commit',
      tagName: 'v1.0.0',
      tagger: {
        name: 'Alice',
        email: 'alice@example.com',
        timestamp: 1700000000,
        tzOffset: '+0000',
      },
      message: 'Release v1.0.0\n',
    };

    const raw = serializeObject(tag);
    const parsed = await parseObjectAsync(raw);
    expect(parsed.object.type).toBe('tag');

    const t = parsed.object as GitTag;
    expect(t.objectSha).toBe(tag.objectSha);
    expect(t.objectType).toBe('commit');
    expect(t.tagName).toBe('v1.0.0');
    expect(t.tagger.name).toBe('Alice');
    expect(t.message).toBe('Release v1.0.0\n');
  });
});

describe('hashObject', () => {
  it('matches git hash-object for a known blob', async () => {
    // "test content\n" → d670460b4b4aece5915caf5c68d12f560a9fe3e4
    const sha = await hashObject('blob', encode('test content\n'));
    expect(sha).toBe('d670460b4b4aece5915caf5c68d12f560a9fe3e4');
  });
});

describe('error handling', () => {
  it('throws on invalid header (no null byte)', async () => {
    await expect(parseObjectAsync(encode('invalid'))).rejects.toThrow('no null byte');
  });

  it('throws on size mismatch', async () => {
    const raw = concat(encode('blob 5\0'), encode('abc'));
    await expect(parseObjectAsync(raw)).rejects.toThrow('size mismatch');
  });

  it('throws on unknown object type', async () => {
    const raw = concat(encode('unknown 3\0'), encode('abc'));
    await expect(parseObjectAsync(raw)).rejects.toThrow('Unknown git object type');
  });
});
