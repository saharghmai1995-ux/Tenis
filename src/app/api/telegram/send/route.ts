import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── Telegram sendPhoto relay (poster distribution) ────────────────────────
// Env required: TELEGRAM_BOT_TOKEN, TELEGRAM_PUBLIC_CHAT_ID, TELEGRAM_VIP_CHAT_ID
// The poster is sent as a bare photo WITHOUT any text caption (doc rule).

interface SendBody {
  imageBase64: string; // raw base64 of PNG (no data: prefix)
  target: "public" | "vip";
}

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const publicId = process.env.TELEGRAM_PUBLIC_CHAT_ID;
  const vipId = process.env.TELEGRAM_VIP_CHAT_ID;

  if (!token || !publicId || !vipId) {
    return NextResponse.json(
      {
        ok: false,
        code: "TELEGRAM_NOT_CONFIGURED",
        error:
          "توکن ربات تلگرام تنظیم نشده است. متغیرهای محیطی TELEGRAM_BOT_TOKEN، TELEGRAM_PUBLIC_CHAT_ID و TELEGRAM_VIP_CHAT_ID را تنظیم کنید تا ارسال مستقیم فعال شود.",
      },
      { status: 501 }
    );
  }

  let body: SendBody;
  try {
    body = (await request.json()) as SendBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!body.imageBase64 || !body.target) {
    return NextResponse.json(
      { ok: false, error: "imageBase64 and target are required" },
      { status: 400 }
    );
  }
  const chatId = body.target === "vip" ? vipId : publicId;

  try {
    const buffer = Buffer.from(body.imageBase64, "base64");
    const form = new FormData();
    form.append("chat_id", chatId);
    const blob = new Blob([new Uint8Array(buffer)], { type: "image/png" });
    form.append("photo", blob, "neotennis-poster.png");
    // sendPhoto WITHOUT caption — per @aineobet director spec
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      await db.engineLog.create({
        data: {
          kind: "TELEGRAM",
          message: `sendPhoto failed → ${body.target}: ${json.description ?? res.status}`,
        },
      });
      return NextResponse.json(
        { ok: false, error: json.description ?? `telegram HTTP ${res.status}` },
        { status: 502 }
      );
    }
    await db.engineLog.create({
      data: { kind: "TELEGRAM", message: `poster sent → ${body.target} channel` },
    });
    return NextResponse.json({ ok: true, target: body.target });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "telegram failure" },
      { status: 502 }
    );
  }
}
