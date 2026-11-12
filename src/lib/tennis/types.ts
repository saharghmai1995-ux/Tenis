// ─── NeoTennis Markov Quant — Shared Type Definitions ──────────────────────

export type Tour = "ATP" | "WTA";
export type Surface = "HARD" | "CLAY" | "GRASS";
export type SurfaceSource = "MAPPED" | "INFERRED";
export type MatchState = "pre" | "in" | "post";
export type ResultCode = "2-0" | "2-1" | "1-2" | "0-2";
export type ProductionLine = "DUAL" | "COMBO" | "SNIPER" | "SHADOW";
export type ArchetypeCode = "ARCH1" | "ARCH2" | "ARCH3";

// ─── v2.0 · Adaptive 3-Archetype Supervisor ────────────────────────────────
/** Exact pair-loss / coverage metrics computed from the Bo3 joint Markov distribution. */
export interface ArchMetrics {
  set1Fav: number;        // P(favorite wins set 1)
  favWinOver195: number;  // legacy v2.0 metric (kept for telemetry)
  fav20Under195: number;  // legacy v2.0 metric (kept for telemetry)
  dogSet1: number;        // legacy v2.0 metric (kept for telemetry)
  over225: number;        // ARCH3-A: total games ≥ 23 (Total Games — Over 22.5)
  fav20Under225: number;  // legacy v2.0 metric (kept for telemetry)
  /** v4.0 — P(favorite wins the match with ≥ 5 games margin) — settles Game Handicap −4.5 */
  fav20Margin5: number;
  pairLoss1: number;      // ARCH1 simultaneous-loss = P(underdog 2-0)
  pairLoss2: number;      // v4.0 ARCH2 simultaneous-loss = P(player 1 loses the match)
  pairLoss3: number;      // v4.0 ARCH3 simultaneous-loss = P(≤22 games AND NOT fav wins by ≥5)
}

export interface ArchetypeInfo {
  code: ArchetypeCode;
  labelFa: string;
  labelEn: string;
  coverage: number; // 1 − pairLoss
  pairLoss: number;
  /** v3.0 — granted by the 65% supervisor quota (least-risk archetype, risk shown honestly) */
  adaptive?: boolean;
}

export interface ArchetypeEval extends ArchetypeInfo {
  eligible: boolean;
  whyNot?: string;
}

export interface SourceStatus {
  ok: boolean;
  latencyMs: number;
  count?: number;
  error?: string;
}

export interface EspnCompetitor {
  name: string;
  shortName: string;
  flagUrl?: string;
  headshotUrl?: string;
  rank?: number; // official world ranking (from /rankings table)
  seed?: number; // curatedRank.current — tournament seed shown in scoreboard
  points?: number;
  linescores: { value: number; tiebreak?: number; winner?: boolean }[];
  winner?: boolean;
  espnAthleteId?: string;
}

export interface EspnMatch {
  eventKey: string;
  dateKey: string;
  tour: Tour;
  tournament: string;
  city?: string;
  venueCourt?: string;
  surface: Surface;
  surfaceSrc: SurfaceSource;
  round: string;
  singles: boolean;
  state: MatchState;
  startTime?: string;
  playerA: EspnCompetitor; // ESPN homeAway=home / order 1
  playerB: EspnCompetitor;
  resultText?: string;
}

export interface WeatherInfo {
  city: string;
  source: "open-meteo" | "wttr-in";
  tempC?: number;
  humidity?: number;
  windKph?: number;
  ok: boolean;
  note?: string;
}

export interface MarketOdds {
  playerA: string;
  playerB: string;
  probA: number; // margin-free market probability for player A
  probB: number;
  oddsA: number;
  oddsB: number;
  source: "polymarket";
  eventTitle: string;
  volume?: number;
}

export interface RankRow {
  rank: number;
  name: string;
  points: number;
  previous: number;
  tour: Tour;
}

export interface NewsItem {
  id: string;
  headline: string;
  description?: string;
  published?: string;
  image?: string;
  link?: string;
  tour: Tour;
}

export interface SetJointCell {
  gamesA: number;
  gamesB: number;
  prob: number;
  tiebreak: boolean;
}

export interface MatchJointCell {
  code: ResultCode;
  games: number[];
  prob: number;
  set1A?: boolean; // v2.0 — whether player A won set 1 along this terminal path
  /** v4.0 — player A total games minus player B total games along this terminal path */
  margin: number;
}

