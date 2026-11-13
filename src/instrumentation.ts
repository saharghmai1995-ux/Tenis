// ─── Next.js instrumentation: boot the always-warm telegram-agent ──────────
// Edge-safe shim: only the nodejs runtime loads the real boot logic.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureAgentWarm } = await import("./instrumentation-node");
    await ensureAgentWarm();
  }
}
