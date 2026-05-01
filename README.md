# GitGate

> **Stop pushing CI failures.** Run your `.github/workflows/*.yml` locally
> before you push. Same YAML, same outcome, in tens of seconds.

GitGate is a local-first runner for GitHub Actions workflows. It reads your
existing `.github/workflows/*.yml` and executes them on your laptop with two
backends — host (subprocess, fast) and container (Docker, with services and
parity). Free, Apache 2.0, source on `github.com/plsft/gitgate`.

This is a single-developer, alpha-quality project. There is no hosted
service, no paid tier, no API. Just a CLI you install via npm.

## Quick start

```bash
npm install -g @gitgate/runner

# inside any repo with a .github/workflows/*.yml
runner run .github/workflows/ci.yml
runner watch .github/workflows/ci.yml          # re-run on save
runner install-hook                            # pre-push git hook
```

## Numbers

Head-to-head against [`nektos/act`](https://github.com/nektos/act) on a
Windows 11 laptop, warm runs:

| Target | GitGate | act | Speedup |
| --- | ---: | ---: | ---: |
| typecheck + 202 tests, 2 parallel jobs | **9.09s** | 30.28s | **3.33×** |
| node matrix `[18.x, 20.x, 22.x]` | **4.63s** | 24.55s | **5.30×** |
| `services: postgres:16-alpine` | **20.50s** | timeout (>360s) | act fails |
| real OSS workflow (honojs/hono `bun` job) | **6.09s** | n/a (act lacks bun) | — |

Full methodology and reproducibility instructions in
[`bench/RESULTS.md`](bench/RESULTS.md). Cold-vs-cold is much narrower —
a fresh `pnpm install` dominates everything; the wedge is the warm dev
pre-push loop.

## Repo layout

```
runner/        — @gitgate/runner    — the CLI (binary: `runner`)
ts-ci/         — @gitgate/ci         — author workflows in TypeScript
git-engine/    — @gitgate/git-core   — pure-TypeScript git protocol
cli/           — @gitgate/cli        — `gg` CLI (compile / convert TS pipelines)
bench/         — runner-vs-act bench harness + results
poc/           — single-file proofs that informed the runner architecture
old/           — pre-pivot code, frozen for reference
.gitgate/      — TypeScript source for this repo's own CI
.github/       — generated workflow YAML (do not edit by hand)
```

## What's supported today

- `run:` steps with `bash` / `pwsh` / `cmd`
- `uses:` for the top ~15 most-popular actions in-process
  (checkout, setup-node/python/go/bun, cache, artifacts)
- `services:` with health checks (Docker network alias wired correctly)
- `strategy.matrix` (variables × include − exclude)
- `needs:` with parallel scheduling (across distinct jobs)
- `if:` on jobs and steps — useful subset of the expression language
- Local composite actions (`./.github/actions/*`)
- `${{ matrix… }}`, `${{ env… }}`, `${{ secrets… }}`, `${{ runner… }}`,
  `${{ needs.<job>.outputs.<n> }}`, `${{ steps.<id>.outputs.<n> }}`,
  `${{ github.* }}` (subset)

## Known gaps

- **Per-cell matrix workspace isolation** — cells share the host workspace,
  so they currently run *sequentially* to avoid races on writes (e.g.
  `coverage/.tmp`). Per-cell git-worktree is on the roadmap and will let
  cells run in parallel.
- **JS-action runtime** — composite is supported; `runs.using: node20`
  actions still skip with a documented "no shim" reason.
- **Real `actions/upload-artifact` / `download-artifact`** — currently
  no-op shims. Local-fs implementation is straightforward; not yet wired.
- **Reusable workflows** (`uses: ./.github/workflows/foo.yml`).
- **Remote composite actions** (`org/repo/path@ref` — needs git fetch).
- **OIDC** / `id-token: write`.
- **`concurrency:` cancellation**.

The roadmap lives on the GitHub issues for the repo.

## Local development

```bash
# Requires Node 22+ and pnpm 9+
pnpm install
pnpm turbo typecheck       # passes across all 5 workspace packages
pnpm turbo test             # 264 tests passing
pnpm --filter @gitgate/runner build
node runner/dist/cli.js run .github/workflows/ci.yml
```

To reproduce the benchmark vs `act`:

```bash
git clone --depth 1 https://github.com/honojs/hono.git poc/playground/hono
docker pull node:22-bookworm-slim postgres:16-alpine catthehacker/ubuntu:act-latest
pnpm tsx bench/compare.ts --skip-cold
```

## Open source

All packages are Apache 2.0, published under the `@gitgate` npm scope.

| Package | Path | What it does |
| --- | --- | --- |
| `@gitgate/runner` | [`runner/`](runner) | The local-first runner CLI |
| `@gitgate/ci` | [`ts-ci/`](ts-ci) | Author workflows in TypeScript |
| `@gitgate/git-core` | [`git-engine/`](git-engine) | Pure-TypeScript git protocol |
| `@gitgate/cli` | [`cli/`](cli) | `gg` — compile / convert TS pipelines |

## Releases

Releases are cut by tagging with `v*.*.*`. The
[release workflow](.github/workflows/release.yml) on `github.com/plsft/gitgate`
handles npm publishing and GitHub Release creation automatically.

```bash
# Stable release: bumps version everywhere, commits, tags, pushes.
pnpm release patch       # 0.1.0 → 0.1.1
pnpm release minor       # 0.1.0 → 0.2.0
pnpm release major       # 0.1.0 → 1.0.0

# Prerelease channel: published with `--tag next` (or rc / beta).
pnpm release prerelease           # 0.1.0 → 0.1.1-next.0
pnpm release prerelease:rc        # 0.1.0 → 0.1.1-rc.0
pnpm release prerelease:beta      # 0.1.0 → 0.1.1-beta.0

# Explicit version (rare):
pnpm release 0.2.0-rc.1

# Sanity check what would happen:
pnpm release patch --dry
```

What the workflow does on every `v*.*.*` push:

| Tag form | npm `dist-tag` | GitHub Release | `npm install @gitgate/runner` resolves to |
| --- | --- | --- | --- |
| `v0.2.0` | `latest` | marked `--latest` | `0.2.0` |
| `v0.2.0-next.0` | `next` | marked `--prerelease` | (unchanged; `@next` resolves to it) |
| `v0.2.0-rc.1` | `rc` | marked `--prerelease` | (unchanged; `@rc` resolves to it) |
| `v0.2.0-beta.3` | `beta` | marked `--prerelease` | (unchanged; `@beta` resolves to it) |

Try a prerelease without affecting `latest`:

```bash
npm install @gitgate/runner@next
```

GitHub Release notes are auto-generated by
[`gh release create --generate-notes`](https://cli.github.com/manual/gh_release_create)
based on the PRs and commits since the previous tag — no hand-written
CHANGELOG file to keep up to date.

## License

Apache 2.0 across the board. See [`LICENSE`](LICENSE) and individual
package directories for the per-package copies.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Issues and PRs welcome at
<https://github.com/plsft/gitgate>.
