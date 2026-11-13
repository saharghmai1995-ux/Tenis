// ─── Telegram Supervisor Agent — Bot Client ────────────────────────────────
// Thin MT-free REST client for the Bot API. sendPhoto ALWAYS carries the
// full Persian caption (bilingual channel rule: English poster, Persian text).

import { CONFIG } from "./config";

export interface TgResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface SentMessage {
  message_id: number;
  chat: { id: number; title?: string; username?: string };
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<TgResult<T>> {
  if (!CONFIG.token) return { ok: false, description: "no token configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
    return (await res.json()) as TgResult<T>;
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : "network error" };
  }
}

export interface ChatInfo {
  id: number;
  title?: string;
  username?: string;
  type: string;
}

export const telegram = {
  async getMe(): Promise<TgResult<{ id: number; username: string; first_name: string }>> {
    return call("getMe");
  },

  async getChat(chatId: string): Promise<TgResult<ChatInfo>> {
    return call("getChat", { chat_id: chatId });
  },

  /** Discover chats the bot can see (admin channels, groups). */
  async discoverChats(): Promise<ChatInfo[]> {
    const res = await call<Array<{
      update_id: number;
      channel_post?: { chat: ChatInfo };
      my_chat_member?: { chat: ChatInfo };
      message?: { chat: ChatInfo };
    }>>("getUpdates", { limit: 100, allowed_updates: [
      "message", "channel_post", "my_chat_member",
    ] });
    const chats = new Map<string, ChatInfo>();
    for (const u of res.result ?? []) {
      const chat = u.channel_post?.chat ?? u.my_chat_member?.chat ?? u.message?.chat;
      if (chat) chats.set(`${chat.id}`, chat);
    }
    return [...chats.values()];
  },

  /**
   * Send a poster PNG with a Persian caption.
   * Caption limit: 1024 chars — truncated gracefully with ellipsis.
   */
  async sendPhoto(
    chatId: string,
    png: Buffer,
    caption: string
  ): Promise<{ ok: boolean; messageId?: number; description?: string }> {
    const cap = caption.length > 1024 ? `${caption.slice(0, 1000)}\n…` : caption;
    if (!chatId) return { ok: false, description: "target chat id missing" };
    try {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", cap);
      form.append("parse_mode", "HTML");
      const blob = new Blob([new Uint8Array(png)], { type: "image/png" });
      form.append("photo", blob, "neobet-arcade.png");
      const res = await fetch(`https://api.telegram.org/bot${CONFIG.token}/sendPhoto`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const json = (await res.json()) as TgResult<SentMessage>;
      if (!json.ok) return { ok: false, description: json.description ?? `HTTP ${res.status}` };
      return { ok: true, messageId: json.result?.message_id };
    } catch (e) {
      return { ok: false, description: e instanceof Error ? e.message : "sendPhoto failure" };
    }
  },

  /** Plain text message (Persian only). */
  async sendMessage(
    chatId: string,
    text: string
  ): Promise<{ ok: boolean; messageId?: number; description?: string }> {
    if (!chatId) return { ok: false, description: "target chat id missing" };
    const res = await call<SentMessage>("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (!res.ok) return { ok: false, description: res.description };
    return { ok: true, messageId: res.result?.message_id };
  },
};

/** Escape user-ish text for HTML parse mode. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── cached bot identity (getMe resolved once per boot) ────────────────────

export interface BotIdentity {
  id: number;
  username: string;
  first_name: string;
}

let cachedMe: BotIdentity | null = null;

/** Resolve and cache the bot identity from the Bot API (best-effort). */
export async function refreshMe(): Promise<BotIdentity | null> {
  const res = await telegram.getMe();
  if (res.ok && res.result) {
    cachedMe = {
      id: res.result.id,
      username: res.result.username ?? "unknown",
      first_name: res.result.first_name ?? "Bot",
    };
  }
  return cachedMe;
}

/** Last cached identity, or null before the first successful getMe. */
export function meCached(): BotIdentity | null {
  return cachedMe;
}
