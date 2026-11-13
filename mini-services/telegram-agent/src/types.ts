// ─── Telegram Supervisor Agent — Shared Contracts ──────────────────────────
// Poster engine (16-Bit Arcade), scheduler jobs and HTTP API all share this.

export type PosterKind =
  | "FLASHCARD" // VIP flash card — one match, both slips
  | "FREECARD" // public free card — slip B locked (teaser)
  | "BRIEFING" // VIP morning briefing — today's cards + discipline + vetoes
  | "AGGREGATE" // daily aggregate — results grid + win rate
  | "WEEKLY" // weekly report — 7-day performance
  | "NEWS" // LIVE tennis newswire poster (English) — news + live board + fitness
  | "ACADEMY" // BET terminology academy lesson (English educational poster)
  | "BANNER" // hourly marketing banner
  | "FTRESULTS"; // full-time settled results + win rate

export type ThemeSurface = "HARD" | "CLAY" | "GRASS" | "LIVE" | "ACADEMY" | "MARKETING" | "RESULTS";

/** one live scoreboard row on the NEWS poster */
export interface PosterLiveRow {
  label: string;
  value: string;
  state: "LIVE" | "UPCOMING" | "FINAL";
}

/** one fitness-watch row on the NEWS poster */
export interface PosterFitnessRow {
  label: string;
  tag: string;
}

export interface PosterSlipBox {
  /** market key code, e.g. SB-F20 / TS-O25 (Latin sanitizer enforced) */
  key: string;
  /** wing label, e.g. TYPE A / TYPE B */
  label: string;
  /** official single-button market name in English */
  marketEn: string;
  /** complete English description line(s) */
  detail: string;
  odds: number;
  prob?: number;
  /** locked (free-card teaser) — draws padlock + static noise */
  locked?: boolean;
}

export interface PosterStat {
  label: string;
  value: string;
  /** accent = gold highlight */
  accent?: boolean;
}

export interface PosterRow {
  label: string;
  value: string;
  status?: "WIN" | "LOSS" | "PENDING" | "VETO" | "INFO";
}

export interface PosterRequest {
  kind: PosterKind;
  /** English headline, e.g. "TODAY'S BATTLE ARENA" */
  title: string;
  subtitle?: string;
  /** background theme */
  theme: ThemeSurface;
  /** match players (flashcard / freecard) */
  players?: {
    a: string;
    b: string;
    shortA?: string;
    shortB?: string;
    rankA?: number;
    rankB?: number;
    flagA?: string; // 2-letter ISO code (Latin only)
    flagB?: string;
  };
  tournament?: string;
  round?: string;
  surfaceLabel?: string; // e.g. "HARD COURT · OUTDOOR"
  slips?: PosterSlipBox[];
  stats?: PosterStat[];
  rows?: PosterRow[];
  bullets?: string[];
  /** news block (NEWS kind) — LIVE tennis newswire */
  news?: {
    headline: string;
    description: string;
    source: string;
    published?: string;
    tag?: string;
    /** live scoreboard rows (LIVE first) */
    live?: PosterLiveRow[];
    /** fitness watch rows (injury/fitness radar) */
    fitness?: PosterFitnessRow[];
  };
  /** academy block (ACADEMY kind) */
  lesson?: {
    index: number; // 1..14
    term: string;
    phonetic?: string;
    category: string;
    definition: string;
    example: string;
  };
  /** pre-match SHA-256 lock (first 10 hex) */
  hash?: string;
  /** e.g. "T-30M PRE-WARMUP" */
  timeLabel?: string;
  /** extra footer line (Latin only) */
  footerNote?: string;
  /** arcade stage number printed on HUD */
  stage?: string; // e.g. "ST 01-07"
}

export interface RenderResult {
  ok: boolean;
  kind: PosterKind;
  pngBase64: string;
  width: number;
  height: number;
  /** number of latinization replacements performed (telemetry) */
  latinized: number;
  error?: string;
}

// ─── Scheduler job definitions ─────────────────────────────────────────────

export type JobId =
  | "vip_briefing"
  | "flashcards"
  | "vip_aggregate"
  | "weekly_report"
  | "tennis_news_am"
  | "tennis_news_pm"
  | "academy_am"
  | "academy_pm"
  | "free_card"
  | "marketing_banner"
  | "ft_results"
  | "public_aggregate";

export type ChannelTarget = "public" | "vip" | "both";

export interface JobSpec {
  id: JobId;
  label: string;
  labelFa: string;
  /** cron expression in Asia/Tehran, 6-field (sec min hour dom mon dow) */
  cron?: string;
  /** fixed-rate interval seconds (flashcards) */
  everySeconds?: number;
  target: ChannelTarget;
  enabled: boolean;
}

export interface JobRunState {
  id: JobId;
  lastRun?: string; // ISO
  lastStatus?: "OK" | "DRY-RUN" | "SKIPPED" | "ERROR";
  lastError?: string;
  lastMessageId?: number;
  nextRun?: string; // ISO (cron jobs)
  runs: number;
}

export interface PostLogRow {
  id?: number;
  at: string;
  jobId: JobId;
  target: string;
  posterKind: PosterKind;
  mode: "LIVE" | "DRY-RUN";
  messageId?: number;
  caption: string;
  status: "SENT" | "DRY-RUN" | "SKIPPED" | "ERROR";
  error?: string;
}

export interface AgentStatus {
  ok: true;
  bot: { username: string; live: boolean };
  chats: { public?: string; vip?: string; vipTitle?: string };
  uptimeSeconds: number;
  jobs: (JobSpec & JobRunState)[];
  recentPosts: PostLogRow[];
  flashQueue: { cursor: number; total: number; dateKey: string };
  academy: { nextLesson: number; total: number };
  dataFeed: { lastWarmOk: boolean; lastWarmAt?: string; matches: number; approved: number };
  radar: { news: number; live: number; liveNow: number; fitness: number };
}
