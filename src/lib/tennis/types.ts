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
  favWinOver195: number;  // ARCH2-A: favorite wins AND total games ≥ 20
  fav20Under195: number;  // ARCH2-B tail: favorite 2-0 in ≤ 19 total games
  dogSet1: number;        // ARCH2-B head: underdog wins set 1
  over225: number;        // ARCH3-A: total games ≥ 23
  fav20Under225: number;  // ARCH3-B: favorite 2-0 in ≤ 22 total games
  pairLoss1: number;      // ARCH1 simultaneous-loss = P(underdog 2-0)
  pairLoss2: number;      // ARCH2 simultaneous-loss (exact uncovered mass)
  pairLoss3: number;      // ARCH3 simultaneous-loss (exact uncovered mass)
}

export interface ArchetypeInfo {
  code: ArchetypeCode;
  labelFa: string;
  labelEn: string;
  coverage: number; // 1 − pairLoss
  pairLoss: number;
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
  leg: string; // A | B | A-O195 | B-ALT | A-O225 | B-U225 (archetype legs, v2.0)
  text: string;
  textEn: string;
  odds: number;
  prob: number;
  targetWindow?: [number, number];
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
    bank: number;
    bankStart: number;
    profit: number;
    roi: number;
    picks: number;
    settled: number;
    streak: number;
    bestWin?: LedgerRow;
  };
  groups: LineStats[];
  rows: LedgerRow[];
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
  };
}
