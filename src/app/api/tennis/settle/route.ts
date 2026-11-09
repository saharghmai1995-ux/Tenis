import { NextResponse } from "next/server";
import { runSettlement } from "@/lib/tennis/settlement";
import { buildLedgerPayload } from "@/lib/tennis/ledger";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { days?: number };
    const days = Math.min(Math.max(body.days ?? 3, 1), 7);
    const summary = await runSettlement(days);
    const ledger = await buildLedgerPayload();
    return NextResponse.json({ ok: true, summary, ledger });
  } catch (e) {
    console.error("[api/tennis/settle] fatal", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "settlement failure" },
      { status: 500 }
    );
  }
}
