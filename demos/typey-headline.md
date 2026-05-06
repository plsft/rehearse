# Typey Headline Demo — recording cue sheet

A 5–7 minute screen recording that walks a developer through the full
Rehearse value proposition using **plsft/typey** as the live sample
project. Hits every load-bearing claim on rehearse.sh:

1. YAML editing is the worst part of CI.
2. `@rehearse/ci` lets you author CI in typed TypeScript and compile to
   the same canonical YAML GitHub already runs.
3. The compiled YAML works on **three execution targets** with the same
   binary: local laptop, Pro VM, and stock GitHub Actions.
4. The first two are dramatically faster than the third — and the gap
   gets bigger as your matrix gets wider.

> Recording mode: human-narrated screen capture. Narrate the cues
> verbatim or in your own words; timing assumes ~30s per scene with
> some breathing room. Aim for 6:00 ± 1:00 final length.

---

## Pre-flight

```bash
# v0.6.0+ — single binary `rh` (was: rehearse + rh, two binaries pre-v0.6)
npm install -g @rehearse/cli@latest
rh --version       # 0.6.0

# Clone typey somewhere outside the rehearse repo
cd ~/work
git clone https://github.com/plsft/typey
cd typey

# Pro token in the env (for §6)
export REHEARSE_TOKEN=rh_pro_live_...

# Two terminal windows, both at ~/work/typey
# Terminal 1 = the demo terminal (large font, clean prompt)
# Terminal 2 = browser/editor view of the YAML and TS files

# Pre-warm caches (so demo timing is "warm" not "cold install")
rh run .github/workflows/ci.yml > /dev/null
rh run --remote .github/workflows/ci.yml > /dev/null
clear
```

Browser tabs to have ready:
- `https://github.com/plsft/typey/actions` — for the GH Actions side-by-side
- `https://rehearse.sh/` — closer slide

