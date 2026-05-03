# Benchmark — runner vs act

Head-to-head wall-clock timing comparing this repo's runner against
[`nektos/act`](https://github.com/nektos/act), the de-facto incumbent.

## Run it

```bash
# Build the runner first
pnpm --filter @rehearse/runner build

# Optional: shallow-clone hono for the third target
git clone --depth 1 https://github.com/honojs/hono.git poc/playground/hono

# Run the benchmark
pnpm tsx bench/compare.ts

# Or just warm runs (faster)
pnpm tsx bench/compare.ts --skip-cold

# Or one target
pnpm tsx bench/compare.ts --only our-ci
```

## Targets

| Target | Workflow | Backend | act applicable |
| --- | --- | --- | --- |
| `our-ci` | this repo's `ci.yml` | host | yes |
| `service-postgres` | `poc/fixtures/service-postgres.yml` | container | yes |
| `hono-bun` | `honojs/hono` `bun` job | host | no — needs bun in image |

## Apples-to-apples notes

- Both tools point at the same workflow file.
- Both tools target the same job (`-j <name>` for act, `--job` for ours).
- For act we override `ubuntu-latest` → `node:22-bookworm-slim` so neither
  tool is penalised for image choice (`-P ubuntu-latest=node:22-bookworm-slim`).
- act always uses Docker; we run host backend where possible (the
  developer's pre-push loop) and container backend where services or
  cross-platform parity require it.

## Reading the output

Numbers are wall clock from process start to exit. Cold = state immediately
after `docker system prune` / cleared deps; warm = the second run on the
same machine. The "warm speedup" column is `act_warm / ours_warm`.
