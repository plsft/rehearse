# @rehearse/git-core

> **Git, anywhere TypeScript runs.** Pure-TypeScript implementation
> of the git protocol — objects, packfiles, smart-HTTP wire,
> Myers diff, three-way merge, refs. **No native dependencies. No
> child-process spawn.** Runs in Cloudflare Workers, browsers, Deno,
> Node, and Bun.

The unique-fit use case: anywhere the system `git` binary isn't an option.
Cloudflare Workers (no native fork), browser sandboxes (no shell), Deno
Deploy (no native FFI), edge runtimes (cold-start sensitive), embedded
TS environments. Most "git for JS" libraries shell out to the system
binary; `@rehearse/git-core` is the wire protocol implemented from
scratch in TypeScript so it works without one.

~2.7k lines of source, ~2.9k lines of tests. **162 tests passing across
8 suites.** Apache 2.0.

[![npm](https://img.shields.io/npm/v/@rehearse/git-core)](https://www.npmjs.com/package/@rehearse/git-core)
[![License](https://img.shields.io/npm/l/@rehearse/git-core)](./LICENSE)
[![Source](https://img.shields.io/badge/source-plsft%2Frehearse-22c55e)](https://github.com/plsft/rehearse)

Standalone library — install it directly when you need git inside a
sandboxed JS runtime. Ships alongside [`@rehearse/cli`](https://www.npmjs.com/package/@rehearse/cli)
as the foundation for future in-process checkout (the runner currently
no-ops `actions/checkout` for local execution since `cwd` is already
the repo, and uses native `git` on the Pro VM).

## Install

```bash
npm install @rehearse/git-core
```

Single runtime dependency: [`pako`](https://github.com/nodeca/pako) for
zlib (the git wire format and packfile encoding rely on it). Pure JS, no
node-gyp.

## What's inside

| Module | Purpose |
| --- | --- |
| `objects` | Blob / tree / commit / tag parse + serialize. SHA-1 via Web Crypto, zlib via `pako`. |
| `packfile` | Packfile parser, REF_DELTA + OFS_DELTA decoder, packfile writer with delta-base search. |
| `protocol` | Smart-HTTP wire — pkt-line / flush / delim framing, capability advertisement, sideband-64k. |
| `client` | Smart-HTTP primitives: ref discovery, upload-pack request building, packfile fetch + sideband demux. |
| `diff` | Myers O(ND) diff with V-array offsetting and trace backtracking. Unified-diff formatter. |
| `merge` | diff3-style three-way merge built on top of `myersDiff`, with conflict-marker emission. |
| `refs` | Symbolic-ref resolution with cycle detection, packed-refs file parser. |

## Quickstart — build a commit in memory

```ts
import {
  hashObject,
  serializeObject,
  serializeTreeContent,
  generatePackfile,
} from '@rehearse/git-core';

// 1. Hash + serialize a blob.
const blobContent = new TextEncoder().encode('hello world\n');
const blobSha = await hashObject('blob', blobContent);
const blobObject = serializeObject({ type: 'blob', content: blobContent });

// 2. Build a tree containing the blob.
const treeContent = serializeTreeContent([
  { mode: '100644', name: 'README.md', sha: blobSha },
]);
const treeSha = await hashObject('tree', treeContent);
const treeObject = serializeObject({ type: 'tree', content: treeContent });

// 3. Build a commit pointing at the tree.
const commitContent = new TextEncoder().encode(
  `tree ${treeSha}\n` +
  `author Alice <a@example.com> 1714500000 +0000\n` +
  `committer Alice <a@example.com> 1714500000 +0000\n` +
  `\n` +
  `init\n`,
);
const commitSha = await hashObject('commit', commitContent);
const commitObject = serializeObject({ type: 'commit', content: commitContent });

// 4. Pack the three objects together for transport.
const pack = await generatePackfile([
  { sha: blobSha,   type: 'blob',   content: blobContent },
  { sha: treeSha,   type: 'tree',   content: treeContent },
  { sha: commitSha, type: 'commit', content: commitContent },
]);
console.log(`packfile is ${pack.length} bytes`);
```

## Quickstart — fetch a remote ref + packfile in pure TS

```ts
import {
  fetchRemoteRefs,
  buildUploadPackRequest,
  fetchPackfile,
  extractPackfileFromSideband,
  resolvePackfile,
} from '@rehearse/git-core';

const url = 'https://github.com/honojs/hono.git';

// 1. Discover refs (info/refs?service=git-upload-pack).
const refs = await fetchRemoteRefs(url);
const mainSha = refs.refs['refs/heads/main'];

// 2. Negotiate a fetch for the main ref + ancestors.
const body = buildUploadPackRequest({
  wants: [mainSha],
  haves: [],
  depth: 1,
});

// 3. POST to git-upload-pack and get the sideband response.
const sideband = await fetchPackfile(url, body);
const { packfile } = extractPackfileFromSideband(sideband);

// 4. Resolve deltas inside the packfile to standalone objects.
const { objects } = await resolvePackfile(packfile);
console.log(`fetched ${objects.size} objects, head=${mainSha}`);
```

(The `client` module exposes the lower-level primitives you compose into
`clone` / `fetch` operations; you bring your own object store — memory,
filesystem, R2, KV, Durable Object, whatever fits the runtime.)

## Why pure TypeScript

- **Workers-friendly.** No native deps, no `child_process`, no
  filesystem assumptions. Runs in any V8 isolate, including Cloudflare
  Workers and Durable Objects.
- **Auditable.** ~2.7k lines of source, ~2.9k lines of tests. You can
  read the implementation in an afternoon.
- **Embeddable.** Use it inside a CI tool, a code review bot, a VCS
  plugin, an MCP server — anywhere the git daemon would be too heavy.
- **Strongly typed.** Every public surface has hand-written TypeScript
  types, not generated `.d.ts` retrofits.

## Repo

Source, issues, roadmap: <https://github.com/plsft/rehearse>.

## License

Apache 2.0.
