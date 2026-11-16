// ─── Daily Broadcast Program — single source of truth ──────────────────────
// One table drives THREE surfaces so they can never drift apart:
//   1. the DAILYPROGRAM poster (English timetable, sent to both channels)
//   2. the Persian caption of that post (full schedule in Farsi)
//   3. the dashboard "Daily Program" panel (live status per row)
// All times are Asia/Tehran local (Iran = UTC+03:30, no DST since 2022).

import type { JobId, ChannelTarget } from "./types";

export interface ProgramRow {
  /** Tehran local time "HH:MM" — "" for all-day rows */
  time: string;
  /** minutes-of-day for sorting / progress computation */
  min: number;
  /** English program name (poster — Latin sanitizer safe) */
  en: string;
  /** Persian program name (caption + dashboard) */
  fa: string;
  target: ChannelTarget;
  jobId: JobId;
}

function t(h: number, m: number): { time: string; min: number } {
  return { time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, min: h * 60 + m };
}

/** The professional daily broadcast program (13 program lines). */
export const PROGRAM: ProgramRow[] = [
  { ...t(8, 30), en: "DAILY BROADCAST PROGRAM", fa: "برنامه پخش روزانه (این پست)", target: "both", jobId: "daily_program" },
  { ...t(9, 30), en: "TENNIS LIVE NEWS + FITNESS", fa: "اخبار زنده تنیس + وضعیت جسمانی", target: "public", jobId: "tennis_news_am" },
  { ...t(10, 0), en: "VIP MORNING BRIEFING", fa: "بریفینگ صبح کانال VIP", target: "vip", jobId: "vip_briefing" },
  { ...t(10, 30), en: "FREE CARD OF THE DAY", fa: "کارت رایگان روز", target: "public", jobId: "free_card" },
  { ...t(11, 30), en: "BET ACADEMY LESSON", fa: "آکادمی اصطلاحات BET", target: "public", jobId: "academy_am" },
  { time: ":15", min: 15, en: "MARKETING BANNER - HOURLY", fa: "بنر بازاریابی ساعتی", target: "public", jobId: "marketing_banner" },
  { time: "90s", min: -1, en: "VIP FLASH CARDS - ALL DAY", fa: "فلش‌کارت‌های VIP — تمام روز (هر ۹۰ ثانیه)", target: "vip", jobId: "flashcards" },
  { ...t(16, 30), en: "TENNIS LIVE NEWS + FITNESS", fa: "اخبار زنده تنیس + وضعیت جسمانی", target: "public", jobId: "tennis_news_pm" },
  { ...t(18, 30), en: "BET ACADEMY LESSON", fa: "آکادمی اصطلاحات BET", target: "public", jobId: "academy_pm" },
  { ...t(20, 0), en: "FT RESULTS + WIN RATE", fa: "نتایج FT + وین‌ریت", target: "public", jobId: "ft_results" },
  { ...t(21, 0), en: "VIP DAILY AGGREGATE", fa: "برآیند روزانه VIP", target: "vip", jobId: "vip_aggregate" },
  { time: "22:00", min: 22 * 60, en: "WEEKLY REPORT - FRIDAYS ONLY", fa: "گزارش هفتگی (فقط جمعه‌ها، ۲۲:۰۰)", target: "both", jobId: "weekly_report" },
  { ...t(23, 0), en: "NIGHTLY PUBLIC LEDGER", fa: "برآیند شبانه کانال عمومی", target: "public", jobId: "public_aggregate" },
];

/** Channel label shown on the English poster. */
export function targetEn(target: ChannelTarget): string {
  return target === "public" ? "PUBLIC" : target === "vip" ? "VIP" : "BOTH";
}

/** Channel label shown in Persian surfaces. */
export function targetFa(target: ChannelTarget): string {
  return target === "public" ? "کانال عمومی" : target === "vip" ? "کانال VIP" : "هر دو کانال";
}
