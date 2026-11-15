// ─── Telegram Supervisor Agent — Scheduler & Job Handlers ──────────────────
// Asia/Tehran cron engine (fixed +03:30 since Iran abolished DST in 2022 —
// verified via Intl tz database at runtime). Every job: build 16-Bit poster →
// build FULL Persian caption → render → post (or dry-run log). All core
// logic is browser-independent; the engine feed is warmed server-side.

import { CONFIG, JOB_SPECS } from "./config";
import { store } from "./store";
import { telegram, meCached, refreshMe } from "./telegram";
import { dataHub, LEG_DETAIL_EN, stakeLabelEn } from "./data";
import type { CardMatch } from "./data";
import { fetchTennisRadar, peekRadar, type TennisNewsItem, type LiveTennisMatch, type FitnessItem } from "./espn";
import type { PosterLiveRow, PosterFitnessRow } from "./types";
import { ACADEMY } from "./academy";
import * as cap from "./captions";
import { renderPoster } from "./poster/engine";
import { registerFonts } from "./poster/engine";
import type { JobId, JobRunState, JobSpec, PosterRequest, AgentStatus, PosterKind } from "./types";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const TZ = "Asia/Tehran";
const BOOT_AT = Date.now();

// ─── Tehran helpers (Intl-driven, DST-proof) ───────────────────────────────

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dowFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });

export function tehranFields(ms = Date.now()): {
  y: number; mon: number; dom: number; h: number; min: number; s: number; dow: number;
} {
  const parts = partsFmt.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wd = dowFmt.format(new Date(ms)).toUpperCase();
  return {
    y: get("year"),
    mon: get("month"),
    dom: get("day"),
    h: get("hour") % 24,
    min: get("minute"),
    s: get("second"),
    dow: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }[wd] ?? 0,
  };
}

export function tehranDateKey(ms = Date.now()): string {
  const f = tehranFields(ms);
  return `${f.y}${String(f.mon).padStart(2, "0")}${String(f.dom).padStart(2, "0")}`;
}

// ─── 6-field cron matcher ──────────────────────────────────────────────────

type Field = { wildcard: boolean; any: Set<number>; step?: number };

function parseField(raw: string, min: number, max: number): Field {
  const any = new Set<number>();
  let wildcard = false;
  let step: number | undefined;
  for (const chunk of raw.split(",")) {
    if (chunk === "*") {
      wildcard = true;
      for (let i = min; i <= max; i++) any.add(i);
    } else if (chunk.startsWith("*/")) {
      wildcard = true;
      step = Number(chunk.slice(2));
      for (let i = min; i <= max; i += step) any.add(i);
    } else if (chunk.includes("-")) {
      const [a, b] = chunk.split("-").map(Number);
      for (let i = a; i <= b; i++) any.add(i);
    } else {
      any.add(Number(chunk));
    }
  }
  return { wildcard, any, step };
}

interface Cron {
  sec: Field; min: Field; hour: Field; dom: Field; mon: Field; dow: Field;
}

function parseCron(expr: string): Cron {
  const [sec, min, hour, dom, mon, dow] = expr.trim().split(/\s+/);
  return {
    sec: parseField(sec, 0, 59),
    min: parseField(min, 0, 59),
    hour: parseField(hour, 0, 23),
    dom: parseField(dom, 1, 31),
    mon: parseField(mon, 1, 12),
    dow: parseField(dow, 0, 6),
  };
}

function cronMatches(c: Cron, f: ReturnType<typeof tehranFields>): boolean {
  return (
    c.sec.any.has(f.s) &&
    c.min.any.has(f.min) &&
    c.hour.any.has(f.h) &&
    c.mon.any.has(f.mon) &&
    (c.dom.wildcard || c.dow.wildcard
      ? c.dom.any.has(f.dom) || c.dow.any.has(f.dow)
      : c.dom.any.has(f.dom) && c.dow.any.has(f.dow))
  );
}

/** next run strictly after `after` (ms epoch) for a Tehran-anchored cron */
export function nextCronRun(expr: string, after = Date.now()): number {
  const c = parseCron(expr);
  // iterate the next 2 days at second resolution starting from `after + 1s`
  let t = after + 1000;
  const limit = after + 2 * 86_400_000;
  while (t <= limit) {
    if (cronMatches(c, tehranFields(t))) return t;
    // jump smartly: skip to next minute boundary when seconds won't match soon
    const f = tehranFields(t);
    if (!c.hour.any.has(f.h) || !c.min.any.has(f.min)) {
      t += (59 - f.s) * 1000 + 1000; // finish current minute
      if (!c.hour.any.has(f.h)) t += (59 - f.min) * 60_000; // finish current hour
    } else {
      t += 1000;
    }
  }
  return after + 60_000;
}

