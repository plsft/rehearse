# GitGate watch mode — save → fail → fix → green
# Run from C:\Code\gitgate root: `vhs demos/watch.tape`
# Output: demos/watch.mp4 (~50s)

Output demos/watch.mp4

Set Shell        "bash"
Set FontSize     16
Set FontFamily   "JetBrains Mono"
Set Width        1280
Set Height       760
Set Padding      24
Set Theme        "Catppuccin Mocha"
Set TypingSpeed  30ms

Hide
Type "cd /c/Code/gitgate && clear" Enter
Sleep 200ms
Type "runner run poc/playground/hono/.github/workflows/ci.yml --cwd poc/playground/hono --job bun > /dev/null 2>&1" Enter
Sleep 8s
Type "clear" Enter
Sleep 200ms
Type "cp poc/playground/hono/runtime-tests/bun/color.test.ts /tmp/color.test.ts.bak" Enter
Sleep 300ms
Type "clear" Enter
Show

# §1 — start watch
Type "# Watch mode — re-runs the workflow on every save" Enter
Sleep 800ms
Type "runner watch poc/playground/hono/.github/workflows/ci.yml -j bun &" Enter
Sleep 9s

# §2 — break a test (echoes appending broken code → triggers watch)
Type "# Break a test — watcher fires on the save" Enter
Sleep 1s
Type "echo 'export const broken = (() => { throw new Error(\"demo\") })()' >> poc/playground/hono/runtime-tests/bun/color.test.ts" Enter
Sleep 8s

# §3 — fix it
Type "# Fix it" Enter
Sleep 800ms
Type "cp /tmp/color.test.ts.bak poc/playground/hono/runtime-tests/bun/color.test.ts" Enter
Sleep 8s

# §4 — close
Type "kill %1 2>/dev/null; wait 2>/dev/null" Enter
Sleep 1.5s
Type "clear" Enter
Sleep 200ms
Type "# Save → FAIL in <1s. Save → PASS in <1.5s." Enter
Type "# No git push. No CI minutes burned." Enter
Sleep 4s

Hide
Type "cp /tmp/color.test.ts.bak poc/playground/hono/runtime-tests/bun/color.test.ts" Enter
Type "rm /tmp/color.test.ts.bak" Enter
Show
