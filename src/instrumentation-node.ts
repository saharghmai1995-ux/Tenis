// ─── Node-only instrumentation: spawn the telegram-agent daemon ─────────────
// The supervisor agent (mini-services/telegram-agent, port 3030) is the
// production core of the NeoBet channel pipeline: 12 scheduled jobs, 16-bit
// poster engine, Persian captions. It must stay warm 24/7, browser-free.
// The Next.js server process is the durable anchor in this sandbox — every
// server boot re-ensures the agent is alive (detached child, survives reloads).

import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";

const AGENT_DIR = "/home/z/my-project/mini-services/telegram-agent";
const AGENT_HEALTH = "http://127.0.0.1:3030/health";

export async function ensureAgentWarm(): Promise<void> {
  try {
    if (!existsSync(AGENT_DIR)) return;

    const alive = await fetch(AGENT_HEALTH, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (alive) {
      console.log("[instrumentation] telegram-agent already warm on :3030");
      return;
    }

    const logFd = openSync(`${AGENT_DIR}/agent.log`, "a");
    const child = spawn("bun", ["run", "start"], {
      cwd: AGENT_DIR,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env },
    });
    child.unref();
    console.log(`[instrumentation] spawned telegram-agent pid=${child.pid}`);
  } catch (e) {
    console.error("[instrumentation] agent boot failed:", e);
  }
}
