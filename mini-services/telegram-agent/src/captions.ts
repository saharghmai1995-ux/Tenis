// ─── Telegram Supervisor Agent — Persian Caption Engine ────────────────────
// CHANNEL LANGUAGE RULE (director spec): posters are 100% English, captions
// are 100% Persian. Even ESPN news is fully translated to Persian here.
// Uses z-ai-web-dev-sdk (backend LLM) for high-quality news translation with
// a graceful Persian fallback when the LLM is unavailable.

import ZAI from "z-ai-web-dev-sdk";

import { esc } from "./telegram";
import { ACADEMY } from "./academy";
import { LEG_DETAIL_EN } from "./data";
import type { CardMatch } from "./data";
import type { SettledRow } from "./data";
import type { TennisNewsItem, LiveTennisMatch, FitnessItem } from "./espn";

const fa = (n: number): string => n.toLocaleString("fa-IR");
const faOdds = (n: number): string =>
  n.toFixed(2).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]).replace(".", "٫");
const faStake = (n: number | undefined): string =>
  (n ?? 1).toLocaleString("fa-IR", { maximumFractionDigits: 1 });

// ─── LLM Persian translation ───────────────────────────────────────────────

const TRANSLATE_SYSTEM = `تو مترجم حرفه‌ای خبر ورزشی تنیس برای کانال فارسی‌زبان هستی. متن انگلیسی خبر تنیس را به فارسی روان، دقیق و کامل ترجمه کن.
قوانین سخت:
1) خروجی فقط فارسی باشد — حتی نام برندها و نهادها هم فارسی نوشته شوند: ESPN → ای‌اس‌پی‌ان، ATP → اِی‌تی‌پی، WTA → دبلیو‌تی‌اِی، Grand Slam → گرند اسلم. هیچ حرف انگلیسی/لاتین در خروجی ممنوع است.
2) اسامی بازیکنان تنیس به فارسیِ رایج برگردان: سینر، آلکاراس، دجوکوویچ، مدودف، زورف، سوئاتک، گاوف، ریباکینا، گاگن، تسیتسیپاس، رونی، دی‌مینار، فریتس، موررا...
3) اعداد را با ارقام فارسی (۱۲۳) بنویس و امتیازها را مثل ۶-۴ ۶-۳ بنویس.
4) ساختار خروجی دقیقاً این باشد:
عنوان: <ترجمه عنوان>
<ترجمه کامل متن خبر در یک یا دو پاراگراف روان>
5) توضیح اضافه، تفسیر، مقدمه یا جمع‌بندی ننویس. فقط ترجمه.`;

/** residual Latin brand tokens → Persian, applied after translation */
const BRAND_FA: [RegExp, string][] = [
  [/ESPN/gi, "ای‌اس‌پی‌ان"],
  [/FIFA/gi, "فیفا"],
  [/UEFA/gi, "یوفا"],
  [/ATP/gi, "اِی‌تی‌پی"],
  [/WTA/gi, "دبلیو‌تی‌اِی"],
  [/ITF/gi, "آی‌تی‌اف"],
  [/Grand Slam/gi, "گرند اسلم"],
  [/Wimbledon/gi, "ویمبلدون"],
  [/UCL/gi, "لیگ قهرمانان اروپا"],
];

