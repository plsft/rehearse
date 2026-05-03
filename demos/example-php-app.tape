# Rehearse examples/php-app — PHP + PHPUnit matrix via shivammathur/setup-php@v2 (JS action)
# Run from C:\Code\rehearse root: `vhs demos/example-php-app.tape`
# Output: demos/example-php-app.mp4 (~75 seconds)
#
# Real output captured today (compat):
#   runner compat → 100.0% of 7 steps would execute
#   Matrix: php-version [8.2, 8.3, 8.4]
#
# To run end-to-end (not in this tape — needs PHP 8.2+ + composer on host):
#   runner run .github/workflows/ci.yml
# The runner clones shivammathur/setup-php@v2 into .runner/actions/<slug>/
# and executes its main.js via the JS-action runtime.

Output demos/example-php-app.mp4

Set Shell        "bash --noprofile --norc"
Set FontSize     15
Set FontFamily   "JetBrains Mono"
Set Width        1280
Set Height       760
Set Padding      24
Set Theme        "Catppuccin Mocha"
Set TypingSpeed  28ms

Hide
Type "cd /c/Code/rehearse/examples/php-app && clear" Enter
Show

# §1 — TS pipeline source
Type "# examples/php-app — matrix [8.2, 8.3, 8.4] via shivammathur/setup-php@v2" Enter
Sleep 1s
Type "cat .rehearse/pipelines/ci.ts" Enter
Sleep 8s

# §2 — compile + show YAML
Type "clear" Enter
Sleep 200ms
Type "rh ci compile" Enter
Sleep 1.5s
Type "cat .github/workflows/ci.yml | head -30" Enter
Sleep 5s

# §3 — compat audit
Type "clear" Enter
Sleep 200ms
Type "# compat detects matrix=yes; setup-php is a remote JS action" Enter
Sleep 1s
Type "runner compat .github/workflows/ci.yml" Enter
Sleep 5s

# §4 — explain run-locally + JS-action runtime
Type "clear" Enter
Sleep 200ms
Type "# To run end-to-end:" Enter
Type "#   php --version           # PHP 8.2+ on PATH" Enter
Type "#   composer --version      # composer on PATH" Enter
Type "#   composer install        # one-time, fetches PHPUnit + PHPStan" Enter
Type "#   runner run .github/workflows/ci.yml" Enter
Sleep 3s
Type "# First run: clones shivammathur/setup-php@v2 to .runner/actions/" Enter
Type "# Then executes its main.js via the JS-action runtime — no host PHP needed" Enter
Type "# (unless the action's own installer fails on your platform)" Enter
Sleep 4s