// ─── runtime state ─────────────────────────────────────────────────────────

const nextRunAt = new Map<JobId, number>();
let liveOverride: boolean | null = null;

function isLive(): boolean {
  if (liveOverride !== null) return liveOverride;
  return CONFIG.live;
}

/** resolved VIP chat id: env first, then auto-discovered channel */
export function vipChatId(): string {
  return CONFIG.vipChatId || store.kvGet("vipChatId") || "";
}

export function setLive(on: boolean): void {
  liveOverride = on;
  store.kvSet("live", on ? "1" : "0");
}

function restoreLive(): void {
  const v = store.kvGet("live");
  if (v !== null) liveOverride = v === "1";
}

const OUTBOX = path.join(process.cwd(), "outbox");

function saveOutbox(jobId: JobId, png: Buffer): void {
  try {
    mkdirSync(OUTBOX, { recursive: true });
    writeFileSync(path.join(OUTBOX, `last_${jobId}.png`), png);
  } catch {
    /* outbox is best-effort */
  }
}

// ─── posting pipeline ──────────────────────────────────────────────────────

interface PostOutcome {
  status: "SENT" | "DRY-RUN" | "SKIPPED" | "ERROR";
  error?: string;
  messageId?: number;
}

async function deliver(
  jobId: JobId,
  target: string,
  kind: PosterKind,
  caption: string,
  png: Buffer
): Promise<PostOutcome> {
  saveOutbox(jobId, png);
  if (!isLive()) {
    store.logPost({
      at: new Date().toISOString(),
      jobId,
      target,
      posterKind: kind,
      mode: "DRY-RUN",
      caption,
      status: "DRY-RUN",
    });
    console.log(`[job:${jobId}] DRY-RUN ${kind} → ${target} (${Math.round(png.length / 1024)}KB)`);
    return { status: "DRY-RUN" };
  }
  const chatId = target === "vip" ? vipChatId() : CONFIG.publicChatId;
  if (!chatId) {
    store.logPost({
      at: new Date().toISOString(),
      jobId,
      target,
      posterKind: kind,
      mode: "LIVE",
      caption,
      status: "SKIPPED",
      error: "chat id not configured",
    });
    return { status: "SKIPPED", error: "chat id not configured" };
  }
  const res = await telegram.sendPhoto(chatId, png, caption);
  store.logPost({
    at: new Date().toISOString(),
    jobId,
    target,
    posterKind: kind,
    mode: "LIVE",
    messageId: res.messageId,
    caption,
    status: res.ok ? "SENT" : "ERROR",
    error: res.description,
  });
  console.log(
    `[job:${jobId}] ${res.ok ? "SENT" : "ERROR"} ${kind} → ${target}${res.messageId ? ` #${res.messageId}` : ""}${res.description ? ` (${res.description})` : ""}`
  );
  return { status: res.ok ? "SENT" : "ERROR", error: res.description, messageId: res.messageId };
}

async function render(req: PosterRequest): Promise<Buffer> {
  const out = renderPoster(req);
  if (!out.ok) throw new Error(`render failed: ${out.error}`);
  return Buffer.from(out.pngBase64, "base64");
}

function stageLabel(): string {
  const f = tehranFields();
  return `ST ${String(f.mon).padStart(2, "0")}-${String(f.dom).padStart(2, "0")}`;
}

function kickoffLabel(card: CardMatch): string {
  if (!card.startTime) return "START TIME TBC";
  const ms = new Date(card.startTime).getTime();
  if (Number.isNaN(ms)) return "START TIME TBC";
  const f = tehranFields(ms);
  return `START ${String(f.h).padStart(2, "0")}:${String(f.min).padStart(2, "0")} TEHRAN`;
}

const SURFACE_EN: Record<string, string> = {
  HARD: "HARD COURT",
  CLAY: "CLAY COURT",
  GRASS: "GRASS COURT",
};

/** supervisor timing codes → compact English poster labels (Persian labels
    would be mangled by the Latin sanitizer, so we never print them raw). */
const TIMING_EN: Record<string, string> = {
  DONE: "SETTLED",
  WAIT: "WINDOW PENDING",
  OPEN: "ENTRY WINDOW OPEN",
  T30: "T-30M ENTRY WINDOW",
  LIVE: "IN-PLAY WINDOW",
  POST: "SETTLED",
};

function timingEn(code?: string, label?: string): string {
  if (code && TIMING_EN[code.toUpperCase()]) return TIMING_EN[code.toUpperCase()];
  if (label) {
    const m = label.match(/(\d{1,4})/);
    if (m) return `WINDOW PENDING (${m[1]}M)`;
  }
  return "TIMING LOCKED";
}

