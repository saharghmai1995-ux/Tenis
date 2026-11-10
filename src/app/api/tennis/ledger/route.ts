import { NextResponse } from "next/server";
import { buildLedgerPayload } from "@/lib/tennis/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ledger = await buildLedgerPayload();
    return NextResponse.json({ ok: true, ledger });
  } catch (e) {
    console.error("[api/tennis/ledger] fatal", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ledger failure" },
      { status: 500 }
    );
  }
}
