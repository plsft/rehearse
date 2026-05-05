# Rehearse

> **Stop pushing CI failures.** Run your `.github/workflows/*.yml` locally
> before you push. Same YAML, same outcome, in tens of seconds.

Rehearse is a local-first runner for GitHub Actions workflows. It reads your
existing `.github/workflows/*.yml` and executes them on your laptop with two
backends — host (subprocess, fast) and container (Docker, with services and
parity). Free, Apache 2.0, source on `github.com/plsft/rehearse`.

The OSS runner is Apache 2.0, free, and works fully without an account.
A hosted execution target — **Rehearse Pro** ([rehearse.sh/pro](https://rehearse.sh/pro))
— is available for customers who want a private microVM with caches that
persist between runs. Pro is strictly additive: pass `--remote` with a Pro
token and the same OSS runner ships your workflow to your VM; drop the
flag and you're back to local. The OSS runner is and always will be free.

## Quick start

```bash
npm install -g @rehearse/runner

# inside any repo with a .github/workflows/*.yml
runner run .github/workflows/ci.yml
runner watch .github/workflows/ci.yml          # re-run on save
runner install-hook                            # pre-push git hook
```

## Numbers

Head-to-head against [`nektos/act`](https://github.com/nektos/act) on
GitHub-hosted Linux, v0.3.11 warm:

| Target | Rehearse | act | Speedup |
| --- | ---: | ---: | ---: |
| `our-ci` (typecheck + tests, 2 parallel jobs) | **12.19s** | 63.78s | **5.23×** |
| `node-matrix` `[18.x, 20.x, 22.x]` (3 parallel cells) | **1.12s** | 10.07s | **8.99×** |
| `service-postgres` (postgres:16 + 4 psql) | **10.97s** | timeout (>360s) | **32.82×** — act fails |
| `hono-bun` (real OSS, honojs/hono `bun` job) | **7.58s** | n/a (act lacks bun) | — |

Per-OS numbers and full methodology in
[`bench/RESULTS.md`](bench/RESULTS.md). Reproducible with
`gh workflow run bench.yml`.

## Repo layout

```
runner/        — @rehearse/runner    — the CLI (binary: `runner`)
ts-ci/         — @rehearse/ci         — author workflows in TypeScript
git-engine/    — @rehearse/git-core   — pure-TypeScript git protocol
cli/           — @rehearse/cli        — `rh` CLI (compile / convert TS pipelines)
bench/         — runner-vs-act bench harness + results
poc/           — fixture workflows used by the bench harness (vite/hono/etc.)
.rehearse/      — TypeScript source for this repo's own CI
.github/       — generated workflow YAML (do not edit by hand)
```

## What's supported today

- `run:` steps with `bash` / `pwsh` / `cmd` + full `$GITHUB_OUTPUT` / `$GITHUB_ENV` / `$GITHUB_PATH` / `$GITHUB_STEP_SUMMARY` contract
- 18 in-process action shims: `checkout`, `setup-{node,python,go,java,dotnet,bun,pnpm,deno,ruby}`, `rust-toolchain`, `cache` + `/save` + `/restore`, `upload-artifact`, `download-artifact`, `codecov`, `github-script`. `setup-dotnet` is a real shim that runs Microsoft's `dotnet-install.sh` and caches the SDK.
- JavaScript actions (`runs.using: node12 / node16 / node20`, plus forward-compat acceptance of node22 / 24 / 25) — auto-cloned at the requested ref, full `INPUT_*` / `GITHUB_OUTPUT` contract
- `services:` with health checks (Docker network alias wired correctly) — local container backend only
- `strategy.matrix` (variables × include − exclude) — cells run in parallel via per-cell `git worktree`
- `needs:` with topological scheduling and bounded concurrency
- `if:` on jobs and steps — full context: matrix / env / secrets / vars / needs / steps / job / runner / inputs / github
- Local composite actions (`./.github/actions/*`) AND remote (`org/repo[/sub]@ref` — auto-cloned)
- Local reusable workflows (`uses: ./.github/workflows/foo.yml`) with `with:` + `secrets: inherit`
- `${{ matrix… }}`, `${{ env… }}`, `${{ secrets… }}`, `${{ vars… }}`, `${{ runner… }}`, `${{ needs.<job>.outputs.<n> }}`, `${{ steps.<id>.outputs.<n> }}`, `${{ github.* }}`
- `runner --remote` ships the workflow to a Pro VM (auto-detects git origin + SHA + monorepo subdir; ships `--env-file` secrets to `${{ secrets.* }}`)

## Known gaps

- **Remote reusable workflows** (`org/repo/.github/workflows/foo.yml@ref`) — local form works
- **OIDC** / `id-token: write` — use long-lived creds via `--env-file` for now
- **`concurrency:` cancellation** — parsed, not enforced
- **Pro-side `services:`** — works locally via container backend, not yet on hosted Pro VMs

Roadmap lives on the GitHub issues for the repo.

## Local development

```bash
# Requires Node 22+ and pnpm 9+
pnpm install
pnpm turbo typecheck       # passes across all 5 workspace packages
pnpm turbo test             # 323 tests passing across all packages
pnpm --filter @rehearse/runner build
node runner/dist/cli.js run .github/workflows/ci.yml
```

To reproduce the benchmark vs `act`:

```bash
git clone --depth 1 https://github.com/honojs/hono.git poc/playground/hono
docker pull node:22-bookworm-slim postgres:16-alpine catthehacker/ubuntu:act-latest
pnpm tsx bench/compare.ts --skip-cold
```

## Open source

All packages are Apache 2.0, published under the `@rehearse` npm scope.

| Package | Path | What it does |
| --- | --- | --- |
| `@rehearse/runner` | [`runner/`](runner) | The local-first runner CLI |
| `@rehearse/ci` | [`ts-ci/`](ts-ci) | Author workflows in TypeScript |
| `@rehearse/git-core` | [`git-engine/`](git-engine) | Pure-TypeScript git protocol |
| `@rehearse/cli` | [`cli/`](cli) | `rh` — compile / convert TS pipelines |

## Releases

Releases are cut by tagging with `v*.*.*`. The
[release workflow](.github/workflows/release.yml) on `github.com/plsft/rehearse`
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

| Tag form | npm `dist-tag` | GitHub Release | `npm install @rehearse/runner` resolves to |
| --- | --- | --- | --- |
| `v0.2.0` | `latest` | marked `--latest` | `0.2.0` |
| `v0.2.0-next.0` | `next` | marked `--prerelease` | (unchanged; `@next` resolves to it) |
| `v0.2.0-rc.1` | `rc` | marked `--prerelease` | (unchanged; `@rc` resolves to it) |
| `v0.2.0-beta.3` | `beta` | marked `--prerelease` | (unchanged; `@beta` resolves to it) |

Try a prerelease without affecting `latest`:

```bash
npm install @rehearse/runner@next
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
<https://github.com/plsft/rehearse>.