// ─── flashcard ONE-POST policy (director fix: هر بازی فقط یک‌بار ارسال شود) ─
// Each approved match is posted EXACTLY ONCE per Tehran day. The 90s loop
// exists only so a newly-appearing match gets its single card fast; a match
// that already has its card is NEVER re-posted — no 6-minute repeat loops,
// no angle rotations, no duplicate cards. When every pool match has its
// card the job SKIPS instead of posting anything.

export const FLASH_MAX_PER_DAY = 1; // hard cap: one post per match per Tehran day

export interface FlashAngle {
  label: string;
  labelFa: string;
  insightEn: string;
  insightFa: string;
}

const FULL_CARD_LABEL_FA = "کارت کامل";

export function angleFor(card: CardMatch, _rotation = 0): FlashAngle {
  const cov = Math.round((card.coverage ?? 0) * 100);
  return {
    label: "FULL CARD",
    labelFa: FULL_CARD_LABEL_FA,
    insightEn: `DUAL-WING STRUCTURE ONLINE - TYPE A + TYPE B TOGETHER COVER ${cov}% OF ALL POSSIBLE SCORE ROUTES.`,
    insightFa: `ساختار دوپایی فعال است: ترکیب تیپ A و تیپ B حدود ٪${cov} از همه مسیرهای نتیجه بازی را پوشش می‌دهد.`,
  };
}

interface FlashHistEntry {
  c: number;
  at: number;
}

function loadFlashHist(dateKey: string): Record<string, FlashHistEntry> {
  const raw = store.kvGet("flashHist");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { dateKey: string; entries: Record<string, FlashHistEntry> };
      if (parsed.dateKey === dateKey) return parsed.entries ?? {};
    } catch {
      /* corrupted entry → fresh day */
    }
  }
  return {};
}

function saveFlashHist(dateKey: string, entries: Record<string, FlashHistEntry>): void {
  store.kvSet("flashHist", JSON.stringify({ dateKey, entries }));
}

/** ops endpoint: clear today's one-post history so failed/burned cards re-send */
export function resetFlashHistory(): { cleared: boolean; dateKey: string } {
  const dateKey = tehranDateKey();
  store.kvSet("flashHist", JSON.stringify({ dateKey, entries: {} }));
  store.kvSet("flashCursor", "0");
  console.log(`[scheduler] flash history reset for ${dateKey} — all pool matches re-eligible`);
  return { cleared: true, dateKey };
}

// ─── poster request builders ───────────────────────────────────────────────

function flashcardRequest(
  card: CardMatch,
  kind: PosterKind = "FLASHCARD",
  angle?: FlashAngle,
  salt?: number
): PosterRequest {
  const slips = [
    card.slipA && {
      key: card.slipA.key,
      label: "TYPE A",
      marketEn: card.slipA.marketEn,
      detail: card.slipA.detail,
      odds: card.slipA.odds,
      prob: card.slipA.prob,
      stake: card.slipA.stake,
      edge: card.slipA.edge,
    },
    card.slipB && {
      key: card.slipB.key,
      label: "TYPE B",
      marketEn: kind === "FREECARD" ? "FULL MARKET HIDDEN" : card.slipB.marketEn,
      detail:
        kind === "FREECARD"
          ? "UNLOCK THE SECOND WING INSIDE THE VIP ARENA. FULL DUTCHING PLAN POSTED DAILY."
          : card.slipB.detail,
      odds: kind === "FREECARD" ? 0 : card.slipB.odds,
      prob: card.slipB.prob,
      stake: kind === "FREECARD" ? undefined : card.slipB.stake,
      edge: kind === "FREECARD" ? undefined : card.slipB.edge,
      locked: kind === "FREECARD",
    },
  ].filter(Boolean) as PosterRequest["slips"];
  const favName = (card.favorite === "A" ? card.playerA : card.playerB).toUpperCase();
  // ── enrichment (director fix: fuller English cards) ──────────────────────
  // score prediction derived from the primary (Type A) market key
  const PRED_EN: Record<string, string> = {
    "SB-F20": `PREDICTION: ${favName} 2-0`,
    "SB-P1-20": `PREDICTION: ${card.playerA.toUpperCase()} 2-0`,
    "SB-P1-21": `PREDICTION: ${card.playerA.toUpperCase()} 2-1`,
    "TS-O25": "PREDICTION: DECIDING 3RD SET",
    "TG-O225": "PREDICTION: 23+ TOTAL GAMES",
    "GH-F45": `PREDICTION: ${favName} BY 5+ GAMES`,
  };
  const prediction = PRED_EN[card.slipA?.key ?? ""];
  const rankPart = (r?: number): string => (r !== undefined ? `#${r}` : "N/A");
  const rankGap =
    card.rankA !== undefined || card.rankB !== undefined
      ? `RANK GAP ${rankPart(card.rankA)} v ${rankPart(card.rankB)}`
      : undefined;
  const stakeSum = (card.slipA?.stake ?? 0) + (card.slipB?.stake ?? 0);
  const uOf = (n: number): string => (n === Math.floor(n) ? `${n}U` : `${n.toFixed(1)}U`);
  const totalStake = stakeSum > 0 ? `TOTAL RISK ${uOf(stakeSum)}` : undefined;
  const stakeDetail =
    stakeSum > 0
      ? `TIP A ${uOf(card.slipA?.stake ?? 0)} + TIP B ${uOf(card.slipB?.stake ?? 0)}`
      : undefined;
  return {
    kind,
    title: kind === "FREECARD" ? "FREE CARD" : "MATCH OF THE DAY",
    subtitle: card.tournament,
    theme: card.surface,
    players: {
      a: card.playerA,
      b: card.playerB,
      shortA: card.shortA,
      shortB: card.shortB,
      rankA: card.rankA,
      rankB: card.rankB,
      flagA: card.flagA,
      flagB: card.flagB,
      seedA: card.seedA,
      seedB: card.seedB,
    },
    tournament: card.tournament,
    round: card.round,
    surfaceLabel: `${SURFACE_EN[card.surface] ?? "COURT"} - FAV ${card.favorite} - BEST OF 3`,
    slips,
    intel: {
      tour: card.tour,
      city: card.city,
      timing: timingEn(card.timingCode, card.timingLabel),
      favName,
      favProb: card.favWinProb,
      coverage: card.coverage,
      archLabel: card.archLabelEn,
      favSide: card.favorite,
      angleLabel: angle?.label,
      insightEn: angle?.insightEn,
      prediction,
      rankGap,
      totalStake,
      stakeDetail,
    },
    seedSalt: salt,
    hash: card.hash,
    timeLabel: kickoffLabel(card),
    stage: stageLabel(),
    footerNote: kind === "FREECARD" ? "FULL CARD IN VIP" : "VIP ONLY - NOT FOR RESHARE - 18+",
  };
}

