# Rehearse Pro — 20-second elevator demo.
# Same binary, two backends, switch with a flag.
#
# Renders on Linux (CI) but hangs on Windows + Git Bash. Use the GH workflow
# at .github/workflows/render-demos.yml or render via Docker:
#
#   docker run --rm -v $PWD:/vhs -e REHEARSE_TOKEN_DEMO ghcr.io/charmbracelet/vhs vhs /vhs/demos/pro-elevator.tape
#
# Output: demos/pro-elevator.mp4

Output demos/pro-elevator.mp4

Set Shell        "bash --noprofile --norc"
Set FontSize     16
Set FontFamily   "JetBrains Mono"
Set Width        1100
Set Height       620
Set Padding      28
Set Theme        "Catppuccin Mocha"
Set TypingSpeed  30ms

Hide
Type "mkdir -p /tmp/demo/.github/workflows" Enter
Type "cat > /tmp/demo/.github/workflows/ci.yml <<EOF" Enter
Type "name: ci" Enter
Type "on: push" Enter
Type "jobs:" Enter
Type "  test:" Enter
Type "    runs-on: ubuntu-latest" Enter
Type "    steps:" Enter
Type "      - run: node --version" Enter
Type "      - run: echo hello from rehearse" Enter
Type "EOF" Enter
Type "cd /tmp/demo" Enter
Type "export REHEARSE_TOKEN=$REHEARSE_TOKEN_DEMO" Enter
Type "clear" Enter
Show

# §1 — show the workflow
Type "# A standard GitHub Actions workflow." Enter
Sleep 800ms
Type "cat .github/workflows/ci.yml" Enter
Sleep 3500ms

# §2 — local
Type "clear" Enter
Sleep 200ms
Type "# Run it locally — free, no service required." Enter
Sleep 700ms
Type "rehearse run .github/workflows/ci.yml" Enter
Sleep 7s

# §3 — remote
Type "" Enter
Sleep 400ms
Type "# Same workflow, opt into hosted runner with --remote:" Enter
Sleep 700ms
Type "rehearse run --remote .github/workflows/ci.yml" Enter
Sleep 9s

# §4 — close
Sleep 800ms
Type "# Local for free. Cloud for $49/mo. Same binary. Same YAML." Enter
Sleep 3s
