# Minimal VHS smoke test — should produce smoke.mp4 in ~5 seconds
# Run: `vhs demos/smoke.tape`
# If this hangs, the issue is VHS itself or shell startup, not your tape.

Output demos/smoke.mp4

Set Shell        "bash --noprofile --norc"
Set FontSize     16
Set Width        800
Set Height       400
Set Padding      20
Set Theme        "Catppuccin Mocha"

Type "echo hello from vhs" Enter
Sleep 1s
Type "rehearse --version" Enter
Sleep 1s
Type "date" Enter
Sleep 1s