function briefingRequest(
  cards: CardMatch[],
  vetoed: CardMatch[],
  quota: { poolSize: number; approved: number; adaptive: number }
): PosterRequest {
  const hhmm = (card: CardMatch): string => {
    if (!card.startTime) return "--:--";
    const ms = new Date(card.startTime).getTime();
    if (Number.isNaN(ms)) return "--:--";
    const f = tehranFields(ms);
    return `${String(f.h).padStart(2, "0")}:${String(f.min).padStart(2, "0")}`;
  };
  const rows: PosterRequest["rows"] = cards.slice(0, 8).map((c) => ({
    label: `${hhmm(c)} ${(c.shortA ?? c.playerA).slice(0, 16)} x ${(c.shortB ?? c.playerB).slice(0, 16)}`,
    value: `${(c.slipA?.key ?? "TBD").slice(0, 9)} ${(c.slipA?.odds ?? 0).toFixed(2)} ${stakeLabelEn(c.slipA?.stake ?? 1)}`,
    status: "INFO",
  }));
  const vetoRows: PosterRequest["rows"] = vetoed.slice(0, 5).map((v) => ({
    label: `${(v.shortA ?? v.playerA).slice(0, 16)} x ${(v.shortB ?? v.playerB).slice(0, 16)}`,
    value:
      v.vetoCode === "TOP100"
        ? "OUTSIDE TOP-100 DOMAIN"
        : v.vetoCode === "P02_RISK"
          ? "NO ELIGIBLE ARCHETYPE"
          : "MODEL VETO",
    status: "VETO",
  }));
  return {
    kind: "BRIEFING",
    title: "TODAY'S BATTLE ARENA",
    subtitle: `${tehranDateKey()} - ${cards.length} QUALIFIED PICKS`,
    theme: "HARD",
    rows: [...rows, ...vetoRows],
    bullets: [
      "MAX 2 UNITS PER PICK - NEVER CHASE A LOSS",
      "FLAT STAKES ONLY - NO PARLAY TODAY",
      "LINE LOCKED AT T-30M - NO LATE MOVES",
      "SKIP ANY MATCH IF ODDS DROP BELOW 1.60",
    ],
    stats: [
      { label: "APPROVED", value: String(quota.approved), accent: true },
      { label: "VETOED", value: String(vetoed.length) },
      { label: "QUOTA", value: "12 MAX" },
      { label: "BANK RISK", value: "2.0U" },
    ],
    stage: stageLabel(),
    footerNote: "FULL CARD IN VIP - 18+ - FLAT STAKES",
  } as PosterRequest;
}