export interface MarkovResult {
  // Layer 1
  gA: number; // hold probability A
  gB: number;
  // Layer 2
  setWinA: number; // S_A
  ou95: number; // set over 9.5 games
  tb1: number; // tiebreak in set 1
  over105Set1: number;
  // Layer 3 (Bo3 doc formulas)
  p20: number;
  p21: number;
  p12: number;
  p02: number;
  // Match-level games distribution
  ou215: number; // match over 21.5 games
  slipBCombined: number; // +1.5 sets underdog AND over 20.5 games (exact from DP)
  /** v4.0 — exact expected Break-Point-Saved % of each server (i.i.d. point model DP) */
  bpsA: number;
  bpsB: number;
  // v2.0 · favorite-oriented archetype metrics (exact, from joint DP)
  arch: ArchMetrics;
}

export interface SolverResult {
  pA: number;
  pB: number;
  error: number;
}

export interface ReverseAnalysis {
  marketProbA?: number;
  marketOddsA?: number;
  marketGap: boolean;
  pServeA: number;
  pServeB: number;
  pEloA: number;
  pEloB: number;
  pFinalA: number;      // calibrated serve prob (v2.0)
  pFinalB: number;      // calibrated serve prob (v2.0)
  pRawA: number;        // pre-calibration fused serve prob
  pRawB: number;
  eloWinA: number;
  method: "shin" | "power";
}

export interface Slip {
  /** v4.0 atomic leg codes: SB-F20 | TS-O25 | SB-P1-20 | SB-P1-21 | TG-O225 | GH-F45 */
  leg: string;
  text: string;
  textEn: string;
  odds: number;
  prob: number;
  targetWindow?: [number, number];
  /** v4.0 — Official single-button market name (English), printed on the flashcard */
  marketEn: string;
  /** v4.0 — Full Persian translation of the bet */
  marketFa: string;
}

export interface VetoInfo {
  vetoed: boolean;
  reason?: string;
  code?: "TOP100" | "P02_RISK" | "NONE";
}

export interface TimingInfo {
  label: string;
  code: "T30" | "WAIT" | "INPLAY_BREAK" | "INPLAY" | "DONE";
  optimal: boolean;
}

export interface AnalyzedMatch extends EspnMatch {
  weather?: WeatherInfo;
  market?: MarketOdds;
  reverse: ReverseAnalysis;
  markov: MarkovResult;
  favorite: "A" | "B";
  favWinProb: number;
  veto: VetoInfo;
  dualEligible: boolean;
  archetype?: ArchetypeInfo;       // selected complementary archetype (v2.0)
  archEvals?: ArchetypeEval[];     // full 3-archetype candidacy report (v2.0)
  slips: { A?: Slip; B?: Slip };
  timing: TimingInfo;
  hashPre?: string;
  dbId?: string;
}

/** v4.0 — one base of a Multi-Match Parlay Slip (Tab 2 mix card). */
export interface MixLeg {
  favName: string;
  dogName: string;
  favShort: string;
  dogShort: string;
  tournament: string;
  round: string;
  tour: Tour;
  surface: Surface;
  startTime?: string;
  marketEn: string; // MATCH WINNER — {fav}
  marketFa: string;
  odds: number;
  eventKey: string;
}

export interface LineItem {
  matchId: string;
  line: ProductionLine;
  leg: string;
  desc: string;
  descEn: string;
  odds: number;
  prob: number;
  stake: number;
  meta?: string;
  tournament: string;
  tour: Tour;
  surface: Surface;
  round: string;
  playerA: string;
  playerB: string;
  rankA?: number;
  rankB?: number;
  favorite: "A" | "B";
  state: MatchState;
  startTime?: string;
  timing: TimingInfo;
  hashPre?: string;
  slipProbA?: number;
  slipProbB?: number;
  archetype?: ArchetypeInfo; // v2.0
  // ─── v4.0 · Rich Telemetry Flashcards ──────────────────────────────────────
  eventKey?: string; // ESPN event key — direct espn.com/tennis verification link
  playerAShort?: string;
  playerBShort?: string;
  flagA?: string;
  flagB?: string;
  seedA?: number;
  seedB?: number;
  holdA?: number; // Service Hold % (model)
  holdB?: number;
  bpsA?: number; // Break Point Saved % (exact i.i.d. DP)
  bpsB?: number;
  /** Official single-button market name (English) — MARKET: … row on the card */
  marketEn?: string;
  /** Full Persian translation of the bet */
  marketFa?: string;
  /** Dutching share of the 100-unit match budget (%) */
  stakePct?: number;
  /** Parlay bases (Tab 2 mix cards) */
  legs?: MixLeg[];
  /** Direct ESPN match-page verification link (v4.0 hash modal) */
  espnUrl?: string;
  /** Official pricing window of the market on bookmaker sites [lo, hi] */
  targetWindow?: [number, number];
}