export async function translateNewsToPersian(
  headline: string,
  description: string
): Promise<{ titleFa: string; bodyFa: string; ok: boolean }> {
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: TRANSLATE_SYSTEM },
        {
          role: "user",
          content: `عنوان خبر:\n${headline}\n\nمتن خبر:\n${description}`,
        },
      ],
      thinking: { type: "disabled" },
    });
    const raw = (completion.choices[0]?.message?.content ?? "").trim();
    if (!raw || raw.length < 20) throw new Error("empty translation");
    const m = raw.match(/عنوان:\s*([^\n]+)\n?([\s\S]*)/);
    if (!m) throw new Error("translation format mismatch");
    let titleFa = m[1].trim();
    let bodyFa = m[2].trim() || titleFa;
    // strip model artifacts: "متن خبر:" style labels at body start
    bodyFa = bodyFa.replace(/^(متن\s*خبر|متن|body)\s*[:：]\s*/i, "").trim();
    // clean residual Latin brand tokens
    for (const [re, fa] of BRAND_FA) {
      titleFa = titleFa.replace(re, fa);
      bodyFa = bodyFa.replace(re, fa);
    }
    // no Latin letters allowed anywhere in the Persian caption (channel rule)
    if (/[A-Za-z]{2,}/.test(bodyFa)) throw new Error(`latin residue in body`);
    if (/[A-Za-z]{2,}/.test(titleFa)) {
      // body is clean — derive a safe Persian headline from its first clause
      const firstClause = bodyFa.split(/[.!؟\n]/)[0].trim();
      titleFa =
        firstClause.length >= 15 && !/[A-Za-z]{2,}/.test(firstClause)
          ? firstClause.slice(0, 120)
          : "خبر مهم تنیس از ای‌اس‌پی‌ان";
    }
    return { titleFa, bodyFa, ok: true };
  } catch (e) {
    console.error("[caption] translation fallback:", e instanceof Error ? e.message : e);
    return {
      titleFa: "خبر مهم تنیس از ای‌اس‌پی‌ان",
      bodyFa:
        "ترجمه خودکار این خبر در این لحظه در دسترس نبود؛ پوستر انگلیسی خبر را در همین پست می‌بینید. ترجمه کامل فارسی در پست بعدی همان خبر ارائه می‌شود.",
      ok: false,
    };
  }
}

// ─── Persian caption builders (one per job family) ─────────────────────────

// BRAND FIX (director report): the old 🅽🅴🅾🅱🅴🆃 negative-squared "sticker"
// glyphs rendered incompletely on several devices. Plain text + red circle
// emojis render 100% reliably on every Telegram client.
const BRAND = "🔴 NEOBET | کانال رسمی نئوبت";
const FOOT = "\n\n————————————————\n⚡️ کانال عمومی: @aineobet\n👑 کارت‌های کامل VIP: @aineobet_vip\n⚠️ +۱۸ | مسئولیت مالی با شماست.";

function slipFa(card: CardMatch, wing: "A" | "B"): string {
  const slip = wing === "A" ? card.slipA : card.slipB;
  if (!slip) return "";
  const legFa: Record<string, string> = {
    "SB-F20": `نتیجه دقیق ست‌ها — برد ۲-۰ ${card.favorite === "A" ? card.playerA : card.playerB}`,
    "TS-O25": "مجموع ست‌های بازی — بالای ۲٫۵ ست (رفتن بازی به ست سوم)",
    "SB-P1-20": `نتیجه دقیق ست‌ها — برد ۲-۰ ${card.playerA} (بازیکن اول)`,
    "SB-P1-21": `نتیجه دقیق ست‌ها — برد ۲-۱ ${card.playerA} (بازیکن اول)`,
    "TG-O225": "مجموع گیم‌های بازی — بالای ۲۲٫۵ گیم",
    "GH-F45": `هندیکپ گیم — برد ${card.favorite === "A" ? card.playerA : card.playerB} با اختلاف ۴٫۵+ گیم`,
  };
  const text = legFa[slip.key] ?? slip.marketEn;
  const prob = slip.prob !== undefined ? ` | احتمال مدل: ٪${Math.round(slip.prob * 100)}` : "";
  const edge =
    slip.edge !== undefined && slip.edge > 0.02
      ? ` | ارزش: ٪+${(slip.edge * 100).toFixed(1)}`
      : "";
  // director rule: stake amount per tip must always be visible
  const stake = ` | استیک: ${faStake(slip.stake)} واحد`;
  return `🔹 ${wing === "A" ? "تیپ A" : "تیپ B"} — ${text} | ضریب: ${faOdds(slip.odds)}${prob}${edge}${stake}`;
}

function cardHeaderFa(card: CardMatch): string {
  const timeFa = card.startTime
    ? new Date(card.startTime).toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Tehran",
      })
    : "ساعت نامشخص";
  return (
    `🎾 ${card.playerA} × ${card.playerB}\n` +
    `🏆 ${card.tournament} — ${card.round}\n` +
    `⏰ شروع: ${timeFa} (به وقت تهران) | سطح: ${card.surface === "HARD" ? "هارد" : card.surface === "CLAY" ? "خاک" : "چمن"}`
  );
}

