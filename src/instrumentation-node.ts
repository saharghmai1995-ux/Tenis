// ─── Node-only instrumentation: spawn + WATCHDOG the telegram-agent daemon ──
// The supervisor agent (mini-services/telegram-agent, port 3030) is the
// production core of the NeoBet channel pipeline: 12 scheduled jobs, 16-bit
// poster engine, Persian captions. It must stay warm 24/7, browser-free.
// The Next.js server process is the durable anchor in this sandbox — every
// server boot re-ensures the agent is alive (detached child, survives reloads)
// AND a repeating watchdog revives it if it ever dies mid-run. The dashboard
// browser is NOT required for any of this: the agent warms the engine feed
// server-to-server, renders posters headlessly and posts to Telegram itself.
//
// TOKEN SOURCING: the platform may inject a STALE TELEGRAM_BOT_TOKEN into the
// server process env (process env outranks the agent's .env file in Bun).
// Before spawning we strip every TELEGRAM_* / AGENT_* key from the inherited
// environment so the agent's own .env (single source of truth) always wins.
//
// ENGINE SELF-WARM: the Markov signal core (buildFeed → quota → settlement →
// ledger) previously only ran when a dashboard browser polled /api/tennis/feed.
// A browser-independent keep-warm loop below calls buildFeed() IN-PROCESS on a
// fixed cadence, so the core stays hot even with the agent down and every
// browser closed. Zero browser dependency end-to-end.

import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";

const AGENT_DIR = "/home/z/my-project/mini-services/telegram-agent";
const AGENT_HEALTH = "http://127.0.0.1:3030/health";
const WATCHDOG_INTERVAL_MS = 30_000;
const RESPAWN_COOLDOWN_MS = 60_000;
const ENGINE_WARM_INTERVAL_MS = 3 * 60_000; // feed TTL is 75s — warm well inside it

/** env keys that must come from the agent's .env, never from inherited env */
const STRIP_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_PUBLIC_CHAT_ID",
  "TELEGRAM_VIP_CHAT_ID",
  "TELEGRAM_LIVE",
  "AGENT_PORT",
];

function agentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of STRIP_KEYS) delete env[k];
  return env;
}

let lastSpawnAt = 0;

function spawnAgent(reason: string): void {
  if (Date.now() - lastSpawnAt < RESPAWN_COOLDOWN_MS) return;
  lastSpawnAt = Date.now();
  try {
    const logFd = openSync(`${AGENT_DIR}/agent.log`, "a");
    // RACE FIX (sandbox re-provision): after a cold boot the agent's
    // node_modules may still be installing when the watchdog fires. Chain
    // `bun install` ahead of `bun run start` so a fresh spawn self-heals
    // instead of dying with "Cannot find module '@napi-rs/canvas'".
    const child = spawn(
      "bash",
      ["-c", `cd "${AGENT_DIR}" && bun install --silent >/dev/null 2>&1; exec bun run start`],
      {
        cwd: AGENT_DIR,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: agentEnv(),
      }
    );
    child.unref();
    console.log(`[watchdog] spawned telegram-agent pid=${child.pid} (${reason})`);
  } catch (e) {
    console.error("[watchdog] agent spawn failed:", e);
  }
}

async function healthOk(timeoutMs = 2500): Promise<boolean> {
  return fetch(AGENT_HEALTH, { signal: AbortSignal.timeout(timeoutMs) })
    .then((r) => r.ok)
    .catch(() => false);
}

// ─── in-process engine keep-warm (browser-independent core) ────────────────

let engineWarmBusy = false;

async function warmEngineCore(): Promise<void> {
  if (engineWarmBusy) return;
  engineWarmBusy = true;
  try {
    const { buildFeed } = await import("@/lib/tennis/engine");
    // force=false → cached feed inside TTL returns instantly (cheap heartbeat)
    await buildFeed(false);
    console.log("[engine-warm] signal core hot (in-process buildFeed ok)");
  } catch (e) {
    console.error(
      "[engine-warm] core warm failed:",
      e instanceof Error ? e.message : e
    );
  } finally {
    engineWarmBusy = false;
  }
}

function armEngineWarmLoop(): void {
  const g = globalThis as unknown as { __engineWarmLoop?: NodeJS.Timeout };
  if (g.__engineWarmLoop) return;
  g.__engineWarmLoop = setInterval(() => {
    void warmEngineCore();
  }, ENGINE_WARM_INTERVAL_MS);
  g.__engineWarmLoop.unref?.();
  console.log(`[engine-warm] core keep-warm loop armed (${ENGINE_WARM_INTERVAL_MS / 1000}s, in-process, browser-free)`);
}

export async function ensureAgentWarm(): Promise<void> {
  try {
    if (!existsSync(AGENT_DIR)) return;

    if (await healthOk()) {
      console.log("[instrumentation] telegram-agent already warm on :3030");
    } else {
      spawnAgent("boot");
      // give the cold boot a moment, then confirm
      await new Promise((r) => setTimeout(r, 4000));
      if (!(await healthOk())) console.warn("[instrumentation] agent health check failed after boot");
    }

    // ── always-on server-side watchdog (browser-independent) ─────────────
    // Polls /health every 30s and respawns the core if it ever goes cold.
    // This is what keeps the supervisor warm & stable with the dashboard
    // browser closed for days.
    const g = globalThis as unknown as { __agentWatchdog?: NodeJS.Timeout };
    if (!g.__agentWatchdog) {
      g.__agentWatchdog = setInterval(() => {
        void healthOk().then((ok) => {
          if (!ok) spawnAgent("watchdog-respawn");
        });
      }, WATCHDOG_INTERVAL_MS);
      g.__agentWatchdog.unref?.();
      console.log(`[watchdog] agent heartbeat loop armed (${WATCHDOG_INTERVAL_MS / 1000}s)`);
    }

    // ── engine core self-warm (fix: هسته موتور وابسته به مرورگر نباشد) ────
    // First warm runs right away so a fresh boot is never cold, then the
    // fixed cadence keeps it hot regardless of any browser or agent state.
    armEngineWarmLoop();
    void warmEngineCore();
  } catch (e) {
    console.error("[instrumentation] agent boot failed:", e);
  }
}
