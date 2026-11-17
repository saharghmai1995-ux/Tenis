// ─── NeoTennis Markov Quant — Shared Type Definitions ──────────────────────

export type Tour = "ATP" | "WTA";
export type Surface = "HARD" | "CLAY" | "GRASS";
export type SurfaceSource = "MAPPED" | "INFERRED";
export type MatchState = "pre" | "in" | "post";
export type ResultCode = "2-0" | "2-1" | "1-2" | "0-2";
export type ProductionLine =
  | "DUAL"
  | "BANKER"
  | "SINGLE"
  | "REGCOMBO"
  | "CLUSTER"
  | "ACCUMULATOR"
  | "COMBO"
  | "SNIPER"
  | "SHADOW";
export type ArchetypeCode = "ARCH1" | "ARCH2" | "ARCH3";

// ─── v10 · Peak Dual-Hedge Restoration — overlap pattern identity ────────────
/** The 3 positive-overlap golden pairs of the restored peak architecture. */
export type OverlapPatternCode = "P1" | "P2" | "P3";
/** STATION 4 — the positive-overlap gate metrics stamped on every approved package. */
export interface OverlapGateTelemetry {
  /** (1/oddsA) + (1/oddsB) — must stay ≤ 0.865 */
  impliedSum: number;
  /** 1 / impliedSum — the effective combined price of the package */
  effectiveOdds: number;
  /** (effectiveOdds − 1) × 100 — guaranteed net return of every win (≥ +15.5%) */
  netReturnPct: number;
}

// ─── v5.0 · Copula-Markov-MonteCarlo Pipeline & 5-Regime Router ────────────
/** STATION 2 — Gaussian copula dependency telemetry of one match. */
export interface CopulaTelemetry {
  rhoSetCoupling: number; // ∈ [−0.15, +0.22]
  rhoHoldTiebreak: number;
  fatigueSet3: number;
  bpSavedA: number;
  bpSavedB: number;
  comebackBoost: number;
  tiebreakBoost: number;
  winnerShift: number;
}

/** STATION 3 — 10,000 game-by-game Monte-Carlo authoritative distributions. */
export interface McScenario {
  label: string;
  descFa: string;
  descEn: string;
  code: ResultCode;
  favWin: boolean;
  gamesLo: number;
  gamesHi: number;
  prob: number;
}

export interface MonteCarloResult {
  runs: number;
  outcomes: { p20: number; p21: number; p12: number; p02: number };
  totalGamesMean: number;
  totalGamesStd: number;
  gamesDist: number[];
  handicapSpread: {
    minus55: number;
    minus35: number;
    minus15: number;
    plus15: number;
    plus35: number;
    plus55: number;
  };
  entropy: number;
  entropyNormalized: number;
  topScenarios: McScenario[];
  topScenariosMass: number;
  favWinGamesCorr: number;
  favWinUnder215: number;
  favWinOver205: number;
  coverOver215: number;
  favWinShareOver205: number;
  /** P(fav LOSES ∧ over 20.5 games ∧ fav won set 1) — SRV combo uncovered space */
  favLoseOver205Set1: number;
  /** P(favorite wins set 1) */
  favWonSet1Prob: number;
  sigmaMatchWinner: number;
  pFavWinBy55: number;
  pFavWinBy35: number;
  tiebreakMass: number;
}

/** The 5 non-linear bet-type regimes of the v5.0 router. */
export type RegimeCode =
  | "BANKER"
  | "COMBO"
  | "CLUSTER"
  | "DUAL-HEDGE"
  | "ACCUMULATOR";

export interface RegimeDecision {
  code: RegimeCode | "VETOED";
  labelFa: string;
  labelEn: string;
  icon: string;
  /** non-linear Sharpe of the chosen regime position */
  sharpe: number;
  /** 10k Monte-Carlo composite score 0–100 (crown telemetry) */
  mcScore: number;
  why: string; // Persian routing reason
  whyEn: string;
  /** official market row of the regime (primary tip) */
  marketEn?: string;
  marketFa?: string;
  targetWindow?: [number, number];
  /** stake plan of the regime */
  stakePlanFa?: string;
  /** simultaneous-loss probability of the routed position (crown gate) */
  pairLoss?: number;
  /** v5.5 — Monte-Carlo/Copula joint coverage of the routed position (1 − pairLoss) */
  coverage?: number;
  /** granted by the 65% adaptive quota → SILVER crown + half stakes */
  adaptive?: boolean;
  /** BANKER — primary leg price & probability */
  price?: number;
  prob?: number;
  /** settlement leg codes of the regime position */
  legCodes?: { main: string; cover?: string };
  /** v10 — the overlap pattern the DUAL-HEDGE package rides (P1/P2/P3) */
  pattern?: OverlapPatternCode;
  /** v10 — positive-overlap gate telemetry (crown gate of the peak architecture) */
  overlap?: OverlapGateTelemetry;
  /** CLUSTER — the three dutched exact scenarios */
  scenarios?: {
    label: string;
    descFa: string;
    descEn: string;
    code: ResultCode;
    gamesLo: number;
    gamesHi: number;
    prob: number;
    price: number;
    stake: number;
  }[];
  /** COMBO — main + cover legs */
  comboLegs?: {
    mainEn: string;
    mainFa: string;
    mainProb: number;
    mainPrice: number;
    coverEn: string;
    coverFa: string;
    coverProb: number;
    coverPrice: number;
  };
}

export type CrownTier = "GOLD" | "SILVER" | "NONE";

