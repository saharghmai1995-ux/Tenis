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
  | "FTRESULTS" // full-time settled results + win rate
  | "DAILYPROGRAM"; // professional daily broadcast timetable (both channels)

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
  /** recommended stake in units for this tip (staking ladder) */
  stake?: number;
  /** model expected value edge (prob*odds-1), e.g. 0.099 → +9.9% */
  edge?: number;
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
    seedA?: number; // tournament seed (drawn as S{n} chip when present)
    seedB?: number;
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
  /** match intel strip (model / archetype / timing data) */
  intel?: {
    /** tour label e.g. ATP / WTA */
    tour?: string;
    city?: string;
    /** supervisor timing label e.g. T-30M PRE-WARMUP */
    timing?: string;
    /** favorite full name (Latin) */
    favName?: string;
    /** favorite model win probability 0..1 */
    favProb?: number;
    /** dual-wing coverage 0..1 */
    coverage?: number;
    /** archetype English label */
    archLabel?: string;
    /** favorite side A or B (draws star on the plate) */
    favSide?: "A" | "B";
    /** rotating spotlight angle shown on the card, e.g. VALUE SPOTLIGHT */
    angleLabel?: string;
    /** rotating English insight sentence (differs every pass) */
    insightEn?: string;
    // ── enrichment (director fix: fuller English cards + stake per tip) ──
    /** model score prediction, e.g. "PREDICTION: FAV 2-0" */
    prediction?: string;
    /** ranking gap line, e.g. "RANK #3 v #6" */
    rankGap?: string;
    /** total position risk across both tips, e.g. "TOTAL RISK 1.0U" */
    totalStake?: string;
    /** per-tip stake breakdown, e.g. "TIP A 0.5U + TIP B 0.5U" */
    stakeDetail?: string;
  };
  /** extra seed salt — rotates the pixel background between passes */
  seedSalt?: number;
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
  | "public_aggregate"
  | "daily_program";

export type ChannelTarget = "public" | "vip" | "both";

/** one row of the daily broadcast program (status payload) */
export interface ProgramEntry {
  time: string;
  fa: string;
  en: string;
  target: ChannelTarget;
  targetEn: string;
  jobId: string;
  lastStatus?: string;
  lastRun?: string;
  nextRun?: string;
  /** true when today's slot time has passed (Tehran) */
  elapsed?: boolean;
}

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
  /** the professional daily program, joined with live job state */
  program: ProgramEntry[];
  /** Tehran local time HH:MM at status build */
  tehranTime?: string;
  recentPosts: PostLogRow[];
  flashQueue: {
    cursor: number;
    total: number;
    dateKey: string;
    /** posts already sent today (all matches) */
    postsToday?: number;
    /** true when every match is inside the anti-repeat cooldown */
    cooldownActive?: boolean;
    /** anti-repeat window in minutes */
    cooldownMinutes?: number;
  };
  academy: { nextLesson: number; total: number };
  dataFeed: { lastWarmOk: boolean; lastWarmAt?: string; matches: number; approved: number };
  radar: { news: number; live: number; liveNow: number; fitness: number };
}