function aggregateRequest(
  title: string,
  kind: PosterKind,
  stats: { coreWinRate: number; profit: number; picks: number; settled: number; streak: number },
  rows: { matchLabel: string; status: string; profit: number; result?: string }[]
): PosterRequest {
  return {
    kind,
    title,
    subtitle: `${tehranDateKey()} - OFFICIAL LEDGER`,
    theme: "RESULTS",
    stats: [
      { label: "WIN RATE - CORE", value: `${Math.round(stats.coreWinRate * 100)}%`, accent: true },
      { label: "NET UNITS", value: `${stats.profit >= 0 ? "+" : ""}${Math.round(stats.profit)}U` },
      { label: "PICKS", value: String(stats.picks) },
      { label: "SETTLED", value: String(stats.settled) },
      { label: "STREAK", value: `${stats.streak >= 0 ? "W" : "L"}${Math.abs(stats.streak)}` },
    ],
    rows: rows.slice(0, 9).map((r) => ({
      label: r.matchLabel.slice(0, 30),
      value: r.result ? `FT ${r.result} - ${r.profit >= 0 ? "+" : ""}${Math.round(r.profit)}U` : "PENDING",
      status: r.status === "WON" ? ("WIN" as const) : r.status === "LOST" ? ("LOSS" as const) : ("PENDING" as const),
    })),
    stage: stageLabel(),
    footerNote: "SHA-256 LOCKED RECORDS - 18+",
  } as PosterRequest;
}

function newsRequest(
  item: TennisNewsItem,
  live: LiveTennisMatch[],
  fitness: FitnessItem[]
): PosterRequest {
  const liveRows: PosterLiveRow[] = live.slice(0, 4).map((m) => ({
    label: `${m.shortA ?? m.playerA} v ${m.shortB ?? m.playerB} - ${m.tournament}`.slice(0, 42),
    value:
      m.state === "in"
        ? `${m.scoreLine || "LIVE"} - ${m.detail}`.slice(0, 34)
        : m.state === "pre"
          ? `SCHEDULED - ${m.detail}`.slice(0, 34)
          : `${m.scoreLine || "FT"} - ${m.detail}`.slice(0, 34),
    state: m.state === "in" ? ("LIVE" as const) : m.state === "pre" ? ("UPCOMING" as const) : ("FINAL" as const),
  }));
  const fitRows: PosterFitnessRow[] = fitness.slice(0, 3).map((f) => ({
    label: f.headline.toUpperCase(),
    tag: f.tag,
  }));
  return {
    kind: "NEWS",
    title: "TENNIS NEWSWIRE",
    theme: "LIVE",
    news: {
      headline: item.headline.toUpperCase(),
      description: item.description.toUpperCase(),
      source: "ESPN",
      published: item.published
        ? new Date(item.published).toLocaleDateString("en-GB", { timeZone: TZ })
        : undefined,
      tag: item.tour,
      live: liveRows,
      fitness: fitRows,
    },
    stage: stageLabel(),
    footerNote: "MORE AT ESPN.COM/TENNIS",
  } as PosterRequest;
}

function academyRequest(index: number): PosterRequest {
  const l = ACADEMY[(index - 1) % ACADEMY.length];
  return {
    kind: "ACADEMY",
    title: "BET ACADEMY",
    theme: "ACADEMY",
    lesson: {
      index: l.index,
      term: l.term,
      phonetic: l.phonetic,
      category: l.category,
      definition: l.definition,
      example: l.example,
    },
    stage: stageLabel(),
    footerNote: "NEW LESSON DAILY - 14 LESSON SERIES",
  } as PosterRequest;
}

function bannerRequest(stats: {
  coreWinRate: number;
  profit: number;
  picks: number;
}): PosterRequest {
  return {
    kind: "BANNER",
    title: "VIP ARCADE ARENA",
    subtitle: "INSERT COIN - JOIN THE WINNING SIDE",
    theme: "MARKETING",
    stats: [
      { label: "WIN RATE - CORE", value: `${Math.round(stats.coreWinRate * 100)}%`, accent: true },
      { label: "NET UNITS", value: `${stats.profit >= 0 ? "+" : ""}${Math.round(stats.profit)}U` },
      { label: "PICKS ON RECORD", value: String(stats.picks) },
    ],
    stage: stageLabel(),
    footerNote: "JOIN @aineobet - RESPONSIBLE GAMBLING - 18+",
  } as PosterRequest;
}

// ─── job handlers ──────────────────────────────────────────────────────────

type Handler = () => Promise<PostOutcome>;

async function ensureWarm(): Promise<void> {
  const last = store.kvGet("lastFeedWarmMs");
  const stale = !last || Date.now() - Number(last) > 10 * 60_000;
  if (stale) {
    const ok = await dataHub.warm();
    if (ok) store.kvSet("lastFeedWarmMs", String(Date.now()));
  }
}

