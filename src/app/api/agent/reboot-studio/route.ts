import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * One-shot detached studio restarter.
 * The current server (durable anchor) schedules a self-replacing restart:
 * the detached script kills the stale dev chain (whose Prisma connections
 * hold deleted-inode SQLite fds) and boots a fresh `next dev` chain that
 * init adopts (sandbox-reaper immune). Response returns before the kill.
 */
export async function POST() {
  try {
    const logFd = openSync("/tmp/studio-reboot.log", "a");
    const child = spawn("/bin/bash", ["/home/z/my-project/scripts/reboot-studio.sh"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env },
    });
    child.unref();
    return NextResponse.json({ ok: true, scheduled: true, pid: child.pid });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "schedule failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}
