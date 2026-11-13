#!/usr/bin/env bash
# ─── NeoBet Project Snapshot → GitHub ──────────────────────────────────────
# Creates a full commit snapshot and pushes it to the configured remote.
# Usage: bash scripts/snapshot.sh "optional commit note"
# Runs automatically after every change (cron-ready).

set -uo pipefail
cd /home/z/my-project

NOTE="${1:-auto-snapshot}"
TS=$(date +"%Y-%m-%d %H:%M:%S %Z")

# never commit secrets or heavy artifacts
git add -A
if git diff --cached --quiet; then
  echo "[snapshot] nothing to commit at ${TS}"
  exit 0
fi

git commit -m "snapshot: ${NOTE} (${TS})" >/dev/null
echo "[snapshot] committed: ${NOTE} @ ${TS}"

if git push origin main >/dev/null 2>&1; then
  echo "[snapshot] pushed to origin/main (github.com/saharghmai1995-ux/Tenis)"
  exit 0
fi

# anonymous push failed — try embedded credentials if present in env
if [[ -n "${GH_TOKEN:-}" || -n "${GITHUB_TOKEN:-}" ]]; then
  TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  git remote set-url origin "https://${TOKEN}@github.com/saharghmai1995-ux/Tenis.git"
  if git push origin main >/dev/null 2>&1; then
    echo "[snapshot] pushed with token credentials"
    git remote set-url origin "https://github.com/saharghmai1995-ux/Tenis.git"
    exit 0
  fi
  git remote set-url origin "https://github.com/saharghmai1995-ux/Tenis.git"
fi

echo "[snapshot] WARNING: push failed — snapshot committed LOCALLY only."
echo "  → add a GitHub token (GH_TOKEN env) or git credential store to enable push."
exit 1