function vetoedRowsOf(cards: CardMatch[]): CardMatch[] {
  return cards.filter((c) => c.vetoed);
}

const handlers: Record<JobId, Handler> = {
  async vip_briefing() {
    await ensureWarm();
    const approved = dataHub.approvedPool().slice(0, 8);
    const vetoed = vetoedRowsOf(dataHub.cards());
    if (approved.length === 0 && vetoed.length === 0) return { status: "SKIPPED", error: "no cards today" };
    const quota = { ...dataHub.quota(), adaptive: dataHub.cards().filter((c) => c.adaptive).length };
    // fitness radar feeds the morning discipline block too
    const radar = await fetchTennisRadar().catch(() => null);
    const png = await render(briefingRequest(approved, vetoed, quota));
    const caption = cap.captionBriefing(approved, vetoed, quota, radar?.fitness ?? []);
    return deliver("vip_briefing", "vip", "BRIEFING", caption, png);
  },

  async flashcards() {
    await ensureWarm();
    const dateKey = tehranDateKey();
    store.kvSet("flashDateKey", dateKey);
    const pool = dataHub.approvedPool();
    if (pool.length === 0) return { status: "SKIPPED", error: "flash pool empty" };
    const hist = loadFlashHist(dateKey);
    // ONE-POST POLICY: a match is eligible only if it has NEVER been posted
    // today — exactly one card per game, then it never repeats this day.
    const eligible = pool.filter((c) => !hist[c.eventKey]);
    if (eligible.length === 0) {
      return {
        status: "SKIPPED",
        error: `one-post policy - all ${pool.length} match(es) already have their card today`,
      };
    }
    // soonest kick-off first → the most urgent match gets its single card first
    eligible.sort((a, b) => {
      const ta = a.startTime ? new Date(a.startTime).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.startTime ? new Date(b.startTime).getTime() : Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return (b.coverage ?? 0) - (a.coverage ?? 0);
    });
    const card = eligible[0];
    // DELIVERY-FIRST POLICY (revival fix): the one-post mark is written only
    // AFTER a confirmed SENT (or in dry-run mode). A failed Telegram delivery
    // (network / auth / 404) does NOT burn the card — the next 90s tick
    // retries the same match until the card is actually on the channel.
    const angle = angleFor(card, 0);
    const png = await render(flashcardRequest(card, "FLASHCARD", angle, 1));
    const caption = cap.captionFlashcard(card, !!card.adaptive, angle);
    const outcome = await deliver("flashcards", "vip", "FLASHCARD", caption, png);
    if (outcome.status === "SENT" || outcome.status === "DRY-RUN") {
      hist[card.eventKey] = { c: 1, at: Date.now() };
      saveFlashHist(dateKey, hist);
      store.kvSet("flashCursor", String(Object.values(hist).reduce((s, e) => s + e.c, 0)));
    } else {
      console.warn(
        `[job:flashcards] delivery ${outcome.status} for ${card.eventKey} — card NOT marked, retry next tick (${outcome.error ?? "unknown"})`
      );
    }
    return outcome;
  },

  async vip_aggregate() {
    await ensureWarm();
    const stats = dataHub.stats();
    if (!stats) return { status: "SKIPPED", error: "no stats" };
    const rows = dataHub.settledToday();
    const png = await render(
      aggregateRequest("DAILY LEDGER - VIP", "AGGREGATE", stats, rows)
    );
    const caption = cap.captionAggregate(stats, rows, false);
    return deliver("vip_aggregate", "vip", "AGGREGATE", caption, png);
  },

  async weekly_report() {
    await ensureWarm();
    const stats = dataHub.stats();
    if (!stats) return { status: "SKIPPED", error: "no stats" };
    const rows = dataHub.settledRows(7);
    const png = await render(aggregateRequest("WEEKLY REPORT - 7 DAY LEDGER", "WEEKLY", stats, rows));
    const caption = cap.captionWeekly(stats, rows);
    const out1 = await deliver("weekly_report", "public", "WEEKLY", caption, png);
    if (vipChatId()) {
      const out2 = await deliver("weekly_report", "vip", "WEEKLY", caption, png);
      return out1.status === "SENT" || out2.status === "SENT" ? out1 : out2;
    }
    return out1;
  },

  async tennis_news_am() {
    return postNews("tennis_news_am");
  },
  async tennis_news_pm() {
    return postNews("tennis_news_pm");
  },

  async academy_am() {
    return postAcademy("academy_am");
  },
  async academy_pm() {
    return postAcademy("academy_pm");
  },

  async free_card() {
    await ensureWarm();
    const pool = dataHub.approvedPool();
    const base = pool.length ? pool : dataHub.dbFallbackCards().filter((c) => c.slipA);
    if (base.length === 0) return { status: "SKIPPED", error: "no free card candidate" };
    // rotate among the top-3 coverage candidates day by day (no daily repeat)
    const cands = [...base].sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0)).slice(0, 3);
    const dateKey = tehranDateKey();
    const card = cands[Number(dateKey.slice(-3)) % cands.length];
    const png = await render(flashcardRequest(card, "FREECARD"));
    const caption = cap.captionFreeCard(card);
    return deliver("free_card", "public", "FREECARD", caption, png);
  },

  async marketing_banner() {
    await ensureWarm();
    const stats = dataHub.stats();
    if (!stats) return { status: "SKIPPED", error: "no stats" };
    const png = await render(bannerRequest(stats));
    const caption = cap.captionBanner(stats);
    return deliver("marketing_banner", "public", "BANNER", caption, png);
  },

  async ft_results() {
    await ensureWarm();
    const stats = dataHub.stats();
    if (!stats) return { status: "SKIPPED", error: "no stats" };
    const rows = dataHub.settledToday();
    const f = dataHub.getFeed();
    const won = f ? f.ledger.rows.filter((r) => r.status === "WON").length : 0;
    const lost = f ? f.ledger.rows.filter((r) => r.status === "LOST").length : 0;
    const png = await render(aggregateRequest("FULL TIME RESULTS", "FTRESULTS", stats, rows));
    const caption = cap.captionFtResults(rows, { coreWinRate: stats.coreWinRate, won, lost });
    return deliver("ft_results", "public", "FTRESULTS", caption, png);
  },

  async public_aggregate() {
    await ensureWarm();
    const stats = dataHub.stats();
    if (!stats) return { status: "SKIPPED", error: "no stats" };
    const rows = dataHub.settledToday();
    const png = await render(
      aggregateRequest("NIGHTLY LEDGER", "AGGREGATE", stats, rows)
    );
    const caption = cap.captionAggregate(stats, rows, true);
    return deliver("public_aggregate", "public", "AGGREGATE", caption, png);
  },
};