export interface LedgerRow {
  id: string;
  matchId: string; // v2.0 — pair-level hedge accounting
  line: ProductionLine;
  leg: string;
  desc: string;
  odds: number;
  stake: number;
  status: "PENDING" | "WON" | "LOST" | "VOID";
  profit?: number;
  settledAt?: string;
  matchLabel: string;
  tournament: string;
  surface: Surface;
  result?: string;
  hash?: string; // pre-match SHA-256 lock (v2.0 record table)
  createdAt: string;
}

// ─── v3.0 · Match-Level Dual-Slip Accounting ───────────────────────────────
/** One wing (slip) of a position — v3.0 keeps both wings inside one match row. */
export interface LedgerLeg {
  leg: string; // A | A-O195 | A-O225 | B | B-ALT | B-U225
  label: string; // تیپ A / تیپ B
  desc: string;
  odds: number;
  stake: number;
  status: "PENDING" | "WON" | "LOST" | "VOID";
  prob?: number;
  /** exact wing P&L: (odds − 1) × stake on win, −stake on loss */
  profit: number;
}

/**
 * v3.0 — ONE row per match in the official SHA-256 record table.
 * The two complementary slips are two wings of a single position:
 *   netMatchProfit = winningSlipStake × winningSlipOdds − (stakeA + stakeB)
 * The match is WON when EITHER wing wins.
 */
export interface LedgerMatchRow {
  id: string; // stable: `${line}:${matchId}`
  matchId: string;
  line: ProductionLine; // DUAL | COMBO | SNIPER (SHADOW excluded from official record)
  matchLabel: string;
  tournament: string;
  tour: Tour;
  surface: Surface;
  round?: string;
  archetype?: {
    code: ArchetypeCode;
    labelFa: string;
    labelEn: string;
    coverage: number;
    adaptive?: boolean;
  };
  /** both wings for DUAL — single wing for COMBO / SNIPER */
  legs: LedgerLeg[];
  winnerLeg?: string; // leg code of the winning wing (green tick)
  status: "PENDING" | "WON" | "LOST";
  /** total units staked on the match (stakeA + stakeB = 100 for DUAL) */
  stake: number;
  /** netMatchProfit — match-level consolidated P&L */
  profit: number;
  result?: string; // sets code 2-0 | 2-1 | 1-2 | 0-2
  setsA?: number;
  setsB?: number;
  hash?: string; // pre-match SHA-256 lock
  espnUrl?: string; // ESPN verification link
  settledAt?: string;
  createdAt: string;
}

export interface LineStats {
  line: ProductionLine;
  picks: number;
  won: number;
  lost: number;
  pending: number;
  winRate: number;
  profit: number;
  roi: number;
}

export interface BankPoint {
  index: number;
  bank: number;
  label: string;
}

export interface LedgerPayload {
  stats: {
    combinedWinRate: number;
    /** v4.5 — core system win rate: DUAL + COMBO only (sniper excluded) */
    coreWinRate: number;
    /** v4.5 — stake-weighted win rate over the official record */
    stakeWeightedWinRate: number;
    bank: number;
    bankStart: number;
    profit: number;
    roi: number;
    picks: number;
    settled: number;
    streak: number;
    bestWin?: LedgerMatchRow;
  };
  groups: LineStats[];
  /** v3.0 — one consolidated row per match (DUAL grouped, both wings inside) */
  rows: LedgerMatchRow[];
  /** v3.0 — match-level supervisor quota telemetry */
  quota?: {
    poolSize: number;
    approved: number;
    natural: number;
    adaptive: number;
    ratio: number;
  };
  bankCurve: BankPoint[];
}

export interface FeedPayload {
  ok: boolean;
  generatedAt: string;
  sources: Record<string, SourceStatus>;
  matches: AnalyzedMatch[];
  rankings: { atp: RankRow[]; wta: RankRow[] };
  news: NewsItem[];
  lines: {
    dual: LineItem[];
    combo2: LineItem[];
    combo3: LineItem[];
    sniper: LineItem[];
    shadow: LineItem[];
  };
  ledger: LedgerPayload;
  settlementSummary: {
    settled: number;
    picked: number;
    windowDays: number;
    historyAnalyzed?: number; // new finished matches processed this build (v2.0)
    historyApproved?: number; // finished matches approved by the 3-archetype gate (v2.0)
    quota?: {
      poolSize: number;
      approved: number;
      natural: number;
      adaptive: number;
      ratio: number;
    }; // v3.0 — today's 65% approval telemetry
  };
}
