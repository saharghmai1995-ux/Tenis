// ─── Minimal standalone copy of the main engine's wire types ────────────────
// The agent consumes the /api/tennis/feed JSON. Only the fields it uses are
// declared here (structural typing keeps it decoupled from the main app).

export type MatchState = "pre" | "in" | "post";

export interface Slip {
  leg: string;
  text: string;
  textEn: string;
  odds: number;
  prob: number;
  targetWindow?: [number, number];
  marketEn?: string;
  marketFa?: string;
}

export interface ArchetypeInfo {
  code: string;
  labelFa: string;
  labelEn: string;
  coverage: number;
  pairLoss: number;
  adaptive?: boolean;
}

export interface AnalyzedMatch {
  eventKey: string;
  dateKey: string;
  tour: string;
  tournament: string;
  city?: string;
  surface: "HARD" | "CLAY" | "GRASS";
  round: string;
  singles: boolean;
  state: MatchState;
  startTime?: string;
  playerA: {
    name: string;
    shortName: string;
    rank?: number;
    seed?: number;
    flagUrl?: string;
  };
  playerB: {
    name: string;
    shortName: string;
    rank?: number;
    seed?: number;
    flagUrl?: string;
  };
  favorite: "A" | "B";
  favWinProb: number;
  veto: { vetoed: boolean; reason?: string; code?: string };
  dualEligible: boolean;
  archetype?: ArchetypeInfo;
  /** v10 — per-match Markov telemetry (the two players' OWN numbers) */
  markov?: {
    gA: number;
    gB: number;
    bpsA: number;
    bpsB: number;
    pA: number;
    pB: number;
  };
  /** v10 — the routed overlap package (pattern + golden-gate telemetry) */
  regime?: {
    code: string;
    pattern?: string;
    overlap?: { impliedSum: number; effectiveOdds: number; netReturnPct: number };
  };
  slips: { A?: Slip; B?: Slip };
  timing: { label: string; code: string; optimal: boolean };
  hashPre?: string;
}

export interface LedgerLeg {
  leg: string;
  label: string;
  desc: string;
  odds: number;
  stake: number;
  status: "PENDING" | "WON" | "LOST" | "VOID";
  prob?: number;
  profit: number;
}

export interface LedgerMatchRow {
  id: string;
  matchId: string;
  line: string;
  matchLabel: string;
  tournament: string;
  surface: string;
  archetype?: { code: string; labelFa: string; labelEn: string; coverage: number; adaptive?: boolean };
  legs: LedgerLeg[];
  status: "PENDING" | "WON" | "LOST";
  stake: number;
  profit: number;
  result?: string;
  hash?: string;
  settledAt?: string;
  createdAt: string;
}

export interface FeedPayload {
  ok: boolean;
  generatedAt: string;
  matches: AnalyzedMatch[];
  ledger: {
    stats: {
      combinedWinRate: number;
      coreWinRate: number;
      stakeWeightedWinRate: number;
      bank: number;
      bankStart: number;
      profit: number;
      roi: number;
      picks: number;
      settled: number;
      streak: number;
    };
    rows: LedgerMatchRow[];
  };
  settlementSummary: {
    settled: number;
    picked: number;
    windowDays: number;
    quota?: { poolSize: number; approved: number; natural: number; adaptive: number; ratio: number };
  };
}