async function postNews(jobId: JobId): Promise<PostOutcome> {
  const radar = await fetchTennisRadar();
  const fresh = radar.news.find((i) => !store.hasNews(i.id)) ?? radar.news[0];
  if (!fresh) return { status: "SKIPPED", error: "no tennis news available" };
  if (!store.hasNews(fresh.id)) store.markNews(fresh.id);
  const tr = await cap.translateNewsToPersian(fresh.headline, fresh.description);
  const png = await render(newsRequest(fresh, radar.live, radar.fitness));
  const caption = cap.captionNews(fresh, tr, radar.live, radar.fitness);
  return deliver(jobId, "public", "NEWS", caption, png);
}

async function postAcademy(jobId: JobId): Promise<PostOutcome> {
  const next = Number(store.kvGet("academyNext") ?? "1");
  const index = ((next - 1) % ACADEMY.length) + 1;
  store.kvSet("academyNext", String(index + 1));
  const png = await render(academyRequest(index));
  const caption = cap.captionAcademy(index);
  return deliver(jobId, "public", "ACADEMY", caption, png);
}

// ─── scheduler core ────────────────────────────────────────────────────────

let running = new Set<JobId>();

async function runJob(jobId: JobId, reason: "cron" | "manual" = "cron"): Promise<PostOutcome> {
  if (running.has(jobId)) return { status: "SKIPPED", error: "already running" };
  running.add(jobId);
  try {
    const out = await handlers[jobId]();
    store.recordRun(jobId, out.status, { error: out.error, messageId: out.messageId });
    return out;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[job:${jobId}] ${reason} error:`, error);
    store.recordRun(jobId, "ERROR", { error });
    return { status: "ERROR", error };
  } finally {
    running.delete(jobId);
  }
}

function scheduleAll(): void {
  for (const job of JOB_SPECS) {
    if (job.cron) {
      nextRunAt.set(job.id, nextCronRun(job.cron));
    } else if (job.everySeconds) {
      nextRunAt.set(job.id, Date.now() + (job.everySeconds * 1000));
    }
  }
}

function tick(): void {
  const now = Date.now();
  for (const job of JOB_SPECS) {
    const next = nextRunAt.get(job.id);
    if (next === undefined || now < next) continue;
    if (job.cron) {
      nextRunAt.set(job.id, nextCronRun(job.cron, now));
    } else if (job.everySeconds) {
      nextRunAt.set(job.id, now + job.everySeconds * 1000);
    }
    void runJob(job.id);
  }
}

export function startScheduler(): void {
  registerFonts();
  restoreLive();
  void refreshMe().catch(() => null);
  scheduleAll();
  // warm immediately so the first flashcard is never cold
  void dataHub.warm().then((ok) => {
    if (ok) store.kvSet("lastFeedWarmMs", String(Date.now()));
  });
  setInterval(tick, 1000);
  // engine keep-warm loop — the core must never go cold
  setInterval(() => {
    void ensureWarm();
  }, 5 * 60_000);
  // tennis radar keep-warm (news/live/fitness cache stays hot)
  setInterval(() => {
    void fetchTennisRadar().catch(() => null);
  }, 4 * 60_000);
  // VIP channel auto-discovery — the moment the bot becomes admin of (or
  // receives any update from) the VIP channel, its numeric id is captured.
  setInterval(() => {
    void discoverVipLoop();
  }, 30_000);
  console.log(
    `[scheduler] started - ${JOB_SPECS.length} jobs - live=${isLive()} - tz=${TZ}`
  );
  for (const job of JOB_SPECS) {
    const next = nextRunAt.get(job.id);
    console.log(`[scheduler] ${job.id.padEnd(18)} next=${next ? new Date(next).toISOString() : "-"}`);
  }
  void discoverVipLoop();
}

/** capture the VIP channel id from any chat the bot can see */
async function discoverVipLoop(): Promise<void> {
  try {
    const chats = await telegram.discoverChats();
    for (const ch of chats) {
      const isPublic = !!ch.username && CONFIG.publicChatId.includes(ch.username);
      const isChannelish = ch.type === "channel" || ch.type === "supergroup";
      if (isChannelish && ch.id) {
        store.kvSet(`chatSeen:${ch.id}`, JSON.stringify(ch));
      }
      if (isChannelish && !isPublic && ch.id) {
        const idStr = String(ch.id);
        if (vipChatId() !== idStr) {
          store.kvSet("vipChatId", idStr);
          store.kvSet("vipChatTitle", ch.title ?? "");
          console.log(`[discover] VIP chat captured: ${idStr} (${ch.title ?? ch.type})`);
        }
      }
    }
  } catch {
    /* discovery is best-effort */
  }
}

export async function runManually(jobId: JobId): Promise<PostOutcome> {
  return runJob(jobId, "manual");
}

/** single scheduler pass — exposed for the /tick HTTP endpoint */
export function tickOnce(): void {
  tick();
}

export function status(): AgentStatus {
  const jobs = JOB_SPECS.map((j) => {
    const st = store.getJobState(j.id);
    return {
      ...(j as JobSpec),
      lastRun: st?.lastRun ?? undefined,
      lastStatus: (st?.lastStatus as JobRunState["lastStatus"]) ?? undefined,
      lastError: st?.lastError ?? undefined,
      lastMessageId: st?.lastMessageId ?? undefined,
      nextRun: nextRunAt.has(j.id)
        ? new Date(nextRunAt.get(j.id)!).toISOString()
        : undefined,
      runs: st?.runs ?? 0,
    } as JobSpec & JobRunState;
  });
  const f = dataHub.getFeed();
  const radar = peekRadar();
  const flashDateKey = tehranDateKey();
  const flashEntries = loadFlashHist(flashDateKey);
  const flashPool = dataHub.approvedPool();
  const postsToday = Object.values(flashEntries).reduce((s, e) => s + e.c, 0);
  // one-post policy: "cooldownActive" = every pool match already has its card
  const cooldownActive =
    flashPool.length > 0 && flashPool.every((c) => !!flashEntries[c.eventKey]);
  return {
    ok: true,
    bot: { username: meCached()?.username ?? "Neotenisbot", live: isLive() },
    chats: { public: CONFIG.publicChatId, vip: vipChatId() || undefined, vipTitle: store.kvGet("vipChatTitle") || undefined },
    uptimeSeconds: Math.round((Date.now() - BOOT_AT) / 1000),
    jobs,
    recentPosts: store.recentPosts(20),
    flashQueue: {
      cursor: postsToday,
      total: flashPool.length,
      dateKey: flashDateKey,
      postsToday,
      cooldownActive,
      cooldownMinutes: 0,
    },
    academy: {
      nextLesson: Number(store.kvGet("academyNext") ?? "1"),
      total: ACADEMY.length,
    },
    dataFeed: {
      lastWarmOk: dataHub.lastOk,
      lastWarmAt: dataHub.lastAt,
      matches: f?.matches.length ?? 0,
      approved: dataHub.approvedPool().length,
    },
    radar: {
      news: radar?.news.length ?? 0,
      live: radar?.live.length ?? 0,
      liveNow: radar?.live.filter((m) => m.state === "in").length ?? 0,
      fitness: radar?.fitness.length ?? 0,
    },
  };
}

// tree-shaking honesty imports
void LEG_DETAIL_EN;
void CONFIG.live;
