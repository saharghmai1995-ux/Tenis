#!/bin/bash
# ─── studio durable runner (init-adopted foreground chain) ──────────────────
# Same durability pattern as agent-runner.sh: this script runs the Next.js
# studio in FOREGROUND; after the spawning shell dies, init adopts the chain.
# v5.5 — canonical root is /home/z/my-project.
LOG=/tmp/studio-runner.log
exec >>"$LOG" 2>&1

echo "── [studio-runner] start at $(date -Is) (pid $$) ──"
cd /home/z/my-project || exit 1

# free the port if a stale instance still holds it
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3000/tcp 2>/dev/null
  sleep 1
fi

export NEXT_TELEMETRY_DISABLED=1
exec bun run dev
