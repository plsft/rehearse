# GitGate examples/dotnet-app — .NET (C#) + xUnit, multi-target framework matrix
# Run from C:\Code\gitgate root: `vhs demos/example-dotnet-app.tape`
# Output: demos/example-dotnet-app.mp4 (~75 seconds)
#
# Real output captured today (compat):
#   runner compat → 100.0% of 7 steps would execute
#   Matrix: framework [net8.0, net9.0]
#
# To run end-to-end (not in this tape — needs .NET 8 or 9 SDK on host):
#   runner run .github/workflows/ci.yml
# actions/setup-dotnet@v4 is shimmed as a host no-op (uses your installed
# dotnet). 2 cells parallel via per-cell git worktree.

Output demos/example-dotnet-app.mp4

Set Shell        "bash --noprofile --norc"
Set FontSize     15
Set FontFamily   "JetBrains Mono"
Set Width        1280
Set Height       760
Set Padding      24
Set Theme        "Catppuccin Mocha"
Set TypingSpeed  28ms

Hide
Type "cd /c/Code/gitgate/examples/dotnet-app && clear" Enter
Show

# §1 — TS pipeline source
Type "# examples/dotnet-app — multi-target framework matrix [net8.0, net9.0]" Enter
Sleep 1s
Type "cat .gitgate/pipelines/ci.ts" Enter
Sleep 8s

# §2 — compile + show YAML
Type "clear" Enter
Sleep 200ms
Type "gg ci compile" Enter
Sleep 1.5s
Type "cat .github/workflows/ci.yml | head -30" Enter
Sleep 5s

# §3 — compat audit
Type "clear" Enter
Sleep 200ms
Type "# compat detects matrix=yes, setup-dotnet host-shimmed" Enter
Sleep 1s
Type "runner compat .github/workflows/ci.yml" Enter
Sleep 5s

# §4 — show the project structure and explain run-locally
Type "clear" Enter
Sleep 200ms
Type "ls src/MyApp tests/MyApp.Tests" Enter
Sleep 3s
Type "" Enter
Type "# To run end-to-end:" Enter
Type "#   dotnet --list-sdks      # need .NET 8 or 9 SDK" Enter
Type "#   runner run .github/workflows/ci.yml" Enter
Sleep 3s
Type "# Two cells (net8.0, net9.0) run in parallel via per-cell git worktree" Enter
Type "# setup-dotnet shim is a no-op locally — uses your installed dotnet" Enter
Sleep 4s
