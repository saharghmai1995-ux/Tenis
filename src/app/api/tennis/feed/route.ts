import { NextResponse } from "next/server";
import { buildFeed } from "@/lib/tennis/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "1";
  try {
    const payload = await buildFeed(force);
    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    console.error("[api/tennis/feed] fatal", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "feed failure",
      },
      { status: 502 }
    );
  }
}
