#!/usr/bin/env bash
# =============================================================================
# Install repo-managed git hooks into the LOCAL .git/hooks directory.
# =============================================================================
# Run once after cloning (and after the hook template changes):
#   ./scripts/setup-hooks.sh
#
# Why copy into .git/hooks instead of `git config core.hooksPath scripts/hooks`?
# Security: pointing core.hooksPath at a TRACKED directory would let any pushed
# commit silently replace the hook and have it run on your machine at the next
# git operation (the pre-push hook runs `claude` with bypassPermissions + Bash).
# Copying makes installation an explicit, opt-in step — a pushed change to the
# template is inert until you re-run this script and review it.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/scripts/hooks"
DST="$(git -C "$ROOT" rev-parse --git-path hooks)"
# git-path may be relative to the repo root.
case "$DST" in /*) : ;; *) DST="$ROOT/$DST" ;; esac

[ -d "$SRC" ] || { echo "no hook templates in $SRC" >&2; exit 1; }
mkdir -p "$DST"

installed=0
for h in "$SRC"/*; do
  [ -f "$h" ] || continue
  name="$(basename "$h")"
  # Strip CR (templates edited on Windows) so the hook runs under /bin/sh.
  sed 's/\r$//' "$h" > "$DST/$name"
  chmod +x "$DST/$name"
  echo "installed $name → $DST/$name"
  installed=$((installed + 1))
done

[ "$installed" -gt 0 ] || { echo "no hooks installed" >&2; exit 1; }
echo "Done — $installed hook(s) active locally. Bypass pre-push once: SKIP_PENTEST=1 git push"
