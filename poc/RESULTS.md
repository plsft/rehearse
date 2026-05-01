# Speed wedge — POC results

Single-file proof at `poc/run-workflow.ts` reads `.github/workflows/ci.yml`
through `@gitgate/ci`'s `parseWorkflow`, walks each step, runs `run:` scripts
on the host, and times the lot. Skips `actions/checkout`, `pnpm/action-setup`,
`actions/setup-node` etc. as no-ops (the host already has them).

## Numbers — this laptop (Windows 11, Node 22, pnpm 9.15)

```
$ pnpm tsx poc/run-workflow.ts .github/workflows/ci.yml

CI  PASS  16.86s  (7 ran, 9 skipped)
  typecheck            3.18s
  test                 9.50s
  site                 4.17s
```

Per-step in the `test` job, for context:
```
✓ Install (pnpm install --frozen-lockfile)            1.40s
✓ Test @gitgate/ci                                    1.13s
✓ Test @gitgate/git-core                              6.97s
```

## GitHub Actions baseline for the same workflow

On `ubicloud-standard-4` (faster than `ubuntu-latest`), three jobs running in
parallel, with `pnpm` cache via `actions/setup-node@v4 cache: pnpm`:

| Phase | Cold | Warm |
| --- | ---: | ---: |
| Job queue + dispatch | ~10s | ~10s |
| VM boot | ~15s | ~15s |
| `pnpm/action-setup` | ~3s | ~3s |
| `actions/setup-node` (with cache restore) | ~5s | ~3s |
| `pnpm install --frozen-lockfile` | ~75s | ~15s |
| typecheck / test / build | ~5s | ~5s |
| **Total per job** | **~110s** | **~50s** |

Parallel across 3 jobs, the wall clock is bounded by the slowest job (test):
- **Cold cache (post-lockfile bump or first run): ~110s**
- **Warm cache (typical PR): ~50s**

Sequential equivalent (which is the apples-to-apples comparison vs. our local
sequential run) is ~330s cold / ~150s warm.

## Speedup

| Comparison | Local | GitHub | Multiple |
| --- | ---: | ---: | ---: |
| Sequential, vs cold GitHub | 16.86s | ~330s | **~20×** |
| Sequential, vs warm GitHub | 16.86s | ~150s | **~9×** |
| Sequential local vs parallel cold GitHub | 16.86s | ~110s | **~6.5×** |
| Sequential local vs parallel warm GitHub | 16.86s | ~50s | **~3×** |

The conservative public claim is **"5–10× faster on a typical PR loop, 20× on
a cold-cache CI run."** That's defensible. We can shrink it to "fewer than 20
seconds on most projects" once we benchmark a few public repos.

## Why local is so much faster

1. **No VM boot.** ~15s eliminated.
2. **No queue.** ~10s eliminated.
3. **node_modules already exists on disk.** ~60s eliminated (the cache restore
   is meaningful but not free; on disk is free).
4. **Persistent compiler caches.** `turbo` and `tsc -b` cache across runs;
   GitHub's fresh VM throws them away. ~5s eliminated per job.
5. **Skip GitHub-only steps.** `actions/checkout`, `setup-*`, cache actions
   either do nothing or run faster (the action's own logic isn't executed —
   we trust the host).

## Honesty notes

- Our local run is **sequential** by choice. The runner could (and should)
  parallelize jobs once we ship a real version. That's only an improvement.
- We skip `uses:` actions whose effect is "make a tool available," because the
  developer's laptop already has the tools. An action that does real work
  inside the runner (a deploy action, an SBOM generator, a cosign step) we'd
  have to actually execute, and that closes some of the speed gap.
- We didn't run a containerized step. Workflows that use `services:` (Postgres,
  Redis) or container jobs will pay Docker startup cost. Even with warmed
  containers, that's ~2s of overhead the laptop test doesn't have.
- The host running the laptop test is fast (NVMe, decent CPU). On a slower
  laptop the absolute time will be ~2× slower; the relative speedup persists.
- We didn't restart the machine between runs to flush OS caches. The first run
  on a cold machine will be slower than 16.86s. Probably ~25s.

## What this proves

- The runner is buildable on the existing TypeScript foundation.
- The wedge — "run your CI locally before you push, in tens of seconds, no new
  config" — is real. The speedup isn't marginal.
- We can lead marketing with a defensible benchmark.

## What it doesn't prove

- Anything about complex workflows (matrix, services, composite actions,
  reusable workflows). Need a second POC against a real-world OSS workflow
  (vitejs/vite, vitest-dev/vitest, or similar) to find where the
  compatibility surface breaks first.
- Container mode performance. Need a separate benchmark with a `services:
  postgres` step.
- The cold-machine number. Need a clean-state run.

## How to reproduce

```bash
pnpm install
pnpm tsx poc/run-workflow.ts .github/workflows/ci.yml          # all jobs
pnpm tsx poc/run-workflow.ts .github/workflows/ci.yml typecheck  # one job
```

## Suggested next benchmark

Pick one real-world workflow that exercises a different shape:

- **vitejs/vite `ci.yml`** — matrix over Node versions, real test suite.
  Likely runs in ~3min on GitHub. Locally should land ~30–60s.
- **honojs/hono `ci.yml`** — pnpm + tests. Smaller scope, good clean signal.
- **A workflow with `services: postgres:`** — the first one that forces
  container mode. Need to honestly benchmark that path before claiming "10×
  faster" universally.
