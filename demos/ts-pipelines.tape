# GitGate TypeScript CI authoring — vim-edit, compile, vim-view-output
# Run from C:\Code\gitgate root: `vhs demos/ts-pipelines.tape`
# Output: demos/ts-pipelines.mp4 (~2 minutes)
#
# Requires: vim on PATH, @gitgate/cli installed globally as `gg`.

Output demos/ts-pipelines.mp4

Set Shell        "bash"
Set FontSize     16
Set FontFamily   "JetBrains Mono"
Set Width        1280
Set Height       760
Set Padding      24
Set Theme        "Catppuccin Mocha"
Set TypingSpeed  30ms

Hide
Type "rm -rf /tmp/demo-ts-pipelines && mkdir -p /tmp/demo-ts-pipelines && cd /tmp/demo-ts-pipelines" Enter
Sleep 400ms
Type "clear" Enter
Show

# §1 — scaffold
Type "# @gitgate/ci ships a TypeScript SDK that compiles to GitHub Actions YAML." Enter
Sleep 1s
Type "# Step 1 — scaffold." Enter
Sleep 800ms
Type "gg ci init" Enter
Sleep 2s
Type "ls -R" Enter
Sleep 2.5s

# §2 — vim the source
Type "# Step 2 — author the pipeline in TypeScript. Type-safe, IDE autocomplete." Enter
Sleep 1s
Type "vim -R .gitgate/pipelines/ci.ts" Enter
Sleep 1.5s
Down Down Down Down Down Down Down Down
Sleep 1s
Type "G"
Sleep 1.2s
Type "gg"
Sleep 1.5s
Escape
Type ":q" Enter
Sleep 600ms

# §3 — install dep
Type "# Step 3 — install @gitgate/ci as a devDependency." Enter
Sleep 800ms
Type "npm init -y > /dev/null && npm install -D @gitgate/ci" Enter
Sleep 6s

# §4 — compile
Type "clear" Enter
Sleep 200ms
Type "# Step 4 — compile to GitHub Actions YAML." Enter
Sleep 800ms
Type "gg ci compile" Enter
Sleep 2s
Type "ls .github/workflows/" Enter
Sleep 1.5s

# §5 — vim the output
Type "# Step 5 — view the generated YAML. Plain GitHub Actions, zero GitGate runtime dep." Enter
Sleep 1s
Type "vim -R .github/workflows/ci.yml" Enter
Sleep 1.5s
Down Down Down Down Down Down Down Down Down Down
Sleep 1.5s
Type "G"
Sleep 1.5s
Type "gg"
Sleep 1.5s
Escape
Type ":q" Enter
Sleep 600ms

# §6 — recap
Type "clear" Enter
Sleep 200ms
Type "# In:  .gitgate/pipelines/ci.ts   (TypeScript, type-safe)" Enter
Type "# Out: .github/workflows/ci.yml   (plain YAML, runs on github.com unchanged)" Enter
Sleep 1s
Type "wc -l .gitgate/pipelines/ci.ts .github/workflows/ci.yml" Enter
Sleep 3s

# §7 — convert direction
Type "# Other direction: existing YAML → TypeScript" Enter
Sleep 1s
Type "gg ci convert .github/workflows/ci.yml" Enter
Sleep 3s
Type "ls .gitgate/pipelines/" Enter
Sleep 2.5s

# §8 — close
Type "clear" Enter
Sleep 200ms
Type "# npm install -g @gitgate/cli" Enter
Type "# gg ci init / compile / convert / validate / watch / estimate" Enter
Type "# github.com/plsft/gitgate · Apache 2.0 · @gitgate/ci v0.3.3" Enter
Sleep 4s

Hide
Type "cd /c/Code/gitgate && rm -rf /tmp/demo-ts-pipelines" Enter
Show
