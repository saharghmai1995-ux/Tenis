import { NextRequest, NextResponse } from "next/server";
import { addManualQuote, realityReport, refreshRealOdds, realityVersion } from "@/lib/tennis/reality";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const rows = await realityReport(40);
    const matches = await db.tennisMatch.findMany({
      where: { vetoed: false, status: { in: ["pre", "in"] } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        eventKey: true,
        playerA: true,
        playerB: true,
        tour: true,
        tournament: true,
        slipAText: true,
        slipAOdds: true,
        slipBText: true,
        slipBOdds: true,
      },
    });
    const health = await refreshRealOdds(
      matches.map((m) => ({ eventKey: m.eventKey, tour: m.tour, playerA: m.playerA, playerB: m.playerB })),
      [],
      { probePolymarket: true, probeEspn: false }
    );
    return NextResponse.json(
      { ok: true, version: realityVersion(), health, rows, matches },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "reality report failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      eventKey?: string;
      market?: string;
      line?: string;
      price?: number;
      matchLabel?: string;
      playerA?: string;
      playerB?: string;
      source?: string;
    };
    if (!body.eventKey || !body.market || !body.price) {
      return NextResponse.json({ ok: false, error: "eventKey, market and price are required" }, { status: 400 });
    }
    await addManualQuote({
      eventKey: body.eventKey,
      market: body.market,
      line: body.line ?? "",
      price: Number(body.price),
      matchLabel: body.matchLabel,
      playerA: body.playerA,
      playerB: body.playerB,
      source: (body.source as "MANUAL" | "BETFORWARD" | "ONEXBET") ?? "MANUAL",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "quote insert failed" },
      { status: 400 }
    );
  }
}
