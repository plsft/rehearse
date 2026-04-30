# Licensing

GitGate is a mixed-license repository. Some packages are open source (Apache 2.0)
and published to npm. The hosted Platform is source-available — readable in this
repo for transparency, but the licensed product is the running service at
`api.gitgate.com`.

## Open Source — Apache 2.0

These packages are published to npm and free to use, modify, and redistribute
under the [Apache 2.0 License](https://www.apache.org/licenses/LICENSE-2.0). Each
package contains its own `LICENSE` file.

| Package | npm | Source | License |
| --- | --- | --- | --- |
| `@gitgate/ci` | [npm](https://www.npmjs.com/package/@gitgate/ci) | [`packages/ci`](packages/ci) | Apache 2.0 |
| `@gitgate/git-core` | [npm](https://www.npmjs.com/package/@gitgate/git-core) | [`packages/git-core`](packages/git-core) | Apache 2.0 |
| `gg` | [npm](https://www.npmjs.com/package/gg) | [`cli`](cli) | Apache 2.0 |

These three packages have **no runtime dependency on the GitGate Platform**. The
CI SDK compiles to standalone GitHub Actions YAML. The CLI's `ci` subcommands
are local-only. The git engine is pure TypeScript with one dep on `pako`. You
can fork, ship, and forget about us.

## Source-available — Proprietary

These directories are readable in the public repo so you can audit the product
behind GitGate, but they are **not licensed for redistribution or self-hosting**.
The hosted service at `api.gitgate.com` is the licensed product.

| Path | What it is |
| --- | --- |
| `apps/api` | The Cloudflare Worker hosting the GitGate Platform API (governance, scoring, provenance, leaderboards). |
| `apps/site` | The marketing site at `gitgate.com`. |
| `packages/db` | D1 schema for the platform. |
| `packages/shared` | Internal types used by the platform and the GitHub adapter. |

If you want governance for your own organization without using the hosted
service, contact us at <hello@gitgate.com> about an Enterprise plan with a
self-hosted tenant.

## Contribution

External contributions are welcome on the **open-source packages only**. See
[CONTRIBUTING.md](CONTRIBUTING.md). Pull requests against the source-available
directories will be closed.

## Trademarks

"GitGate" and the GitGate logo are trademarks of FlareFound. The Apache 2.0
license does not grant trademark rights. Forks of the OSS packages must not
use the GitGate name or logo without permission.
