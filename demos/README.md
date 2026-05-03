# Rehearse demos — VHS tape files

Eight [VHS](https://github.com/charmbracelet/vhs) tape scripts that produce
real `.mp4` videos from a deterministic terminal recording. No screen-capture
software needed — the tape file *is* the recording, and the output is
pixel-identical every time you run it.

## Tapes

### Product overview

| File | Output | Length | What it shows |
| --- | --- | --- | --- |
| `runner.tape` | `runner.mp4` | ~2.5 min | End-to-end runner: install / compat / run / matrix / install-hook / services / bench |
| `ts-pipelines.tape` | `ts-pipelines.mp4` | ~2 min | TypeScript author→compile→view loop: `rh ci init` → vim source → install → compile → vim YAML → `rh ci convert` |
| `watch.tape` | `watch.mp4` | ~50 s | Watch-mode magic: start watch → save broken test → FAIL → save fix → PASS |

### Per-platform examples (one per `examples/` project)

| File | Output | Length | What it shows |
| --- | --- | --- | --- |
| `example-node-app.tape` | `example-node-app.mp4` | ~75 s | Node + Vitest, matrix `[18.x, 20.x, 22.x]` parallel via per-cell git worktree. Real `runner run` end-to-end. |
| `example-composite-action-demo.tape` | ~60 s | Local composite action expansion: see the runner inline `./.github/actions/setup-deps`'s inner steps. Real run end-to-end. |
| `example-python-api.tape` | ~75 s | FastAPI + Postgres service: pipeline source, compiled YAML, compat audit. Run-locally instructions for Docker + Python. |
| `example-php-app.tape` | ~75 s | PHP matrix via `shivammathur/setup-php@v2` (remote JS action): pipeline source, compat audit, JS-action runtime explanation. |
| `example-dotnet-app.tape` | ~75 s | .NET multi-target framework matrix `[net8.0, net9.0]`: pipeline source, compat audit, project layout. |

## Install VHS (once)

```bash
# Windows
scoop install vhs

# macOS
brew install vhs

# Linux
go install github.com/charmbracelet/vhs@latest
# VHS also needs ttyd + ffmpeg on PATH; the brew/scoop installs pull them.
```

## Pre-flight

```bash
# 1. v0.3.3 of runner + cli (latest at writing)
npm install -g @rehearse/runner@latest @rehearse/cli@latest
runner --version    # 0.3.3
rh --version        # 0.3.3

# 2. JetBrains Mono (the tapes call for it)
winget install JetBrains.Mono              # Windows
brew install --cask font-jetbrains-mono    # macOS

# 3. For runner.tape and watch.tape: hono cloned at the bench-expected location
cd C:\Code\rehearse
ls poc/playground/hono/.github/workflows/ci.yml

# 4. Per example tapes: install the example's deps once
cd examples/node-app && npm install              # for example-node-app.tape
cd examples/composite-action-demo && npm install # for example-composite-action-demo.tape
# python-api, php-app, dotnet-app tapes don't need their host toolchain
# installed (they only run rh ci compile + runner compat, not full runner run)
```

## Record

```bash
cd C:\Code\rehearse

# Product overview
vhs demos/runner.tape           # → demos/runner.mp4
vhs demos/ts-pipelines.tape     # → demos/ts-pipelines.mp4
vhs demos/watch.tape            # → demos/watch.mp4

# Per-platform examples
vhs demos/example-node-app.tape
vhs demos/example-composite-action-demo.tape
vhs demos/example-python-api.tape
vhs demos/example-php-app.tape
vhs demos/example-dotnet-app.tape
```

Each tape's wall-clock render time roughly equals its on-screen length
(VHS waits for real commands to finish — when `npm install` takes 3s,
the tape sleeps 3s).

## What the per-platform tapes actually do

Each per-platform tape exercises three of the runner's surfaces against
the matching example:

1. **`cat .rehearse/pipelines/ci.ts`** — the TypeScript source
2. **`rh ci compile`** + **`cat .github/workflows/ci.yml`** — the compiled YAML
3. **`runner compat .github/workflows/ci.yml`** — what would execute,
   per-job

For the two examples whose host requirements are minimal (Node-only:
`node-app`, `composite-action-demo`), the tape **also runs the workflow
end-to-end** with real `runner run`. For the others (Postgres + Docker
for `python-api`; PHP + composer for `php-app`; .NET SDK for `dotnet-app`),
the tape stops at compat and prints the `runner run …` invocation as
text + a comment about the expected output.

This keeps every tape **reproducible from a clean machine** — the heavy
prerequisites are explained on screen but not required to render the video.

## Honest notes

- All five per-platform tapes execute *real* `rh ci compile` and `runner
  compat` commands. The output you see in the recording is the actual
  output of the v0.3.3 toolchain on the example pipelines.
- The two end-to-end examples (`node-app`, `composite-action-demo`)
  pre-warm `npm install` in a hidden setup block so the on-camera run
  is warm-cache. Without pre-warm you'd see a ~5–10 s install on first
  run.
- `runner.tape` and `watch.tape` similarly pre-warm hono so the
  on-camera matrix and bun runs are warm.
- VHS records one terminal at a time. If you want an editor visible
  alongside the watcher (the literal "save → green" magic), record
  that scene manually with OBS / Recordly and a Windows Terminal split.

## Distribution sizes (ballpark)

| Output | Size |
| --- | ---: |
| 1280×760 MP4, ~2 min | ~3–5 MB |
| 1280×760 MP4, ~75 s | ~2–3 MB |
| 1280×760 MP4, ~50 s | ~1.5–2 MB |

GIF output (change `Output foo.gif`) is 5–10× larger but auto-plays
in tweets, GitHub READMEs, and embeds.

## See also

- [`examples/README.md`](../examples/README.md) — the five sample projects each tape demonstrates
- [`bench/RESULTS.md`](../bench/RESULTS.md) — runner-vs-act benchmark numbers referenced in `runner.tape`
- [`rehearse.sh/packages`](https://rehearse.sh/packages) — full package reference
