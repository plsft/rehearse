# @gitgate/git-core

> Pure-TypeScript implementation of the git protocol. No native dependencies.
> Runs on Cloudflare Workers, Node, Bun, Deno, and the browser.

This is the open-source git engine that powers GitGate's provenance chains —
where every event on a pull request becomes a commit on a tiny per-PR repo
stored on Cloudflare Artifacts.

## What's inside

| Module | Lines | Description |
| --- | ---: | --- |
| `objects.ts` | 438 | Blob / tree / commit / tag parsing + serialization, SHA-1, zlib via `pako`. |
| `packfile.ts` | 715 | Packfile reader and writer (incl. ofs-delta, ref-delta, idx generation). |
| `protocol.ts` | 440 | Smart HTTP wire protocol: pkt-line framing, capabilities, refs advertisement, upload-pack / receive-pack negotiation. |
| `client.ts` | 284 | High-level client: clone, fetch, push against a smart-HTTP remote. |
| `diff.ts` | 344 | Myers line diff + tree diff. |
| `merge.ts` | 267 | Three-way merge with conflict markers. |
| `refs.ts` | 167 | Ref parsing, packed-refs, symbolic refs. |

## Install

```bash
npm install @gitgate/git-core
```

Single runtime dependency: [`pako`](https://github.com/nodeca/pako) for zlib.

## Quickstart

```ts
import {
  encodeCommit,
  encodeTree,
  encodeBlob,
  sha1,
  buildPackfile,
} from '@gitgate/git-core';

// Build a tiny commit in memory
const blob = encodeBlob(new TextEncoder().encode('hello world\n'));
const blobSha = await sha1(blob);

const tree = encodeTree([{ mode: '100644', name: 'README.md', sha: blobSha }]);
const treeSha = await sha1(tree);

const commit = encodeCommit({
  treeSha,
  parents: [],
  author: { name: 'Alice', email: 'a@example.com', timestamp: 1714500000, tzOffset: '+0000' },
  committer: { name: 'Alice', email: 'a@example.com', timestamp: 1714500000, tzOffset: '+0000' },
  message: 'init',
});

// Pack the three objects for transport
const pack = await buildPackfile([
  { sha: blobSha, type: 'blob', data: blob },
  { sha: treeSha, type: 'tree', data: tree },
  { sha: await sha1(commit), type: 'commit', data: commit },
]);
```

## Why pure TypeScript?

- **Workers-friendly.** No native deps, no `child_process`, no filesystem
  assumptions. Runs in any V8 isolate, including Cloudflare Workers and
  Durable Objects.
- **Auditable.** ~2.4k lines of source, ~2.7k lines of tests. You can read it.
- **Embeddable.** Use it inside a CI tool, a code review bot, a VCS plugin,
  or — in our case — a per-PR audit-trail repo writer.

## License

Apache 2.0.
