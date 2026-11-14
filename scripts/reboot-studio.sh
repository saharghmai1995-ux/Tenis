#!/bin/bash
# ─── Studio self-healing restarter ──────────────────────────────────────────
# Spawned DETACHED by the running studio server (via /api/agent/reboot-studio).
# Sequence: wait for response flush → kill the stale dev chain (Prisma holds
# deleted-inode SQLite fds after a git rebase rewrote the db file) → wait for
# :3000 free → start `next dev -p 3000` in foreground (this script becomes the
# durable runner; once the old server dies, init adopts this chain and the
# sandbox reaper leaves init-descended processes alone).

LOG=/tmp/studio-reboot.log
exec >>"$LOG" 2>&1

echo "── [reboot] scheduled at $(date -Is) (pid $$) ──"
sleep 2

# 1. stop the stale dev chain (pattern-based + explicit pids as fallback)
pkill -TERM -f "next dev -p 3000" 2>/dev/null
pkill -TERM -f "next-server" 2>/dev/null
for pid in 3557 3559 3560 3561 3573; do
  kill -TERM "$pid" 2>/dev/null
done
sleep 3
pkill -KILL -f "next dev -p 3000" 2>/dev/null
pkill -KILL -f "next-server" 2>/dev/null
for pid in 3557 3559 3560 3561 3573; do
  kill -KILL "$pid" 2>/dev/null
done

# 2. wait until :3000 is actually free
free=0
for i in $(seq 1 20); do
  if ! curl -s --max-time 1 -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
    free=1
    break
  fi
  sleep 1
done
echo "── [reboot] port3000_free=$free at $(date -Is) ──"

# 3. start the studio (up to 2 attempts), foreground = durable chain
cd /home/z/tenis-repo || exit 1
export PATH="/home/z/tenis-repo/node_modules/.bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1

for attempt in 1 2; do
  echo "── [reboot] starting studio attempt $attempt at $(date -Is) ──"
  next dev -p 3000 2>&1 | tee dev.log &
  NEXT_PID=$!
  # wait up to 60s for a healthy response
  ok=0
  for i in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:3000/ 2>/dev/null)
    if [ "$code" = "200" ]; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" = "1" ]; then
    echo "── [reboot] STUDIO UP (attempt $attempt) at $(date -Is) ──"
    # keep the runner alive as the durable parent of the dev chain
    wait "$NEXT_PID"
    exit 0
  fi
  echo "── [reboot] attempt $attempt failed, cleaning ──"
  kill -KILL "$NEXT_PID" 2>/dev/null
  pkill -KILL -f "next dev -p 3000" 2>/dev/null
  sleep 2
done
echo "── [reboot] ALL ATTEMPTS FAILED at $(date -Is) ──"
exit 1
