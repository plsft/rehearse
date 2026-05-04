# Rehearse Pro — full benchmark demo.
# Same workflow run cold, then warm. Demonstrates the persistent-cache benefit.
#
# Run from the repo root:
#   vhs demos/pro-bench.tape
# Output: demos/pro-bench.mp4 (~80 seconds)
#
# Pre-recording: REHEARSE_TOKEN_DEMO must be set in the recording shell, and
# the team's sprite cache should be wiped via the dashboard or ssh into the
# sprite (rm -rf /home/sprite/.npm/_cacache /tmp/bench).
#
# What you'll see:
#   1. The workflow (npm install of 8 popular packages) — 5s
#   2. Run 1 — cold cache, ~12-15s wall
#   3. Run 2 — warm cache, ~6-7s wall (~2× faster)
#   4. Run 3 — warm cache, repeats the win

Output demos/pro-bench.mp4

Set Shell        bash
Set FontSize     15
Set FontFamily   "JetBrains Mono"
Set Width        1280
Set Height       760
Set Padding      24
Set Theme        "Catppuccin Mocha"
Set TypingSpeed  26ms

Hide
Type "cd /tmp && rm -rf rehearse-bench && mkdir rehearse-bench && cd rehearse-bench" Enter
Type "mkdir -p .github/workflows" Enter
Type "cat > .github/workflows/ci.yml <<'EOF'" Enter
Type "name: bench" Enter
Type "on: push" Enter
Type "jobs:" Enter
Type "  install:" Enter
Type "    runs-on: ubuntu-latest" Enter
Type "    steps:" Enter
Type "      - name: install 8 popular packages" Enter
Type "        run: |" Enter
Type "          mkdir -p /tmp/bench && cd /tmp/bench" Enter
Type "          rm -rf node_modules package-lock.json" Enter
Type "          echo '{}' > package.json" Enter
Type "          npm install --silent --no-audit --no-fund typescript vite vitest react react-dom express axios zod hono" Enter
Type "EOF" Enter
Type "export REHEARSE_TOKEN=$REHEARSE_TOKEN_DEMO" Enter
Type "clear" Enter
Show

# §1 — show the workflow
Type "# Workflow: install 8 popular npm packages — typescript, vite, react, etc." Enter
Sleep 800ms
Type "cat .github/workflows/ci.yml" Enter
Sleep 6s

# §2 — Run 1, cold
Type "clear" Enter
Sleep 200ms
Type "# Run 1 — cold cache, fresh sprite. We're paying full network freight." Enter
Sleep 800ms
Type "runner run --remote .github/workflows/ci.yml" Enter
Sleep 16s

# §3 — Run 2, warm
Type "" Enter
Sleep 400ms
Type "# Run 2 — same workflow. The npm cache from run 1 survived on the sprite." Enter
Sleep 800ms
Type "runner run --remote .github/workflows/ci.yml" Enter
Sleep 9s

# §4 — Run 3, warm again
Type "" Enter
Sleep 400ms
Type "# Run 3 — confirming run 2 wasn't a fluke." Enter
Sleep 800ms
Type "runner run --remote .github/workflows/ci.yml" Enter
Sleep 9s

# §5 — close
Type "" Enter
Sleep 600ms
Type "# Cold ~12s. Warm ~6s. ~2x on this workload, measurable on every push." Enter
Sleep 3s
Type "# rehearse.sh/pro" Enter
Sleep 2s
