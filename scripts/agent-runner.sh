#!/bin/bash
# ─── telegram-agent durable runner (init-adopted foreground chain) ──────────
# Same durability pattern as reboot-studio.sh: this script runs the supervisor
# agent in FOREGROUND; after the spawning shell dies, init adopts the chain
# and the sandbox reaper leaves init-descended processes alone.
# Code changes → kill this runner and launch it again (no --hot watcher:
# durability beats hot-reload for the always-on channel engine).

LOG=/home/z/my-project/mini-services/telegram-agent/agent-run.log
exec >>"$LOG" 2>&1

echo "── [agent-runner] start at $(date -Is) (pid $$) ──"

cd /home/z/my-project/mini-services/telegram-agent || exit 1

# free the port if a stale instance still holds it
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3030/tcp 2>/dev/null
  sleep 1
fi

exec bun index.ts