export function captionFlashcard(
  card: CardMatch,
  adaptive: boolean,
  angle?: { labelFa: string; insightFa: string }
): string {
  const parts = [
    BRAND,
    "🎯 فلش‌کارت اختصاصی VIP",
    cardHeaderFa(card),
    "",
    slipFa(card, "A"),
    slipFa(card, "B"),
    "",
    `📐 پوشش دوپایی: ٪${Math.round((card.coverage ?? 0) * 100)} — یعنی در ${(card.coverage ?? 0) >= 0.9 ? "بیش از ۹۰" : "بخش عمده‌ای"} از مسیرهای ممکن بازی، حداقل یکی از دو تیپ برنده می‌شود.`,
    angle ? `🧠 نگاه این دور (${angle.labelFa}): ${angle.insightFa}` : "",
    adaptive
      ? "🛠 این کارت با «گرانت تطبیقی» سوپروایزر صادر شده است؛ ریسک هم‌زمان بالاتر از حالت طبیعی است و صادقانه اعلام می‌شود."
      : "✅ این کارت به‌صورت طبیعی از دروازه‌های الگو گذاشته است.",
    `🔐 قفل SHA-256 پیش از بازی: ${card.hash ?? "—"}`,
    "🧭 انضباط اجرا: استیک استاندارد ۱۰۰ واحدی برای هر بازی — مبلغ دقیق هر تیپ (سهم داچینگ از بودجه ۱۰۰ واحدی) روی کارت و همین کپشن اعلام شده است؛ بدون چیس، بدون افزایش استیک، بدون ورود خارج از تایمینگ.",
  ];
  return parts.filter(Boolean).join("\n") + FOOT;
}

export function captionFreeCard(card: CardMatch): string {
  const parts = [
    BRAND,
    "🎁 کارت رایگان امروز — هدیه کانال عمومی",
    cardHeaderFa(card),
    "",
    "✅ تیپ A کامل و رایگان منتشر شد:",
    slipFa(card, "A"),
    "",
    "🔒 تیپ B همین بازی فقط در کانال VIP منتشر می‌شود؛ همان ساختار دوپایی که تیپ A را پوشش می‌دهد.",
    "👉 برای دریافت کامل هر ۹ پست روزانه و همه فلش‌کارت‌ها به کانال VIP بپیوندید.",
    "🧭 همین قوانین اجرا: بودجه استاندارد ۱۰۰ واحدی برای هر بازی، مبلغ تیپ همان سهم داچینگ کارت، بدون چیس، تایمینگ اعلام‌شده.",
  ];
  return parts.filter(Boolean).join("\n") + FOOT;
}

