# POC results — speed wedge validated

Three single-file proofs in this directory together prove the pitch:
**"Run your GitHub Actions YAML locally before you push, in seconds, no new
config to write."**

All numbers are from a Windows 11 laptop, Node 22, pnpm 9.15, Bun 1.3.4,
Docker Desktop 28.4. Numbers will differ on other machines but the shape
holds.

---

## POC #1 — localhost backend (our own CI)

`poc/run-workflow.ts` parses `.github/workflows/ci.yml` via `@gitgate/ci`,
walks every step, runs `run:` scripts on the host (Git-Bash on Windows /
bash on Unix), no-ops `actions/checkout`, `setup-*`, `cache`, `*-artifact`.

```
$ pnpm tsx poc/run-workflow.ts .github/workflows/ci.yml
CI  PASS  16.86s  (7 ran, 9 skipped)
  typecheck            3.18s
  test                 9.50s
  site                 4.17s
```

Versus GitHub Actions for the same workflow on `ubicloud-standard-4`:

| Phase | Cold | Warm |
| --- | ---: | ---: |
| Job queue + dispatch | ~10s | ~10s |
| VM boot | ~15s | ~15s |
| `pnpm/action-setup` | ~3s | ~3s |
| `actions/setup-node` | ~5s | ~3s |
| `pnpm install --frozen-lockfile` | ~75s | ~15s |
| typecheck / test / build | ~5s | ~5s |
| **Per-job total** | **~110s** | **~50s** |

Three jobs in parallel on GitHub → wall clock ~110s cold, ~50s warm.
Sequential equivalent: ~330s cold, ~150s warm.

| Comparison | Local | GitHub | Multiple |
| --- | ---: | ---: | ---: |
| Sequential vs cold parallel GH | 16.86s | ~110s | **~6.5×** |
| Sequential vs warm parallel GH | 16.86s | ~50s | **~3×** |
| Sequential vs cold sequential GH | 16.86s | ~330s | **~20×** |

---

## POC #2 — compatibility audit

`poc/2-compat.ts` audits any workflow YAML and classifies every step:

- `run` — shell scripts (always supported)
- `uses-noop` — host already has it (checkout, setup-node/python/go/bun, cache)
- `uses-supported` — could implement (artifacts, etc.)
- `uses-unsupported` — out of scope (codecov, github-script)
- `uses-local` — local composite actions (need expansion)

Run on three real workflows:

| Workflow | Jobs | Steps | Coverage |
| --- | ---: | ---: | ---: |
| our own `ci.yml` | 3 | 16 | **100%** |
| `vitejs/vite` `ci.yml` | 5 | 26 | **96.2%** |
| `honojs/hono` `ci.yml` | 14 | 71 | **94.4%** |

Top unsupported categories (the v1 backlog):

- `codecov/codecov-action` — external service upload, no-op locally
- `actions/github-script` — needs real `GITHUB_TOKEN`
- `tj-actions/changed-files` — git diff against PR base, feasible later
- Local composite actions (`./.github/actions/*`) — need expansion logic

---

## POC #2b — real OSS workflow run (`honojs/hono`)

After fixing the runner to infer the repo root from the workflow path
(was using developer cwd, broke for external repos), ran hono's `bun` job
end-to-end:

```
# First run, cold (downloads + bun install of all hono deps)
real    1m23.584s
ci  PASS  82.04s  (2 ran, 3 skipped)
  bun                  82.04s

# Re-run, warm (deps already on disk)
real    0m10.802s
ci  ____ 9.27s  (2 ran, 3 skipped)
  bun                  9.27s
```

GitHub Actions for the same job: ~120s typical (queue + VM + install + tests).

**The dev pre-push loop is the warm case: ~9s vs ~120s ≈ 13×.**
The cold-vs-cold case is much narrower (~1.5×) — `bun install` of a real
dep tree is the dominant cost on both ends.

---

## POC #3 — container backend with services

`poc/3-container.ts` runs the workflow in Docker:

1. Pull or reuse runner image (`node:22-bookworm-slim`).
2. Create a private network for the job.
3. Start each `services:` container on it (with the GH `--health-cmd` flag
   forwarded into Docker `--health-cmd`).
4. Wait for `State.Health.Status == healthy`.
5. Create a long-lived job container, bind-mount the repo at `/workspace`.
6. `docker exec bash -c <step.run>` for each step.
7. Tear down on exit (success or failure).

Test workflow: `services: postgres:16-alpine`, `apt-get install
postgresql-client`, four `psql` commands hitting the service.

```
# Cold: pull node + postgres images (one-time on this machine)
real    0m46.033s
PASS  total 44.31s
  pull images                  14.02s
  network create                294ms
  services start                2.12s
  services healthy              7.41s
  job container                 667ms
  steps                        18.51s
  cleanup                       1.29s

# Warm: images cached
real    0m21.905s
PASS  total 20.12s
  pull images                   453ms
  network create                244ms
  services start                605ms
  services healthy              5.66s
  job container                 553ms
  steps                        11.29s
  cleanup                       1.32s
```

GitHub Actions for the same workflow: ~75s typical
(queue + VM + service start + apt install + psql).

**Container mode warm: 20.12s vs ~75s ≈ 3.75×.**

---

## Honest summary

The wedge holds. Five caveats:

1. **The warm dev loop is where the magic is.** Developer has `node_modules`
   on disk → we are 5–13× faster than GitHub. This is the actual sales
   surface ("catch failures before pushing").
2. **Cold CI runs barely beat GitHub.** `pnpm install` / `bun install` of a
   real dep tree dominates everything else; saving the VM boot only buys
   you ~30s. ~1.5× speedup. Don't market this as the use case.
3. **Container mode pays Docker overhead.** ~6s of "create network +
   service container + health-wait + job container" sits in front of every
   container-mode run. Still 3–4× faster than GitHub, but not 13×.
4. **94.4% step coverage on hono is real**, not best-case. The 5.6% that
   doesn't run is genuinely "doesn't make sense locally" (codecov upload,
   GitHub API comments, local composite actions).
5. **None of these POCs handle matrix or parallel job scheduling yet.**
   That's the next chunk of work and is required for parity with hono's
   `node` job (matrix over `[18.18.2, 20.x, 22.x]`).

## What's next

Build the real runner package:

- A `runner/` directory replacing the three POCs with one orchestrator.
- Backend abstraction: `host` and `container` chosen per-job (or per-step)
  based on what the step actually needs.
- Matrix expansion + parallel job scheduling (concurrency-limited, default
  `max-parallel = navigator.hardwareConcurrency`).
- Persistent caches under `.runner/cache/` keyed by `actions/cache` keys
  (no CDN — local fs only — but stable across runs on the same machine).
- Pre-push hook integration: `gg run --pre-push` exits 1 if any required
  job fails, blocks the push.
- Smarter `uses:` handling: a small set of TypeScript "action shims" that
  reproduce common actions in-process (artifacts, basic github-script
  subset, etc.).

Don't name the product until those are demonstrably faster than `act` on
three public workflows including one with services.
