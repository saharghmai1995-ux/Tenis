import { NextResponse } from "next/server";
import { runAudit } from "@/lib/tennis/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const report = await runAudit();
    return NextResponse.json(report, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "audit failed" },
      { status: 500 }
    );
  }
}
