// ─── Telegram Supervisor Agent — Service Entry (port 3030) ─────────────────
// Always-warm, browser-independent supervisor. Routes:
//   GET  /health                → liveness
//   GET  /status                → AgentStatus (jobs, posts, queue, feed)
//   POST /render                → render any PosterRequest → PNG base64
//   GET  /preview/:kind.png     → sample render of a kind (dashboard preview)
//   POST /tick                  → force a scheduler tick
//   POST /run/:jobId            → run a job now
//   GET  /discover              → list chats the bot can see (find VIP id)
//   POST /live {on: boolean}    → toggle live posting (default DRY-RUN)
//   GET  /outbox/:jobId.png     → last rendered poster of a job (dry-run proof)

import { CONFIG } from "./src/config";
import { telegram, meCached, refreshMe } from "./src/telegram";
import { dataHub } from "./src/data";
import { renderPoster, samplePoster, registerFonts } from "./src/poster/engine";
import {
  startScheduler,
  status,
  runManually,
  setLive,
  tehranFields,
} from "./src/scheduler";
import type { PosterRequest, PosterKind } from "./src/types";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const KINDS: PosterKind[] = [
  "FLASHCARD",
  "FREECARD",
  "BRIEFING",
  "AGGREGATE",
  "WEEKLY",
  "NEWS",
  "ACADEMY",
  "BANNER",
  "FTRESULTS",
];

const OUTBOX = path.join(process.cwd(), "outbox");

const json = (data: unknown, code = 200): Response =>
  new Response(JSON.stringify(data), {
    status: code,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (p === "/health") {
      return json({ ok: true, service: "telegram-agent", live: status().bot.live, ts: Date.now() });
    }

    if (p === "/status") {
      return json(status());
    }

    if (p === "/render" && req.method === "POST") {
      const body = (await req.json()) as PosterRequest;
      const out = renderPoster(body);
      return json(out, out.ok ? 200 : 400);
    }

    const previewMatch = p.match(/^\/preview\/([A-Z]+)\.png$/);
    if (previewMatch && previewMatch[1] in Object.fromEntries(KINDS.map((k) => [k, 1]))) {
      const kind = previewMatch[1] as PosterKind;
      const out = renderPoster(samplePoster(kind));
      if (!out.ok) return json({ ok: false, error: out.error }, 500);
      return new Response(Buffer.from(out.pngBase64, "base64"), {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });
    }

    const outboxMatch = p.match(/^\/outbox\/([a-z_]+)\.png$/);
    if (outboxMatch) {
      const file = path.join(OUTBOX, `last_${outboxMatch[1]}.png`);
      if (!existsSync(file)) return json({ ok: false, error: "no render yet" }, 404);
      return new Response(readFileSync(file), {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });
    }

    if (p === "/tick" && req.method === "POST") {
      const { tickOnce } = await import("./src/scheduler");
      tickOnce();
      return json({ ok: true, tickedAt: new Date().toISOString() });
    }

    const runMatch = p.match(/^\/run\/([a-z_]+)$/);
    if (runMatch && req.method === "POST") {
      const jobId = runMatch[1];
      const st = status();
      const spec = st.jobs.find((j) => j.id === jobId);
      if (!spec) return json({ ok: false, error: `unknown job ${jobId}` }, 404);
      const out = await runManually(jobId as never);
      return json({ ok: out.status !== "ERROR", ...out });
    }

    if (p === "/discover") {
      const me = await telegram.getMe();
      const chats = await telegram.discoverChats();
      const pub = await telegram.getChat(CONFIG.publicChatId);
      return json({
        ok: true,
        bot: me.result ? { id: me.result.id, username: me.result.username } : null,
        publicChat: pub.ok ? pub.result : { error: pub.description },
        chatsSeen: chats,
        hint: "اگر کانال VIP در لیست نیست، بات را ادمین کانال VIP کنید و یک پیام آزمایشی بفرستید، سپس /discover را صدا بزنید. شناسه عددی را در TELEGRAM_VIP_CHAT_ID ذخیره کنید.",
      });
    }

    if (p === "/live" && req.method === "POST") {
      const body = (await req.json()) as { on?: boolean };
      const on = !!body.on;
      setLive(on);
      return json({ ok: true, live: on, note: on ? "LIVE POSTING ENABLED" : "DRY-RUN MODE" });
    }

    if (p === "/now") {
      return json({ tehran: tehranFields(), iso: new Date().toISOString() });
    }

    return json({ ok: false, error: "not found" }, 404);
  } catch (e) {
    console.error("[http]", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "internal error" }, 500);
  }
}

registerFonts();
void refreshMe().catch(() => null);
startScheduler();

const server = Bun.serve({
  port: CONFIG.port,
  fetch: handle,
});

console.log(
  `[agent] telegram-agent listening on :${CONFIG.port} — bot ${meCached()?.username ?? "Neotenisbot"} — live=${status().bot.live}`
);

// keep a reference so bun --hot doesn't GC the server
(globalThis as unknown as { __agentServer: unknown }).__agentServer = server;
