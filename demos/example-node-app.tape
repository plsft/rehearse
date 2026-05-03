# GitGate examples/node-app — author in TypeScript, run locally with matrix in parallel
# Run from C:\Code\gitgate root: `vhs demos/example-node-app.tape`
# Output: demos/example-node-app.mp4 (~75 seconds)
#
# Real output captured today:
#   runner compat → 100.0% of 6 steps would execute
#   runner run    → Node app CI  PASS  13.72s  (3 ran, 0 skipped)
#                   ✓ test  11.81s  [node-version=18.x]
#                   ✓ test  12.48s  [node-version=20.x]
#                   ✓ test  12.95s  [node-version=22.x]

Output demos/example-node-app.mp4

Set Shell        "bash"
Set FontSize     15
Set FontFamily   "JetBrains Mono"
Set Width        1280
Set Height       760
Set Padding      24
Set Theme        "Catppuccin Mocha"
Set TypingSpeed  28ms

Hide
Type "cd /c/Code/gitgate/examples/node-app && clear" Enter
Sleep 300ms
# Pre-warm npm so the on-camera numbers are warm
Type "npm install --silent > /dev/null 2>&1" Enter
Sleep 6s
Type "clear" Enter
Show

# §1 — show the source TS pipeline
Type "# examples/node-app — Node + Vitest, matrix [18.x, 20.x, 22.x]" Enter
Sleep 1s
Type "cat .gitgate/pipelines/ci.ts" Enter
Sleep 7s

# §2 — compile to YAML
Type "clear" Enter
Sleep 200ms
Type "# Compile TS → GitHub Actions YAML" Enter
Sleep 800ms
Type "gg ci compile" Enter
Sleep 1.5s
Type "cat .github/workflows/ci.yml | head -25" Enter
Sleep 5s

# §3 — compat audit
Type "clear" Enter
Sleep 200ms
Type "# Compat audit — what would actually execute" Enter
Sleep 800ms
Type "runner compat .github/workflows/ci.yml" Enter
Sleep 5s

# §4 — real run, matrix in parallel
Type "clear" Enter
Sleep 200ms
Type "# Run the workflow locally — 3 cells, parallel via per-cell git worktree" Enter
Sleep 1s
Type "runner run .github/workflows/ci.yml" Enter
Sleep 16s

# §5 — close
Sleep 1s
Type "# Wall-clock ~14s warm — three Node versions, no shared-workspace races" Enter
Sleep 3s
