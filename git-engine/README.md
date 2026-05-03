# @rehearse/git-core

> Pure-TypeScript implementation of the git protocol. No native
> dependencies. Runs on Cloudflare Workers, Node, Bun, Deno, and the
> browser.

A complete-enough git for in-process work: parse and serialize objects,
read and write packfiles, speak the smart-HTTP wire protocol, do diffs
and three-way merges, manage refs. ~2.4k lines of source, **162 tests
passing**.

[![npm](https://img.shields.io/npm/v/@rehearse/git-core)](https://www.npmjs.com/package/@rehearse/git-core)
[![License](https://img.shields.io/npm/l/@rehearse/git-core)](./LICENSE)
[![Source](https://img.shields.io/badge/source-plsft%2Frehearse-22c55e)](https://github.com/plsft/rehearse)

Used internally by [`@rehearse/runner`](https://www.npmjs.com/package/@rehearse/runner)
to run `actions/checkout` and read repo state without shelling out to
system git. Standalone-useful for any tool that needs to manipulate
git objects in-process.

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
| `objects` | Blob / tree / commit / tag parsing + serialization. SHA-1, zlib via `pako`. |
| `packfile` | Packfile reader and writer. ofs-delta, ref-delta, idx generation. |
| `protocol` | Smart-HTTP wire protocol — pkt-line framing, capabilities, refs advertisement, upload-pack / receive-pack negotiation. |
| `client` | High-level smart-HTTP client: `clone`, `fetch`, `push`. |
| `diff` | Myers line diff + tree diff. |
| `merge` | Three-way merge with conflict markers. |
| `refs` | Ref parsing, packed-refs, symbolic refs. |

## Quickstart — build a commit in memory

```ts
import {
  encodeBlob,
  encodeTree,
  encodeCommit,
  sha1,
  buildPackfile,
} from '@rehearse/git-core';

const blob = encodeBlob(new TextEncoder().encode('hello world\n'));
const blobSha = await sha1(blob);

const tree = encodeTree([
  { mode: '100644', name: 'README.md', sha: blobSha },
]);
const treeSha = await sha1(tree);

const commit = encodeCommit({
  treeSha,
  parents: [],
  author:    { name: 'Alice', email: 'a@example.com', timestamp: 1714500000, tzOffset: '+0000' },
  committer: { name: 'Alice', email: 'a@example.com', timestamp: 1714500000, tzOffset: '+0000' },
  message: 'init',
});
const commitSha = await sha1(commit);

// Pack the three objects together for transport
const pack = await buildPackfile([
  { sha: blobSha,   type: 'blob',   data: blob },
  { sha: treeSha,   type: 'tree',   data: tree },
  { sha: commitSha, type: 'commit', data: commit },
]);
```

## Quickstart — clone a remote in pure TS

```ts
import { gitClone } from '@rehearse/git-core';

const result = await gitClone({
  url: 'https://github.com/honojs/hono.git',
  ref: 'refs/heads/main',
  // pluggable storage interface — write objects/refs to memory, fs,
  // R2, KV, whatever you have.
  storage: myObjectStore,
});

console.log(result.headSha);
```

## Why pure TypeScript

- **Workers-friendly.** No native deps, no `child_process`, no
  filesystem assumptions. Runs in any V8 isolate, including Cloudflare
  Workers and Durable Objects.
- **Auditable.** ~2.4k lines of source, ~2.7k lines of tests. You can
  read the implementation in an afternoon.
- **Embeddable.** Use it inside a CI tool, a code review bot, a VCS
  plugin, an MCP server — anywhere the git daemon would be too heavy.
- **Strongly typed.** Every public surface has hand-written TypeScript
  types, not generated `.d.ts` retrofits.

## Repo

Source, issues, roadmap: <https://github.com/plsft/rehearse>.

## License

Apache 2.0.