export interface CrownInfo {
  tier: CrownTier;
  /** GOLD CROWN APPROVED / SILVER CROWN ADAPTIVE headline */
  labelFa: string;
  labelEn: string;
  score: number; // 10k Monte-Carlo score (e.g. 94/100)
}

/** 4-station telemetry bar shown on every v5.0 flashcard. */
export interface PipelineTelemetry {
  station1Markov: { ok: boolean; label: string; pA: number; pB: number };
  station2Copula: { ok: boolean; label: string; rho: number };
  station3MonteCarlo: { ok: boolean; label: string; runs: number };
  station4Supervisor: { ok: boolean; label: string; score: number };
}

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
  /** v6.0 — how the rank was resolved: TABLE = official list, SEED = main-draw
   *  seed, TOUR_BASE = INVENTED by the name-hash fallback (player unknown) */
  rankSource?: "TABLE" | "SEED" | "TOUR_BASE";
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
  /** v7.0 — the live feed is Polymarket Gamma + ESPN Core Odds */
  source: "polymarket" | "espn-core";
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
  /** v10 — OVERLAP = the positive-overlap coefficient gate rejected the match */
  code?: "TOP100" | "P02_RISK" | "NONE" | "REGIME" | "MARKET_GAP" | "OVERLAP";
}

export interface TimingInfo {
  label: string;
  code: "T30" | "WAIT" | "INPLAY_BREAK" | "INPLAY" | "DONE";
  optimal: boolean;
}

/** v5.5 — light Station-3 summary for legacy telemetry consumers
 *  (banker-pool ranking + entropy stamp of the persisted row). */
export interface McSummaryLite {
  /** favorite-oriented match-win probability of the 10k copula Monte-Carlo */
  bankerProb: number;
  /** Shannon entropy of the 4 scorelines (nats) */
  entropy: number;
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
  // ─── v5.0 · Copula-Markov-MonteCarlo pipeline & 5-regime router ───────────
  copula?: CopulaTelemetry;        // STATION 2
  mc?: McSummaryLite;              // STATION 3 light summary (legacy telemetry)
  monteCarlo?: MonteCarloResult;   // STATION 3 (authoritative distributions)
  regime?: RegimeDecision;         // STATION 4 routing decision
  crown?: CrownInfo;               // 👑 GOLD / 🥈 SILVER badge
  pipeline?: PipelineTelemetry;    // 4-station telemetry bar
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
  // ─── v5.0 · Pipeline & regime telemetry flashcards ───────────────────────
  regime?: RegimeDecision;
  crown?: CrownInfo;
  pipeline?: PipelineTelemetry;
  copula?: CopulaTelemetry;
  monteCarlo?: MonteCarloResult;
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
  /** v6.0 — ISO settle timestamp of the point (drives daily/weekly/monthly buckets) */
  at?: string;
  /** v6.0 — outcome of the settled match behind this point */
  status?: "WON" | "LOST";
  /** v6.0 — match-level P&L delta applied at this point */
  delta?: number;
}

// ─── v6.0 · Professional Bank-Growth Analytics (daily/weekly/monthly) ───────
/** One aggregated bank-growth bucket (a Tehran day / Iranian week / month). */
export interface BankPeriodBucket {
  /** stable bucket key, e.g. 20261117 (daily) · 2026-W46 · 2026-11 */
  period: string;
  /** human-readable Persian label */
  label: string;
  pnl: number;
  wins: number;
  losses: number;
  matches: number;
  winRate: number;
  bankEnd: number;
  staked: number;
  roi: number;
}

export interface BankHistory {
  daily: BankPeriodBucket[];
  weekly: BankPeriodBucket[];
  monthly: BankPeriodBucket[];
  bestDay?: BankPeriodBucket;
  worstDay?: BankPeriodBucket;
  today: { matches: number; wins: number; losses: number; pnl: number; winRate: number };
  peak: { bank: number; at: string };
  maxDrawdown: { units: number; pct: number; from: string; to: string };
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
    // ─── v5.0 · Live Bankroll Audit Inspector (exact algebraic identity) ────
    /** gross net-profit of all WON match positions (positive) */
    winsGross: number;
    /** gross net-profit of all LOST match positions (negative) */
    lossesGross: number;
    winsCount: number;
    lossesCount: number;
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
  /** v6.0 — professional bank-growth analytics (daily/weekly/monthly) */
  bankHistory?: BankHistory;
  /** v5.0 — Live Bankroll Audit Inspector (🧮 1,647-unit accounting box) */
  bankAudit?: BankAudit;
}

/** v5.0 · the algebraic audit formula parts rendered above the SHA-256 table. */
export interface BankAudit {
  bankStart: number;
  dualWonProfit: number;
  dualLostStake: number;
  comboProfit: number;
  clusterProfit: number;
  bankerProfit: number;
  /** v7.0 — 🎯 DEEP SINGLE line, explicit audit equation term */
  singleProfit: number;
  /** v5.6 — copula-combo+cover line, explicit audit equation term */
  regComboProfit: number;
  sniperProfit: number;
  accumulatorProfit: number;
  otherProfit: number;
  bank: number;
  /** count of settled rows per side */
  wonCount: number;
  lostCount: number;
  /** SHA-256 of the audit string — integrity lock of the accounting box */
  auditHash: string;
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
    banker: LineItem[];
    /** v7.0 Tab 2 — 🎯 DEEP SINGLE (1.72x–2.15x · +6.5% EV edge) */
    single: LineItem[];
    regCombo: LineItem[];
    cluster: LineItem[];
    accumulator: LineItem[];
    /** v7.0 Tab 1 — 🔗 MIX-2 2-leg precision parlay (1.80x–2.25x) */
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