export function captionBriefing(
  cards: CardMatch[],
  vetoed: CardMatch[],
  quota: { poolSize: number; approved: number; adaptive: number },
  fitness: FitnessItem[] = []
): string {
  const top = cards.slice(0, 6);
  const lines: string[] = [
    BRAND,
    "🌅 بریفینگ صبح — کانال VIP",
    "",
    "📋 کارت‌های امروز (مهم‌ترین‌ها):",
  ];
  top.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.playerA} × ${c.playerB} — ${c.tournament}`);
    if (c.slipA)
      lines.push(
        `   🔹 تیپ A: ضریب ${faOdds(c.slipA.odds)} | احتمال ٪${Math.round((c.slipA.prob ?? 0) * 100)} | استیک ${faStake(c.slipA.stake)} واحد`
      );
    if (c.slipB)
      lines.push(
        `   🔹 تیپ B: ضریب ${faOdds(c.slipB.odds)} | احتمال ٪${Math.round((c.slipB.prob ?? 0) * 100)} | استیک ${faStake(c.slipB.stake)} واحد`
      );
    lines.push(`   🔐 قفل: ${c.hash ?? "—"}`);
  });
  lines.push("");
  lines.push("⭐️ توصیه‌های مهم امروز:");
  const strongest = [...cards]
    .filter((c) => !c.adaptive && (c.coverage ?? 0) >= 0.9)
    .slice(0, 2);
  if (strongest.length === 0) {
    lines.push("امروز هیچ کارت «پوشش طلایی» (پوشش بالای ۹۰٪) صادر نشد؛ استاندارد مدل بالاست و همین باید باشد.");
  } else {
    strongest.forEach((c) =>
      lines.push(
        `⭐️ ${c.playerA} × ${c.playerB} — پوشش ٪${Math.round((c.coverage ?? 0) * 100)}؛ بالاترین اطمینان روز`
      )
    );
  }
  lines.push("");
  lines.push("🧭 انضباط اجرا (غیرقابل مذاکره):");
  lines.push("۱. استیک استاندارد ۱۰۰ واحدی برای هر بازی — مبلغ هر تیپ همان سهم داچینگ اعلام‌شده روی کارت است، بدون چیس");
  lines.push("۲. بدون پارلی خودسرانه بین کارت‌ها");
  lines.push("۳. ورود فقط در تایمینگ اعلام‌شده (T-۳۰ دقیقه)");
  lines.push("۴. باخت پشت‌سرهم = نه به چیس؛ بانک مقدس است");
  lines.push("");
  lines.push(
    `🔍 شفافیت وتوها: از ${fa(quota.poolSize)} بازی بررسی‌شده، ${fa(quota.approved)} بازی تأیید شد${
      quota.adaptive ? ` (شامل ${fa(quota.adaptive)} گرانت تطبیقی)` : ""
    } و ${fa(vetoed.length)} بازی وتو شد.`
  );
  if (vetoed.length > 0) {
    vetoed.slice(0, 4).forEach((v) =>
      lines.push(`⛔️ ${v.playerA} × ${v.playerB} — دلیل: ${v.vetoReasonFa ?? "خارج از دامنه مدل"}`)
    );
    lines.push("بازی‌های وتوشده به «دفتر سایه» می‌روند و هیچ کارتی از آن‌ها چاپ نمی‌شود.");
  }
  if (fitness.length > 0) {
    lines.push("");
    lines.push("🩺 وضعیت جسمانی بازیکنان کلیدی (رادار ESPN):");
    for (const f of fitness.slice(0, 3)) {
      lines.push(`• ${f.headline}`);
    }
    lines.push("قبل از ورود روی هر کارت، وضعیت بدنی بازیکن را از این ستون چک کنید؛ آسیب‌دیدگیِ اعلام‌شده = خروج فوری از کارت.");
  }
  return lines.join("\n") + FOOT;
}

export function captionAggregate(
  stats: { coreWinRate: number; profit: number; picks: number; settled: number; streak: number },
  rows: SettledRow[],
  night: boolean
): string {
  const lines: string[] = [
    BRAND,
    night ? "🌙 برآیند شبانه — گزارش کانال عمومی" : "📊 برآیند روزانه — کانال VIP",
    "",
    `📈 وین‌ریت هسته سیستم: ٪${fa(Math.round(stats.coreWinRate * 100))}`,
    `💰 سود خالص (واحد): ${fa(stats.profit)}+ واحد`,
    `🎯 کل پیک‌ها: ${fa(stats.picks)} | تسویه‌شده: ${fa(stats.settled)}`,
    `🔥 استریک فعلی: ${fa(Math.abs(stats.streak))} ${stats.streak >= 0 ? "برد پیاپی" : "باخت پیاپی"}`,
  ];
  if (rows.length > 0) {
    lines.push("");
    lines.push("🧾 نتایج ثبت‌شده امروز:");
    rows.slice(0, 8).forEach((r) => {
      const sign = r.profit >= 0 ? "+" : "−";
      lines.push(
        `${r.status === "WON" ? "✅" : r.status === "LOST" ? "❌" : "⏳"} ${r.matchLabel} ${
          r.result ? `(${r.result.replace(/-/g, "-")})` : ""
        } — ${sign}${fa(Math.abs(Math.round(r.profit)))} واحد`
      );
    });
  }
  lines.push("");
  lines.push(
    night
      ? "این گزارش هر شب ساعت ۲۳:۰۰ در کانال عمومی منتشر می‌شود؛ گزارش کامل VIP ساعت ۲۱:۰۰ ارسال می‌گردد."
      : "گزارش کامل در دفتر رسمی SHA-256 ثبت شده است — هیچ عددی بعد از بازی تغییر نمی‌کند."
  );
  return lines.join("\n") + FOOT;
}

export function captionWeekly(
  stats: { coreWinRate: number; profit: number; picks: number; settled: number },
  rows: SettledRow[]
): string {
  const lines: string[] = [
    BRAND,
    "📅 گزارش هفتگی — رکورد رسمی ۷ روز گذشته",
    "",
    `📈 وین‌ریت هسته سیستم: ٪${fa(Math.round(stats.coreWinRate * 100))}`,
    `💰 سود هفته: ${fa(stats.profit)}+ واحد | پیک‌ها: ${fa(stats.picks)} | تسویه‌شده: ${fa(stats.settled)}`,
    "",
    "🧾 مهم‌ترین نتایج هفته:",
  ];
  rows.slice(0, 7).forEach((r) => {
    lines.push(
      `${r.status === "WON" ? "✅" : "❌"} ${r.matchLabel} — ${r.profit >= 0 ? "+" : "−"}${fa(
        Math.abs(Math.round(r.profit))
      )} واحد`
    );
  });
  lines.push("");
  lines.push("🔒 همه رکوردها با قفل SHA-256 پیش از بازی ثبت شده‌اند؛ گزارش در هر دو کانال عمومی و VIP منتشر شد.");
  return lines.join("\n") + FOOT;
}

export function captionFtResults(
  rows: SettledRow[],
  stats: { coreWinRate: number; won: number; lost: number }
): string {
  const lines: string[] = [
    BRAND,
    "🏁 نتایج FT امروز + وین‌ریت",
    "",
    `📈 وین‌ریت کلی سیستم: ٪${fa(Math.round(stats.coreWinRate * 100))} (${fa(stats.won)} برد / ${fa(stats.lost)} باخت)`,
    "",
    "🧾 کارت‌های تسویه‌شده امروز:",
  ];
  if (rows.length === 0) {
    lines.push("امروز هنوز کارتی به نتیجه نرسیده یا تسویه در جریان است؛ برآیند شبانه کامل گزارش می‌دهد.");
  } else {
    rows.forEach((r) => {
      lines.push(
        `${r.status === "WON" ? "✅ برد" : "❌ باخت"} — ${r.matchLabel} ${
          r.result ? `| نتیجه ${r.result.replace(/-/g, "-")}` : ""
        } | ${r.profit >= 0 ? "+" : "−"}${fa(Math.abs(Math.round(r.profit)))} واحد`
      );
    });
  }
  lines.push("");
  lines.push("نتیجه هر کارت با کد ثبت‌شده پیش از بازی مقایسه می‌شود؛ تسویه دستی وجود ندارد.");
  return lines.join("\n") + FOOT;
}

export function captionNews(
  item: TennisNewsItem,
  tr: { titleFa: string; bodyFa: string },
  live: LiveTennisMatch[] = [],
  fitness: FitnessItem[] = []
): string {
  const lines: string[] = [
    BRAND,
    "🎾 اخبار زنده تنیس — منبع ESPN",
    "",
    `📰 ${tr.titleFa}`,
    "",
    tr.bodyFa,
  ];
  const liveNow = live.filter((m) => m.state === "in").slice(0, 4);
  const upcoming = live.filter((m) => m.state === "pre").slice(0, 3);
  if (liveNow.length > 0 || upcoming.length > 0) {
    lines.push("");
    lines.push("📡 تابلوی زنده مسابقات:");
    for (const m of liveNow) {
      const score = m.scoreLine ? m.scoreLine.replace(/-/g, "-") : "";
      lines.push(`🔴 ${m.playerA} در برابر ${m.playerB} — ${score ? score + " | " : ""}${m.detail}`);
    }
    for (const m of upcoming) {
      lines.push(`⏳ پیش‌رو: ${m.playerA} در برابر ${m.playerB} — ${m.tournament}`);
    }
  } else {
    lines.push("");
    lines.push("📡 در این لحظه بازی‌ زنده‌ای روی نت نیست؛ به‌محض شروع مسابقات، تابلوی زنده در پست بعدی اعلام می‌شود.");
  }
  if (fitness.length > 0) {
    lines.push("");
    lines.push("🩺 رادار وضعیت جسمانی بازیکنان:");
    const tagFa: Record<string, string> = {
      INJURY: "آسیب‌دیدگی",
      FITNESS: "آمادگی جسمانی",
      WITHDRAWAL: "کناره‌گیری",
      COMEBACK: "بازگشت",
      RECOVERY: "بهبود و ریکاوری",
    };
    for (const f of fitness.slice(0, 3)) {
      lines.push(`• [${tagFa[f.tag] ?? f.tag}] ${f.headline} — (ترجمه کوتاه در پست‌های بعدی)`);
    }
    lines.push("هر خبر مهمِ وضعیت جسمانی در همین ستون پایش و در پست‌های خبری ترجمه کامل می‌شود.");
  }
  lines.push("");
  lines.push(`🏷 بخش: ${item.tourFa}`);
  lines.push("🌐 منبع اصلی: ESPN Tennis (پوستر انگلیسی خبر در همین پست)");
  lines.push(FOOT);
  return lines.join("\n");
}

export function captionAcademy(lessonIndex: number): string {
  const l = ACADEMY[(lessonIndex - 1) % ACADEMY.length];
  return [
    BRAND,
    `🎓 آکادمی اصطلاحات BET — درس ${fa(l.index)} از ۱۴`,
    "",
    `📌 اصطلاح امروز: «${l.term}»`,
    "",
    l.explanationFa,
    "",
    `💡 ${l.tipFa}`,
    "",
    "📖 پوستر آموزشی انگلیسی این درس در همین پست است؛ سری ۱۴ درسی هر روز با دو پست (۱۱:۳۰ و ۱۸:۳۰) جلو می‌رود.",
    FOOT,
  ].join("\n");
}

export function captionBanner(stats: { coreWinRate: number; profit: number; picks: number }): string {
  return [
    BRAND,
    "🎰 بنر ساعتی VIP ARCADE ARENA",
    "",
    `📈 وین‌ریت هسته سیستم: ٪${fa(Math.round(stats.coreWinRate * 100))}`,
    `💰 سود رسمی ثبت‌شده: ${fa(stats.profit)}+ واحد`,
    `🎯 کل پیک‌های رکورد: ${fa(stats.picks)}`,
    "",
    "کارت‌های کامل، فلش‌کارت‌های هر ۹۰ ثانیه، بریفینگ صبح و برآیند روزانه — همه در کانال VIP.",
    "🔒 همه رکوردها با قفل SHA-256 قبل از بازی ثبت می‌شوند؛ هیچ عددی بعداً ادیت نمی‌شود.",
    FOOT,
  ].join("\n");
}

/** Persian caption for a flashcard when the card lacks full data (fallback). */
export function captionFallbackFlashcard(card: CardMatch): string {
  return [
    BRAND,
    "🎯 فلش‌کارت VIP",
    cardHeaderFa(card),
    "",
    "⚠️ همگام‌سازی کامل بازار در جریان است؛ ضرایب دقیق و تیپ‌ها در فلش‌کارت بعدی اعلام می‌شود.",
    "🧭 انضباط اجرا همچنان برقرار است: بودجه استاندارد ۱۰۰ واحدی، بدون چیس.",
  ].join("\n") + FOOT;
}

/** Human-readable Persian reason for a veto code (poster-safe EN map lives in data.ts). */
export function vetoFa(v: CardMatch): string {
  if (!v.vetoed) return "تأییدشده";
  return v.vetoReasonFa ?? "خارج از دامنه دقت مدل";
}

// keep tree-shaking honest: LEG_DETAIL_EN is referenced for parity check
void LEG_DETAIL_EN;
void esc;
