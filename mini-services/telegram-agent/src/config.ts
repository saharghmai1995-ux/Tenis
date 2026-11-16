// ─── Telegram Supervisor Agent — Runtime Configuration ─────────────────────

import type { JobSpec } from "./types";

export interface AgentConfig {
  token: string;
  publicChatId: string;
  vipChatId: string;
  live: boolean;
  port: number;
  dbPath: string;
  tennisDbPath: string;
  mainAppUrl: string;
  tz: string;
}

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/**
 * Director-provided tokens historically arrive as "12345: ABC..." (space
 * after the colon) or wrapped in quotes/ZWNJ. Any stray whitespace makes the
 * Bot API URL invalid → HTTP 404 "Not Found" on EVERY send. Normalize hard.
 */
function normalizeToken(raw: string): string {
  return raw.replace(/[\s"'​‌﻿]+/g, "");
}

export function loadConfig(): AgentConfig {
  return {
    token: normalizeToken(str("TELEGRAM_BOT_TOKEN")),
    publicChatId: str("TELEGRAM_PUBLIC_CHAT_ID", "@aineobet"),
    vipChatId: str("TELEGRAM_VIP_CHAT_ID"),
    live: str("TELEGRAM_LIVE", "false").toLowerCase() === "true",
    port: Number(str("AGENT_PORT", "3030")),
    dbPath: str("AGENT_DB", "./agent.db"),
    tennisDbPath: str("TENNIS_DB", "/home/z/my-project/db/custom.db"),
    mainAppUrl: str("MAIN_APP_URL", "http://127.0.0.1:3000"),
    tz: str("TZ", "Asia/Tehran"),
  };
}

export const CONFIG = loadConfig();

// Tehran-anchored schedule table (Times are Asia/Tehran local):
//   VIP     : briefing 10:00 · flashcards every 90s · aggregate 21:00
//   Weekly  : Friday 22:00 (both channels)
//   Public  : LIVE TENNIS news 09:30 & 16:30 (news + live board + fitness) ·
//             academy 11:30 & 18:30 · free card 10:30 · banner hourly :15 ·
//             FT results 20:00 · nightly aggregate 23:00
// FOOTBALL NEWS: CANCELLED per director — replaced by live tennis + fitness.
export const JOB_SPECS: JobSpec[] = [
  { id: "vip_briefing", label: "VIP Morning Briefing", labelFa: "بریفینگ صبح کانال VIP", cron: "0 0 10 * * *", target: "vip", enabled: true },
  { id: "flashcards", label: "VIP Flash Cards (every 90s)", labelFa: "فلش‌کارت‌های VIP (هر ۹۰ ثانیه)", everySeconds: 90, target: "vip", enabled: true },
  { id: "vip_aggregate", label: "VIP Daily Aggregate", labelFa: "برآیند روزانه VIP", cron: "0 0 21 * * *", target: "vip", enabled: true },
  { id: "weekly_report", label: "Weekly Report (Fri 22:00, both)", labelFa: "گزارش هفتگی (جمعه ۲۲:۰۰، هر دو کانال)", cron: "0 0 22 * * 5", target: "both", enabled: true },
  { id: "tennis_news_am", label: "Tennis Live News (09:30)", labelFa: "اخبار زنده تنیس + وضعیت جسمانی (۰۹:۳۰)", cron: "0 30 9 * * *", target: "public", enabled: true },
  { id: "tennis_news_pm", label: "Tennis Live News (16:30)", labelFa: "اخبار زنده تنیس + وضعیت جسمانی (۱۶:۳۰)", cron: "0 30 16 * * *", target: "public", enabled: true },
  { id: "academy_am", label: "BET Academy Lesson (11:30)", labelFa: "آکادمی اصطلاحات BET (۱۱:۳۰)", cron: "0 30 11 * * *", target: "public", enabled: true },
  { id: "academy_pm", label: "BET Academy Lesson (18:30)", labelFa: "آکادمی اصطلاحات BET (۱۸:۳۰)", cron: "0 30 18 * * *", target: "public", enabled: true },
  { id: "free_card", label: "Free Card of the Day (10:30)", labelFa: "کارت رایگان روزانه (۱۰:۳۰)", cron: "0 30 10 * * *", target: "public", enabled: true },
  { id: "marketing_banner", label: "Hourly Marketing Banner", labelFa: "بنر بازاریابی ساعتی", cron: "0 15 * * * *", target: "public", enabled: true },
  { id: "ft_results", label: "FT Results + Win Rate (20:00)", labelFa: "نتایج FT + وین‌ریت (۲۰:۰۰)", cron: "0 0 20 * * *", target: "public", enabled: true },
  { id: "public_aggregate", label: "Nightly Public Aggregate (23:00)", labelFa: "برآیند شبانه کانال عمومی (۲۳:۰۰)", cron: "0 0 23 * * *", target: "public", enabled: true },
];
