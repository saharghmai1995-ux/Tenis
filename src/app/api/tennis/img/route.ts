import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Same-origin image proxy ────────────────────────────────────────────────
// Required by the procedural poster canvas: drawing cross-origin images would
// taint the canvas and block toBlob/toDataURL. Whitelist-only relay.

const ALLOWED_HOSTS = new Set([
  "a.espncdn.com",
  "a1.espncdn.com",
  "a2.espncdn.com",
  "a3.espncdn.com",
  "a4.espncdn.com",
  "cdn.worldweatheronline.com",
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url param required" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }
  try {
    const upstream = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(12000),
      headers: { "user-agent": "Mozilla/5.0 (NeoTennisQuant/1.0)" },
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") ?? "image/png";
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "proxy failure" },
      { status: 502 }
    );
  }
}