Editor open to `.github/workflows/ci.yml` in one split, `.rehearse/pipelines/ci.ts` in another (we'll create the TS one mid-demo).

---

## Scene 1 — The hook (0:00–0:25)

**On screen:** Editor with `typey/.github/workflows/ci.yml` open. Side
panel shows the GitHub Actions run history with red ✗ marks scattered
through the last 10 runs.

**Narration:**
> "This is typey — a small Bun CLI I wrote. Three operating systems,
> three Bun versions, full quality gate: prettier, eslint, tsc, test,
> build. A 9-cell matrix. The CI is **94 lines of YAML** that fails on
> me half the time, and every failure costs me **90 seconds before I
> even see the error**. I'm going to show you what fixed that."

> *Cut to terminal 1.*

**Type:**
```bash
wc -l .github/workflows/ci.yml
```
*(shows ~94)*

---

## Scene 2 — YAML pain points (0:25–1:10)

**On screen:** Editor scrolling through `ci.yml`. Cursor highlights
specific bad-smell sections one at a time.

**Narration cues** (point at each as the cursor moves):
1. *(highlight `${{ matrix.os }}-${{ matrix.bun-version }}-${{ ... }}`)* — "Three levels of nested expression escaping. Get one brace wrong and you find out 90 seconds into a CI run."
2. *(highlight a `if:` line)* — "No type checking. I once spent an hour debugging a workflow that had `if: matrix.os == 'macos-latest'` instead of `'macos-latest'` — single quotes vs double, you can't tell from staring at it."
3. *(highlight `needs:` references)* — "Refactor the job name `test` to `quality` and you have to manually update every `needs: [test]` and `${{ needs.test.outputs.* }}` reference. No find-and-replace works because the references are stringly-typed."
4. *(highlight a long copy-paste-with-tweak block)* — "And there's no real reuse without composite actions. Most teams just copy-paste."

**Narration:**
> "YAML for CI is unmaintainable past a few hundred lines. So we
> decided to skip YAML."

---

## Scene 3 — The migration: one command (1:10–1:55)

**On screen:** Terminal 1.

**Narration:**
> "Adopting typed CI on a real repo used to mean rewriting your
> workflow from scratch. We have a one-command migration starter."

**Type:**
```bash
npm install -D @rehearse/ci @rehearse/cli
```
*(brief pause while it installs)*

**Type:**
```bash
npx rh ci convert .github/workflows/ci.yml --out .rehearse/pipelines/
```

**Expected output:**
```
✓ wrote .rehearse/pipelines/ci.ts (52 lines)
ℹ matrix block dropped — hand-port (5–10 min)
ℹ services block dropped — hand-port if needed
```

**Narration:**
> "It handled the bulk — triggers, jobs, runner, all the steps,
> permissions, env. The hard parts — matrix, services, concurrency —
> it flagged for hand-porting. **Five minutes of typing**, not five
> hours."

> *Switch to editor split — show .rehearse/pipelines/ci.ts side-by-side
> with .github/workflows/ci.yml.*

---

## Scene 4 — Author in TypeScript (1:55–2:55)

**On screen:** Editor — `.rehearse/pipelines/ci.ts` open. Show
autocomplete + type errors live.

**Narration:**
> "This is the same pipeline, in TypeScript."

**Cues** (do these live, not narrated unless mentioned):
1. *(hover over `Runner.github(...)`)* — show the inline type signature
   `Runner.github(label: 'ubuntu-latest' | 'macos-latest' | 'windows-latest' | ...)`
2. *(intentionally typo `'macos-latessst'`)* — show the immediate red squiggle.
3. *(rename a job — `test` → `quality`)* — F2/refactor; show every
   `needs: [...]` and `${{ needs.test.outputs.* }}` updating
   automatically across all references.
4. *(import a preset)* — type `import { bun } from '@rehearse/ci/presets'`,
   show autocomplete completing `bun.setup()`, `bun.install()`,
   `bun.test()`, `bun.build()`.

**Narration:**
> "Type-safe. Refactor-safe. Autocomplete on every action input. The
> presets give me named functions instead of `uses:` strings I have to
> memorize. **This is what CI authoring should feel like.**"

---

## Scene 5 — Compile to canonical YAML (2:55–3:30)

**On screen:** Terminal 1.

**Narration:**
> "Now compile."

**Type:**
```bash
npx rh ci compile
```

**Expected output:**
```
✓ .rehearse/pipelines/ci.ts → .github/workflows/ci.yml
```

**Type:**
```bash
diff .github/workflows/ci.yml.bak .github/workflows/ci.yml
```
*(show the diff is essentially identical — same workflow, same shape)*

**Narration:**
> "Same canonical GitHub Actions YAML. **Zero runtime dependency on
> Rehearse** — I can `npm uninstall @rehearse/ci` right now and my CI
> still runs on github.com forever. The TypeScript is authoring-time
> only. **No lock-in.**"

**Type (optional bonus):**
```bash
git diff --stat .github/workflows/ci.yml
```
*(0 changes — round-trip is lossless)*

---

## Scene 6 — Three execution targets (3:30–5:30)

The headline. Same workflow, three places, dramatic timing gap. Do all
three back-to-back so the wall clock is on screen continuously.

### 6a — Local (3:30–4:00)

**On screen:** Terminal 1, full screen.

**Narration:**
> "Now the part that matters. Same workflow. Three places to run it.
> First — my laptop."

**Type:**
```bash
time rh run .github/workflows/ci.yml
```

**Expected (warm cache, v0.5.2 output):**
```
# rehearse · CI
workflow: .github/workflows/ci.yml
jobs:     9  (parallel ≤ 4)

▶ job: test  (host · ubuntu-latest) [os=ubuntu-latest,bun=1.1.34]
  ⊘ Checkout                              checkout — host has the repo
  ⊘ Setup Bun 1.1.34                      setup-bun — using host bun
  ✓ bun install                           80ms
  ✓ Format check                          120ms
  ✓ Lint                                  150ms
  ✓ Typecheck                             180ms
  ✓ Test                                  220ms
  ✓ Build                                 90ms
... (8 more cells, parallel)
────────────────────────────────────────────────────────────────────────
CI  PASS  1.5s  ·  9 jobs in parallel

real    0m1.524s
```

**Narration:**
> "**Sub-two seconds.** All nine cells. On my laptop. Free."

### 6b — Pro VM (4:00–4:30)

**Narration:**
> "Same binary, one flag — runs on a private VM:"

**Type:**
```bash
time rh run --remote .github/workflows/ci.yml
```

**Expected:**
```
... same workflow streaming back from the VM ...
────────────────────────────────────────────────────────────────────────
CI  PASS  4.9s  ·  9 jobs in parallel

real    0m5.012s
```

**Narration:**
> "**Five seconds**, on a single-tenant Linux VM with whole-rootfs
> persistence. Forty-nine bucks a month for 25,000 minutes. Same
> binary. Same YAML. **No different code path.**"

### 6c — GitHub Actions (4:30–5:15)

**On screen:** Switch to browser tab on
`github.com/plsft/typey/actions`. Pull up the most recent run.

**Narration:**
> "And the same workflow, on stock GitHub Actions:"

> *(point at the timing on the most recent run)*

**Show:**
```
Total duration: 1m 35s   ✓ 9/9 cells passed
```

**Narration:**
> "**Ninety-five seconds.** Same workflow. Same nine cells. The only
> difference is where it runs."

> *(switch back to terminal — show all three numbers side by side on a
> static slide if possible)*

```
local  → 1.5s
Pro    → 5.0s
GH     → 95s
```

**Narration:**
> "**Sixty-three times faster on a laptop. Nineteen times faster on
> the VM.** And the gap gets bigger as the matrix gets wider — this is
> 9 cells; on a 27-cell matrix the GH side is hitting four minutes
> while local stays under three seconds."

---

## Scene 7 — The pre-push loop (5:15–5:50)

**On screen:** Terminal 1 + a code editor pane.

**Narration:**
> "And because it's local and instant, you can put it in front of the
> push instead of behind it."

**Type:**
```bash
rh install-hook
```

**Expected:**
```
✓ wrote .git/hooks/pre-push
```

**Narration:**
> "Now `git push` runs CI first. If it's red, the push is **blocked**
> — no failed run on github.com, no Slack ping at 11pm, no `wip: try
> fix` commit on my branch."

**(Optional)** demonstrate `rh watch`:

**Type:**
```bash
rh watch .github/workflows/ci.yml
```

> *Edit a source file, hit save. Watch the workflow re-run in
> sub-second.*

**Narration:**
> "Or `rh watch` for save-triggered reruns. Sub-second on warm
> cache. **The CI feedback loop closes inside your editor.**"

> *Ctrl-C the watch.*

---

## Scene 8 — Close (5:50–6:30)

**On screen:** Browser tab on `https://rehearse.sh/`.

**Narration:**
> "Four packages on npm. All Apache 2.0. The OSS runner is free
> forever. The Pro VM is forty-nine a month for twenty-five thousand
> minutes — intro pricing — same binary, same YAML, no lock-in. If you
> ever uninstall Rehearse your CI keeps running on stock GitHub
> Actions because the compiled YAML is canonical."
>
> "**Three commands to try it:**"

**Show on screen (lower third or as final terminal):**
```bash
npm install -g @rehearse/cli
npx rh ci convert .github/workflows/ci.yml --out .rehearse/pipelines/
rh run .github/workflows/ci.yml
```

**Narration:**
> "**rehearse.sh.** Made by plsft. v0.5.2."

> *(end card / fade out)*

---

## Recording checklist

- [ ] Terminal font: JetBrains Mono, ≥18pt for legibility on 1080p
- [ ] Theme: dark with green accent (matches site brand) — Catppuccin Mocha or similar
- [ ] Window width: 100–110 cols (so output doesn't wrap mid-step)
- [ ] Hide your shell prompt junk (no `(venv)` / git-branch noise) — use a clean PS1
- [ ] Mute keystroke sounds, mute system notifications
- [ ] Pre-warm both caches so the timing reads "warm" — cold install timing is not the headline
- [ ] Record the GH Actions browser side at the same window size as terminal so they cut cleanly
- [ ] `cd ~/work/typey` and `clear` before every scene boundary

## Editing notes

- Cut a 3-up split for Scene 6 (local / Pro / GH side-by-side) if your
  editor supports it — strongest single visual in the demo.
- Lower-third the timing numbers as they happen so they're legible
  even if the output scrolls.
- Captions: encode the narration as subtitles — most viewers watch
  muted on the first pass. Auto-caption tools work but proofread the
  technical terms (`pnpm`, `tsc`, `rehearse`, `ubuntu-latest`).
- Hard-cut the install scenes to ~3s each. The bundled timing leaves
  room for natural pauses; trim them mercilessly in post.

## Distribution

- YouTube: title `Local-first GitHub Actions: typey CI in 1.5s vs 95s on GitHub`
- HN/Reddit: lead with the bench gap, link to `/bench` and the typey repo
- LinkedIn/X: 60s cut starting at Scene 6 with the three-target headline
- Embed on `rehearse.sh/` hero (replaces or supplements the simulated terminal demo)
