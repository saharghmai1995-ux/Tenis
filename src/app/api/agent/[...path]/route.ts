import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Agent relay: /api/agent/* → always-warm telegram-agent (:3030) ─────────
// Works on both direct :3000 access and through the Caddy gateway, keeping
// all browser requests same-origin and relative.

const AGENT_URL = process.env.AGENT_URL ?? "http://127.0.0.1:3030";

type Ctx = { params: Promise<{ path?: string[] }> };

async function relay(request: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const sub = (path ?? []).join("/");
  const incoming = new URL(request.url);
  const target = `${AGENT_URL}/${sub}${incoming.search}`;

  try {
    const init: RequestInit = {
      method: request.method,
      headers: { accept: request.headers.get("accept") ?? "*/*" },
      signal: AbortSignal.timeout(120_000),
    };
    if (request.method === "POST" || request.method === "PUT") {
      init.body = await request.arrayBuffer();
      init.headers = {
        ...init.headers,
        "content-type": request.headers.get("content-type") ?? "application/json",
      };
    }
    const res = await fetch(target, init);
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `agent unreachable: ${e instanceof Error ? e.message : "unknown"}`,
      },
      { status: 502 }
    );
  }
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return relay(request, ctx);
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  return relay(request, ctx);
}
