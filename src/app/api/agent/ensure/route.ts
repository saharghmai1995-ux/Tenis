import { NextResponse } from "next/server";
import { ensureAgentWarm } from "@/instrumentation-node";

export const dynamic = "force-dynamic";

/**
 * Ensure the telegram-agent daemon (port 3030) is warm.
 * Spawns it as a child of the Next.js server process (the durable anchor
 * in this sandbox) when it is not already listening.
 */
export async function POST() {
  try {
    await ensureAgentWarm();
    return NextResponse.json({ ok: true, agentHealth: "http://127.0.0.1:3030/health" });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "spawn failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}
