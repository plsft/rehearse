# GitGate examples/python-api — FastAPI + pytest + Postgres service container
# Run from C:\Code\gitgate root: `vhs demos/example-python-api.tape`
# Output: demos/example-python-api.mp4 (~75 seconds)
#
# Real output captured today (compat):
#   runner compat → 100.0% of 5 steps would execute
#   Per-job: services=yes (postgres) → backend auto-selects container
#
# To run end-to-end (not in this tape — needs Docker + Python 3.10+ on host):
#   runner run .github/workflows/ci.yml --backend container
# Expected: ~12-20s warm. Postgres healthy via --network-alias, pytest passes.
# act on the same workflow: times out at 360s (act services networking is broken).

Output demos/example-python-api.mp4

Set Shell        "bash"
Set FontSize     15
Set FontFamily   "JetBrains Mono"
Set Width        1280
Set Height       760
Set Padding      24
Set Theme        "Catppuccin Mocha"
Set TypingSpeed  28ms

Hide
Type "cd /c/Code/gitgate/examples/python-api && clear" Enter
Show

# §1 — TS pipeline source
Type "# examples/python-api — FastAPI + pytest + Postgres service" Enter
Sleep 1s
Type "cat .gitgate/pipelines/ci.ts" Enter
Sleep 8s

# §2 — compile + show services block in YAML
Type "clear" Enter
Sleep 200ms
Type "gg ci compile" Enter
Sleep 1.5s
Type "cat .github/workflows/ci.yml | head -25" Enter
Sleep 5s

# §3 — compat audit (highlights services=yes detected)
Type "clear" Enter
Sleep 200ms
Type "# compat detects services: → backend auto-selects container" Enter
Sleep 1s
Type "runner compat .github/workflows/ci.yml" Enter
Sleep 5s

# §4 — explain run-locally requirements + bench reference
Type "clear" Enter
Sleep 200ms
Type "# To run end-to-end:" Enter
Type "#   docker version          # Docker Desktop must be up" Enter
Type "#   python --version        # 3.10+ (setup-python is a host shim)" Enter
Type "#   runner run .github/workflows/ci.yml --backend container" Enter
Sleep 3s
Type "# Expected: ~12-20s warm. act on the same workflow: timeout >360s." Enter
Sleep 2s
Type "# See bench/RESULTS.md for the act-vs-runner numbers." Enter
Sleep 3s
