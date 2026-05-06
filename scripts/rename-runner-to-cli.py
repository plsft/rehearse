"""One-shot bulk rename to fold @rehearse/runner into @rehearse/cli.

Changes applied:
  - @rehearse/runner package name -> @rehearse/cli everywhere it appears
    in install commands, code imports, links, etc.
  - `rehearse <subcommand>` -> `rh <subcommand>` for run/watch/compat/install-hook/--version
  - Various code-block + terminal-prompt variants of the above
Skipped: changelog (historical), CLAUDE.md files (separately edited).
"""
import os
import re
import sys

SKIP = {
    "site/changelog.html",
    "CLAUDE.md",
    "cli/CLAUDE.md",
    "cli/src/CLAUDE.md",
    "examples/composite-action-demo/vitest.config.ts",
}

PKG_PATTERNS = [
    (r"@rehearse/runner@latest @rehearse/cli@latest", "@rehearse/cli@latest"),
    (r"@rehearse/runner @rehearse/cli", "@rehearse/cli"),
    (r"@rehearse/runner@latest", "@rehearse/cli@latest"),
    (r"@rehearse/runner", "@rehearse/cli"),
]

BIN_PATTERNS = [
    (r"\brehearse run\b",          "rh run"),
    (r"\brehearse watch\b",        "rh watch"),
    (r"\brehearse install-hook\b", "rh install-hook"),
    (r"\brehearse compat\b",       "rh compat"),
    (r"\brehearse --version\b",    "rh --version"),
    (r"\brehearse -V\b",           "rh -V"),
    (r"binary: `rehearse`",        "binary: `rh`"),
    (r"binary `rehearse`",         "binary `rh`"),
    (r"called `rehearse`",         "called `rh`"),
    (r"the `rehearse` (CLI|binary)", r"the `rh` \1"),
    (r"`rehearse` CLI",            "`rh` CLI"),
    (r"\$ rehearse",               "$ rh"),
    (r"`rehearse run",             "`rh run"),
    (r"`rehearse watch",           "`rh watch"),
    (r"`rehearse install-hook",    "`rh install-hook"),
    (r"`rehearse compat",          "`rh compat"),
]

ALL = PKG_PATTERNS + BIN_PATTERNS

EXTS = (".html", ".md", ".txt", ".ts", ".mjs", ".yml", ".yaml")

def main():
    changed = 0
    for root, dirs, files in os.walk("."):
        if any(p in root for p in ("node_modules", "dist", ".git", ".runner")):
            continue
        for f in files:
            if not f.endswith(EXTS):
                continue
            rel = os.path.relpath(os.path.join(root, f))
            rel = rel.replace(os.sep, "/")
            if rel in SKIP:
                continue
            try:
                with open(rel, "r", encoding="utf-8") as fh:
                    s = fh.read()
            except (UnicodeDecodeError, IsADirectoryError):
                continue
            new = s
            for pat, repl in ALL:
                new = re.sub(pat, repl, new)
            if new != s:
                with open(rel, "w", encoding="utf-8") as fh:
                    fh.write(new)
                print(rel)
                changed += 1
    print(f"\n{changed} files updated")

if __name__ == "__main__":
    main()
