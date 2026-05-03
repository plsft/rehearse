# Rehearse examples/composite-action-demo — local composite action expansion
# Run from C:\Code\rehearse root: `vhs demos/example-composite-action-demo.tape`
# Output: demos/example-composite-action-demo.mp4 (~60 seconds)
#
# Real output captured today:
#   runner compat → 100.0% of 3 steps would execute
#   runner run    → Composite action demo  PASS  5.17s  (1 ran, 0 skipped)
#   The runner inlines 3 inner steps from the composite into the calling job.

Output demos/example-composite-action-demo.mp4

Set Shell        "bash --noprofile --norc"
Set FontSize     15
Set FontFamily   "JetBrains Mono"
Set Width        1280
Set Height       760
Set Padding      24
Set Theme        "Catppuccin Mocha"
Set TypingSpeed  28ms

Hide
Type "cd /c/Code/rehearse/examples/composite-action-demo && clear" Enter
Sleep 300ms
Type "npm install --silent > /dev/null 2>&1" Enter
Sleep 6s
Type "clear" Enter
Show

# §1 — show the composite action definition
Type "# Local composite action at .github/actions/setup-deps/action.yml" Enter
Sleep 1s
Type "cat .github/actions/setup-deps/action.yml" Enter
Sleep 6s

# §2 — show the caller pipeline (TS)
Type "clear" Enter
Sleep 200ms
Type "# Caller pipeline uses step.action() to invoke the composite" Enter
Sleep 1s
Type "cat .rehearse/pipelines/ci.ts" Enter
Sleep 5s

# §3 — compile + compat
Type "clear" Enter
Sleep 200ms
Type "rh ci compile" Enter
Sleep 1.2s
Type "runner compat .github/workflows/ci.yml" Enter
Sleep 5s

# §4 — real run — composite gets expanded inline
Type "clear" Enter
Sleep 200ms
Type "# Watch the runner inline the composite's inner steps" Enter
Sleep 1s
Type "runner run .github/workflows/ci.yml" Enter
Sleep 7s
Sleep 1s
Type "# Inner steps appear prefixed: ./.github/actions/setup-deps → <step name>" Enter
Sleep 3s
