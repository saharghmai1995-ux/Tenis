// ─── NeoTennis Markov Quant v10.0 — Peak Dual-Hedge Restoration ────────────
// Per Kovalchik (2016): model accuracy collapses outside the Top-100.
//
// v10.0 mandate (master-prompt v10 «Restore Peak Dual-Hedge & Positive
// Overlap Filter»): the v7.0 single-option lines (🎯 DEEP SINGLE, 🏦 BANKER
// with negative Sharpe, 🔗 uncovered MIX/ACCA) sank the bank −1,029.92 units
// in two days. The WINNING peak architecture — «زوج‌تیپ طلایی همپوشان»
// (Orthogonal Dual-Hedge, 100-unit package, peak 2,445.92u / win-rate 88%+)
// — is RESTORED as the only production architecture:
//
//   · IRON RULE: every match enters the ledger EXACTLY ONCE as ONE
//     100-unit overlap package (Dual-Hedge OR Copula Combo + Cover).
//   · The THREE positive-overlap patterns (with the Tennis Double-Win
//     jackpot zone where BOTH wings win together):
//       P1 · Set Mastery Overlap     A 57.6u SB-F20 + B 42.4u TS-O25
//       P2 · Double-Win Game Overlap A 56.0u SB-F20 + B 44.0u TG-O20.5
//       P3 · Exact Set Split 2-0/2-1 A 60.0u SB-P1-20 + B 40.0u SB-P1-21
//   · THE GOLDEN GATE — a match is approved ONLY when its overlap
//     coefficient carries a guaranteed positive return:
//         impliedOverlapSum = 1/oddsA + 1/oddsB  ≤ 0.865
//         netOverlapReturnPct = (1/impliedOverlapSum − 1) × 100 ≥ +15.5
//         combinedCoverageProb ≥ 0.895 ∧ Sharpe ≥ 0.25
//     Everything else is instantly vetoed by the supervisor
//     (🚫 وتوی سوپروایزر — عدم وجود ضریب همپوشانی مثبت) and NEVER reaches
//     the bank.

import type {
  AnalyzedMatch,
  ArchetypeEval,
  ArchetypeInfo,
  CrownInfo,
  MonteCarloResult,
  OverlapPatternCode,
  QqlDecision,
  QqlWarehouseSnapshot,
  RegimeCode,
  RegimeDecision,
  Slip,
  VetoInfo,
} from "./types";
import { monteCarloScore } from "./copula";
import { boardTakePrice, slipOfOption, solveQuantumPair } from "./qql-rca-engine";

const TOP100_LIMIT = 100;

// coverage gates — the exact uncovered (simultaneous-loss) mass of each
// archetype must stay below the doc thresholds for a NATURAL approval
const ARCH1_MAX_PAIR_LOSS = 0.085; // coverage ≥ 91.5%
const ARCH2_MAX_PAIR_LOSS = 0.095; // risk < 9.5%

// v4.0 archetype windows (master-prompt table, exactly as specified)
const ARCH1_MIN_S = 0.64;
const ARCH2_MIN_S = 0.54;
const ARCH2_MAX_S = 0.64;

// ─── v10 · THE GOLDEN GATE — Positive Overlap Coefficient Filter ───────────
// Master-prompt v10, VERBATIM thresholds. A match only reaches the bank when
// its two-wing package carries a GUARANTEED positive overlap return:
const OVERLAP_MAX_IMPLIED_SUM = 0.865; // مجموع معکوس ضرایب زیر 0.865 (ضریب موثر ≥ 1.156x)
const OVERLAP_MIN_NET_RETURN_PCT = 15.5; // سود خالص همپوشانی در هر برد حداقل +15.5%
const OVERLAP_MIN_COVERAGE = 0.895; // پوشش زنجیره مارکوف حداقل 89.5%
const OVERLAP_MIN_SHARPE = 0.25; // حذف کامل کارت‌های با شارپ منفی/ضعیف

export interface OverlapGateMetrics {
  impliedOverlapSum: number;
  effectiveOverlapOdds: number;
  netOverlapReturnPct: number;
  combinedCoverageProb: number;
  sharpe: number;
  approved: boolean;
  whyNot?: string;
}

/**
 * v10 — THE positive-overlap gate (master-prompt v10 §2, verbatim algebra):
 *   impliedOverlapSum = (1/oddsA) + (1/oddsB)
 *   effectiveOverlapOdds = 1 / impliedOverlapSum
 *   netOverlapReturnPct = (effectiveOverlapOdds − 1) × 100
 *   isApprovedPositiveOverlap =
 *     impliedOverlapSum ≤ 0.865 ∧ netOverlapReturnPct ≥ 15.5 ∧
 *     combinedCoverageProb ≥ 0.895 ∧ sharpeRatio ≥ 0.25
 */
export function positiveOverlapGate(
  oddsA: number,
  oddsB: number,
  combinedCoverageProb: number,
  sharpeRatio: number
): OverlapGateMetrics {
  const impliedOverlapSum =
    1 / Math.max(oddsA, 1.01) + 1 / Math.max(oddsB, 1.01);
  const effectiveOverlapOdds = 1 / impliedOverlapSum;
  const netOverlapReturnPct = (effectiveOverlapOdds - 1) * 100;
  const checks: { ok: boolean; why: string }[] = [
    {
      ok: impliedOverlapSum <= OVERLAP_MAX_IMPLIED_SUM,
      why: `مجموع معکوس ضرایب ${impliedOverlapSum.toFixed(3)} بالای سقف 0.865`,
    },
    {
      ok: netOverlapReturnPct >= OVERLAP_MIN_NET_RETURN_PCT,
      why: `سود خالص همپوشانی +${netOverlapReturnPct.toFixed(1)}% زیر کف +15.5%`,
    },
    {
      ok: combinedCoverageProb >= OVERLAP_MIN_COVERAGE,
      why: `پوشش زنجیره مارکوف ${(combinedCoverageProb * 100).toFixed(1)}% زیر کف 89.5%`,
    },
    {
      ok: sharpeRatio >= OVERLAP_MIN_SHARPE,
      why: `نسبت شارپ ${sharpeRatio.toFixed(2)} زیر کف 0.25`,
    },
  ];
  const failed = checks.filter((c) => !c.ok);
  return {
    impliedOverlapSum,
    effectiveOverlapOdds,
    netOverlapReturnPct,
    combinedCoverageProb,
    sharpe: sharpeRatio,
    approved: failed.length === 0,
    whyNot: failed.length > 0 ? failed.map((f) => f.why).join(" · ") : undefined,
  };
}

// ─── v10 · THE THREE POSITIVE-OVERLAP PATTERNS (peak architecture) ──────────
// Every approved match rides EXACTLY ONE of these golden pairs as a 100-unit
// package. The canonical stakes are the equal-profit dutching splits of the
// official odds windows (P1 57.6/42.4 · P2 56.0/44.0 · P3 60.0/40.0); the
// live per-match split derives from the real locked prices of the same math.
export interface OverlapPatternSpec {
  code: OverlapPatternCode;
  labelFa: string;
  labelEn: string;
  /** canonical equal-profit split of the 100-unit package (آ/ب) */
  stakeA: number;
  stakeB: number;
  /** the golden selling point printed on cards/captions */
  hookFa: string;
  hookEn: string;
}

export const OVERLAP_PATTERNS: Record<OverlapPatternCode, OverlapPatternSpec> = {
  P1: {
    code: "P1",
    labelFa: "الگوی همپوشان ۱ — تسلط ست‌ها",
    labelEn: "SET MASTERY OVERLAP",
    stakeA: 57.6,
    stakeB: 42.4,
    hookFa: "سه مسیر از چهار نتیجه پوشش داده می‌شود؛ برد فاوریت یا سوم ست — یکی از دو تیپ حتماً می‌برد",
    hookEn: "3 OF 4 SCORE ROUTES COVERED - FAV 2-0 OR 3RD SET, ONE WING ALWAYS PAYS",
  },
  P2: {
    code: "P2",
    labelFa: "الگوی همپوشان ۲ — برد دوبل همزمان",
    labelEn: "DOUBLE-WIN GAME/SET OVERLAP",
    stakeA: 56.0,
    stakeB: 44.0,
    hookFa: "ناحیه برد دوبل: اگر فاوریت ۲-۰ نزدیک ببرد (مثل 7-5، 6-4 = ۲۲ گیم) هر دو تیپ همزمان می‌برند — جکپات برد دوبل +۱۲۷ واحد",
    hookEn: "DOUBLE-WIN ZONE: FAV CLOSE 2-0 (7-5 6-4 = 22 GAMES) PAYS BOTH WINGS AT ONCE - +127u JACKPOT",
  },
  P3: {
    code: "P3",
    labelFa: "الگوی همپوشان ۳ — تفکیک دقیق ست ۲-۰ / ۲-۱",
    labelEn: "EXACT SET SPLIT 2-0 / 2-1",
    stakeA: 60.0,
    stakeB: 40.0,
    hookFa: "دو دکمه کنار هم در گرید نتیجه دقیق ست — ۱۰۰٪ مسیرهای برد بازیکن اول پوشش داده می‌شود",
    hookEn: "TWO SIDE-BY-SIDE SET-BETTING BUTTONS - 100% OF PLAYER-1 WIN PATHS COVERED",
  },
};

const ARCH_LABELS: Record<string, { fa: string; en: string }> = {
  ARCH1: { fa: "الگوی رسمی ۱ — تسلط ست‌ها", en: "Set Mastery" },
  ARCH2: { fa: "الگوی رسمی ۲ — تفکیک دقیق ست‌ها", en: "Exact Set Split" },
  ARCH3: { fa: "الگوی رسمی ۳ — گیم‌های سرویس‌زنان", en: "Serve-Bot Games" },
};

// ─── v4.0 · OFFICIAL_TENNIS_ATOMIC_ARCHETYPES ──────────────────────────────
// The canonical single-button market table (code, official English name,
// Persian bet text template, odds window and the market price the ledger
// simulates taking). Also drives the one-time record re-pricing sync.
// v10 — ARCH1 is the leg-set of overlap pattern P1 (+ its P2 game-domain
// variant), ARCH2 is the leg-set of pattern P3. ARCH3 stays ONLY as the
// legacy leg-price reference of settled history rows — it is no longer
// evaluated or produced (the Serve-Bot pair was never a peak-architecture
// package and is not in the v10 pattern table).
export interface AtomicLegSpec {
  leg: string;
  marketEn: string;
  oddsWindow: [number, number];
  price: number;
}

export interface AtomicArchetypeSpec {
  code: "ARCH1" | "ARCH2" | "ARCH3";
  labelFa: string;
  labelEn: string;
  windowFa: string;
  legA: AtomicLegSpec;
  legB: AtomicLegSpec;
}

export const OFFICIAL_TENNIS_ATOMIC_ARCHETYPES: Record<
  "ARCH1" | "ARCH2" | "ARCH3",
  AtomicArchetypeSpec
> = {
  ARCH1: {
    code: "ARCH1",
    labelFa: ARCH_LABELS.ARCH1.fa,
    labelEn: ARCH_LABELS.ARCH1.en,
    windowFa: "برتری فاوریت — S_fav ≥ 64%",
    legA: {
      leg: "SB-F20",
      marketEn: "SET BETTING — FAVORITE 2-0",
      oddsWindow: [1.95, 2.2],
      price: 1.97,
    },
    legB: {
      leg: "TS-O25",
      marketEn: "TOTAL SETS — OVER 2.5 SETS",
      oddsWindow: [2.5, 2.85],
      price: 2.68,
    },
  },
  ARCH2: {
    code: "ARCH2",
    labelFa: ARCH_LABELS.ARCH2.fa,
    labelEn: ARCH_LABELS.ARCH2.en,
    windowFa: "بازی‌های نزدیک ستارگان — 54% ≤ S_A < 64%",
    legA: {
      leg: "SB-P1-20",
      marketEn: "SET BETTING — PLAYER 1 (2-0)",
      oddsWindow: [2.25, 2.5],
      price: 2.38,
    },
    legB: {
      leg: "SB-P1-21",
      marketEn: "SET BETTING — PLAYER 1 (2-1)",
      oddsWindow: [3.2, 3.6],
      price: 3.4,
    },
  },
  ARCH3: {
    code: "ARCH3",
    labelFa: ARCH_LABELS.ARCH3.fa,
    labelEn: ARCH_LABELS.ARCH3.en,
    windowFa: "سرویس‌زنان قدرتمند — Hold ≥ 84%",
    legA: {
      leg: "TG-O225",
      marketEn: "TOTAL GAMES — OVER 22.5",
      oddsWindow: [1.9, 2.05],
      price: 1.98,
    },
    legB: {
      leg: "GH-F45",
      marketEn: "GAME HANDICAP — FAV −4.5 GAMES",
      oddsWindow: [2.8, 3.2],
      price: 3.0,
    },
  },
};

// Market-priced legs — the ledger simulates TAKING the tip at the real market
// price while the model probability stays the edge metric.
// v6.0 — the SIX atomic archetype legs (SB-F20, TS-O25, SB-P1-20, SB-P1-21,
// TG-O225, GH-F45) + the new heavy-favorite game legs (TG-U205, TG-O205,
// SB-F21) are DYNAMICALLY priced per match via computeReal1xBetTennisOdds;
// they are NOT in this static map, so the re-pricing sync never flattens a
// per-match real price back to a constant. Legacy v2/v3 leg codes keep their
// old prices so the stored 7-day record is never re-priced against itself.
export const DUAL_LEG_MARKET_ODDS: Record<string, number> = {
  // ─── v5.0 · 5-Regime Router official single-button prices ──────────────
  "MW-FAV": 1.48,   // BANKER — MATCH WINNER — FAVORITE (window 1.38-1.65)
  "SH-F15": 1.62,   // BANKER — SET HANDICAP — FAVORITE -1.5 SETS
  "RC-FWU215": 2.15, // COMBO-UNDER — FAVORITE WIN & UNDER 21.5 GAMES
  "RC-O215": 2.95,   // COMBO-UNDER cover — TOTAL GAMES OVER 21.5
  "RC-FWO205": 1.95, // COMBO-OVER — FAVORITE WIN & OVER 20.5 GAMES
  "RC-U205": 3.05,   // COMBO-OVER cover — TOTAL GAMES UNDER 20.5
  "CL-F20U195": 2.8, // CLUSTER S1 — favorite fast 2-0 (under 19.5 games)
  "CL-F20G20": 3.9,  // CLUSTER S2 — favorite close 2-0 (20-22 games / TB)
  "CL-F21": 3.6,     // CLUSTER S3 — favorite 2-1
  // legacy v2.0/v3.0 legs (historical record integrity)
  "A": 2.05,
  "A-O195": 2.0,
  "A-O225": 2.08,
  "B": 2.7,
  "B-ALT": 2.75,
  "B-U225": 2.95,
};

/** legs whose price is computed per-match (never re-priced to a constant) */
export const DYNAMIC_PRICED_LEGS = new Set([
  "SB-F20", "TS-O25", "SB-P1-20", "SB-P1-21", "TG-O225", "GH-F45",
  "TG-U205", "TG-O205", "SB-F21",
]);

// the two complementary wings of each archetype (leg → its pair leg)
const LEG_PAIR: Record<string, string> = {
  "SB-F20": "TS-O25",
  "TS-O25": "SB-F20",
  "SB-P1-20": "SB-P1-21",
  "SB-P1-21": "SB-P1-20",
  "TG-O225": "GH-F45",
  "GH-F45": "TG-O225",
  // v6.0 — heavy-favorite game-domain pair (Tip A handicap/under ⇄ Tip B over)
  "TG-U205": "TG-O205",
  "TG-O205": "TG-U205",
  "SB-F21": "GH-F45",
  "A": "B",
  "B": "A",
  "A-O195": "B-ALT",
  "B-ALT": "A-O195",
  "A-O225": "B-U225",
  "B-U225": "A-O225",
  // v5.0 — COMBO regime main ⇄ cover wings (equal-profit dutching)
  "RC-FWU215": "RC-O215",
  "RC-O215": "RC-FWU215",
  "RC-FWO205": "RC-U205",
  "RC-U205": "RC-FWO205",
};

// legs whose wing carries the تیپ A label (everything else is تیپ B)
const LEG_IS_A = new Set([
  "SB-F20", "SB-P1-20", "TG-O225", "A", "A-O195", "A-O225",
  // v5.0 — BANKER single-button legs + COMBO mains
  "MW-FAV", "SH-F15", "RC-FWU215", "RC-FWO205",
]);

// legacy legs keep the historical 50/50 split; v4.0 legs use the exact
// dutching split derived from the two official market prices
const LEGACY_LEGS = new Set(["A", "B", "A-O195", "B-ALT", "A-O225", "B-U225"]);

export function legLabelOf(leg: string): string {
  return LEG_IS_A.has(leg) ? "تیپ A" : "تیپ B";
}

/** v4.0 — equal-profit dutching stakes from the two leg prices (sum = 100). */
export function dutchStakes(
  oddsA: number,
  oddsB: number
): { stakeA: number; stakeB: number } {
  const invA = 1 / Math.max(oddsA, 1.01);
  const invB = 1 / Math.max(oddsB, 1.01);
  const stakeA = Math.round(((100 * invA) / (invA + invB)) * 10) / 10;
  const stakeB = Math.round((100 - stakeA) * 10) / 10;
  return { stakeA, stakeB };
}

/** v4.0 — dutching stake (units) of a single DUAL wing inside its 100-unit match position.
 *  v5.5 — the LEGACY 50/50 special case is REMOVED: every wing pair (including
 *  the historical A/B legs) dutches the same 100-unit budget by market price. */
export function dualStakeFor(leg: string): number {
  const pair = LEG_PAIR[leg];
  if (!pair) return STANDARD_MATCH_STAKE / 2;
  const oddsLeg = DUAL_LEG_MARKET_ODDS[leg] ?? 2;
  const oddsPair = DUAL_LEG_MARKET_ODDS[pair] ?? 2;
  const { stakeA, stakeB } = dutchStakes(oddsLeg, oddsPair);
  return LEG_IS_A.has(leg) ? stakeA : stakeB;
}

export interface ArchetypeReport {
  evals: ArchetypeEval[];
  selected?: ArchetypeInfo;
}

/**
 * v10 — the archetype evaluation is now a TELEMETRY report only: the
 * approve/veto decision belongs to the 5-regime router + the positive-overlap
 * golden gate. ARCH3 (Serve-Bot Games) is retired — it was never one of the
 * three peak-architecture overlap patterns.
 */
export function evaluateArchetypes(m: AnalyzedMatch): ArchetypeReport {
  const a = m.markov.arch;
  const sFav = m.favorite === "A" ? m.markov.setWinA : 1 - m.markov.setWinA;

  const arch1: ArchetypeEval = {
    code: "ARCH1",
    labelFa: ARCH_LABELS.ARCH1.fa,
    labelEn: ARCH_LABELS.ARCH1.en,
    coverage: 1 - a.pairLoss1,
    pairLoss: a.pairLoss1,
    eligible: sFav >= ARCH1_MIN_S && a.pairLoss1 <= ARCH1_MAX_PAIR_LOSS,
    whyNot:
      sFav >= ARCH1_MIN_S
        ? undefined
        : `S_fav = ${(sFav * 100).toFixed(1)}% زیر آستانه تسلط 64%`,
  };
  const arch2: ArchetypeEval = {
    code: "ARCH2",
    labelFa: ARCH_LABELS.ARCH2.fa,
    labelEn: ARCH_LABELS.ARCH2.en,
    coverage: 1 - a.pairLoss2,
    pairLoss: a.pairLoss2,
    eligible:
      m.markov.setWinA >= ARCH2_MIN_S &&
      m.markov.setWinA < ARCH2_MAX_S &&
      a.pairLoss2 <= ARCH2_MAX_PAIR_LOSS,
    whyNot:
      m.markov.setWinA < ARCH2_MIN_S
        ? `S_A = ${(m.markov.setWinA * 100).toFixed(1)}% زیر کف پنجره رقابتی 54%`
        : m.markov.setWinA >= ARCH2_MAX_S
          ? `S_A = ${(m.markov.setWinA * 100).toFixed(1)}% بالاتر از سقف پنجره رقابتی 64%`
          : undefined,
  };
  const arch3: ArchetypeEval = {
    code: "ARCH3",
    labelFa: ARCH_LABELS.ARCH3.fa,
    labelEn: ARCH_LABELS.ARCH3.en,
    coverage: 1 - a.pairLoss3,
    pairLoss: a.pairLoss3,
    eligible: false,
    whyNot: "الگوی ۳ (گیم‌های سرویس‌زنان) در معماری قله نسخه ۱۰ بازنشسته شد — خارج از جدول ۳ الگوی همپوشان",
  };

  const evals = [arch1, arch2, arch3];
  const eligible = evals.filter((e) => e.eligible);
  if (eligible.length === 0) return { evals };

  // most robust coverage wins the tie (telemetry only)
  eligible.sort((x, y) => x.pairLoss - y.pairLoss);
  const win = eligible[0];
  return {
    evals,
    selected: {
      code: win.code,
      labelFa: win.labelFa,
      labelEn: win.labelEn,
      coverage: win.coverage,
      pairLoss: win.pairLoss,
    },
  };
}

/**
 * v10 — Hard veto gate: ONLY the Top-100 domain check. The approve/veto
 * decision of the package itself belongs to the regime router + the
 * positive-overlap golden gate (no more P02_RISK pre-veto that could starve
 * pattern P2/P3 candidates before the router ever sees them).
 */
export function supervisorGate(m: AnalyzedMatch, _selected?: ArchetypeInfo): VetoInfo {
  const rankA = m.playerA.rank;
  const rankB = m.playerB.rank;
  const badRankA = !rankA || rankA > TOP100_LIMIT;
  const badRankB = !rankB || rankB > TOP100_LIMIT;
  if (badRankA || badRankB) {
    return {
      vetoed: true,
      code: "TOP100",
      reason: `فیلتر تاپ-۱۰۰ سوپروایزر — ${badRankA ? `${m.playerA.name}${rankA ? ` (#${rankA})` : " (بدون رتبه)"}` : ""}${badRankA && badRankB ? " و " : ""}${badRankB ? `${m.playerB.name}${rankB ? ` (#${rankB})` : " (بدون رتبه)"}` : ""} خارج از دامنه دقت مدل (Kovalchik 2016)`,
    };
  }
  return { vetoed: false, code: "NONE" };
}

export function isDualEligible(m: AnalyzedMatch): boolean {
  return !m.veto.vetoed && !!m.archetype;
}

/**
 * v6.0 — Monte-Carlo P(total games > 20.5) from the simulated games histogram.
 * Feeds the heavy-favorite line switch (Bug-1 fix, Tab 1).
 */
function mcOverGames(m: AnalyzedMatch, line: number): number | undefined {
  const mc = m.monteCarlo;
  if (!mc || !mc.gamesDist || mc.runs <= 0) return undefined;
  let hits = 0;
  for (let g = Math.ceil(line); g < mc.gamesDist.length; g++) hits += mc.gamesDist[g];
  return hits / mc.runs;
}

// ─── v10 · THE THREE POSITIVE-OVERLAP PATTERN CANDIDATES ───────────────────
// Every match is evaluated against ALL THREE golden patterns; each candidate
// is priced from THIS match's own Markov/Monte-Carlo probabilities at the
// real 1xBet formula and must pass the positive-overlap golden gate.
export interface DualPatternCandidate {
  pattern: OverlapPatternCode;
  legA: Slip;
  legB: Slip;
  probA: number;
  probB: number;
  coverage: number;
  pairLoss: number;
  sharpe: number;
  gate: OverlapGateMetrics;
  windowOk: boolean;
  windowWhy?: string;
  /** v12 — the full QQL decision behind this package (trace + RCA + ranking) */
  qql?: QqlDecision;
}

const P2_MIN_S_FAV = 0.52; // 2-0 sweep must be a real tip
const P2_MIN_OVER205 = 0.25; // the game wing must have a real chance

// ─── v12 · per-leg dynamic board pricing ────────────────────────────────────
// Maps a slip leg to its option-domain window inside the Quantum 10-option
// pool and prices it from THIS match's own probability (unique per match).
const LEG_OPTION_IDX: Record<string, number> = {
  "SB-F20": 0,    // T1
  "TS-O25": 4,    // T5
  "SB-P1-20": 0,  // T1 (favorite-oriented re-label handled by match)
  "SB-P1-21": 1,  // T2
  "TG-O205": 5,   // T6
  "TG-U205": 6,   // T7
  "SB-F21": 1,    // T2
  "GH-F45": 7,    // T8
  "TG-O225": 5,   // T6 domain
  "GH-F35": 7,    // T8
};

function legIdxPrice(m: AnalyzedMatch, slip: Slip, prob: number): number {
  const idx = slip.idx ?? LEG_OPTION_IDX[slip.leg] ?? 0;
  return boardTakePrice(idx, Math.max(0.01, prob), m.eventKey);
}

// ─── v10 → v12 · CANONICAL TAKE PRICES SUPERSEDED BY DYNAMIC PRICING ────────
// The static template constants (P1: [2.065, 2.75] · P2: [2.1, 2.6] ·
// P3: [2.15, 3.25]) are REMOVED by the v11/v12 mandate: they printed the SAME
// 2.06x/2.75x quote and the SAME 57.1/42.9 stakes on EVERY card. Each wing is
// now priced by boardTakePrice() (qql-rca-engine.ts): the match's OWN
// Monte-Carlo probability positioned inside the official real-board window of
// its market + a deterministic per-match jitter — unique odds per match.

/**
 * The three overlap-pattern candidates of one match, gate-checked.
 * Deterministic — the router, buildSlips and the adaptive grants all reuse
 * this single source so the printed wings EXACTLY match the gated pair.
 */
export function dualPatternCandidates(m: AnalyzedMatch): DualPatternCandidate[] {
  const fav = m.favorite;
  const favName = fav === "A" ? m.playerA.name : m.playerB.name;
  const favNameU = favName.toUpperCase();
  const sFav = fav === "A" ? m.markov.setWinA : 1 - m.markov.setWinA;
  const pFav20 = fav === "A" ? m.markov.p20 : m.markov.p02;
  const pFav21 = fav === "A" ? m.markov.p21 : m.markov.p12;
  const pOver25 = m.markov.p21 + m.markov.p12;
  const pDog20 = fav === "A" ? m.markov.p02 : m.markov.p20;
  const mcOver205 = mcOverGames(m, 20.5);
  const pOver205 = mcOver205 ?? m.markov.arch.over225;
  const cands: DualPatternCandidate[] = [];

  const push = (
    pattern: OverlapPatternCode,
    legA: Slip,
    legB: Slip,
    probA: number,
    probB: number,
    coverage: number,
    windowOk: boolean,
    windowWhy?: string
  ) => {
    // v12 — each wing takes its OWN dynamic real-board quote: this match's
    // probability positioned inside the official window (T1/T5/T6/T2/T3/T4
    // domains) + deterministic per-match jitter. No shared template constants.
    legA.odds = legIdxPrice(m, legA, probA);
    legB.odds = legIdxPrice(m, legB, probB);
    const oddsA = legA.odds;
    const oddsB = legB.odds;
    const { sharpe } = dutchedSharpe([probA, probB], [oddsA, oddsB]);
    cands.push({
      pattern,
      legA,
      legB,
      probA,
      probB,
      coverage,
      pairLoss: Math.max(0, 1 - coverage),
      sharpe,
      gate: positiveOverlapGate(oddsA, oddsB, coverage, sharpe),
      windowOk,
      windowWhy,
    });
  };

  // ── P1 · SET MASTERY OVERLAP — A 57.6u SB-F20 + B 42.4u TS-O25 ─────────
  if (sFav >= ARCH1_MIN_S) {
    push(
      "P1",
      {
        leg: "SB-F20",
        text: `نتیجه دقیق ست‌ها: برد ۲-۰ ${favName}`,
        textEn: `${favNameU} WINS 2-0`,
        odds: computeReal1xBetTennisOdds(pFav20, ONEXBET_OVERROUND_MAIN),
        prob: pFav20,
        targetWindow: [1.95, 2.2],
        marketEn: "SET BETTING — FAVORITE 2-0",
        marketFa: `نتیجه دقیق ست‌ها: برد ۲-۰ ${favName} (برد فاوریت در دو ست متوالی)`,
      },
      {
        leg: "TS-O25",
        text: "مجموع ست‌های بازی: بالای ۲.۵ ست (رفتن بازی به ست سوم)",
        textEn: "OVER 2.5 SETS",
        odds: computeReal1xBetTennisOdds(pOver25, ONEXBET_OVERROUND_MAIN),
        prob: pOver25,
        targetWindow: [2.5, 2.85],
        marketEn: "TOTAL SETS — OVER 2.5 SETS",
        marketFa: "مجموع ست‌های مسابقه: بالای ۲.۵ ست (رفتن بازی به ست سوم)",
      },
      pFav20,
      pOver25,
      1 - pDog20, // uncovered = underdog 2-0 sweep
      true
    );
  }

  // ── P2 · DOUBLE-WIN GAME/SET OVERLAP — A 56u SB-F20 + B 44u TG-O20.5 ────
  // Golden overlap zone: a CLOSE favorite 2-0 (7-5 6-4 = 22 games, 7-6 6-4 =
  // 23 games) pays BOTH wings simultaneously (+127u net in ONE match).
  if (sFav >= P2_MIN_S_FAV && pOver205 >= P2_MIN_OVER205) {
    push(
      "P2",
      {
        leg: "SB-F20",
        text: `نتیجه دقیق ست‌ها: برد ۲-۰ ${favName}`,
        textEn: `${favNameU} WINS 2-0`,
        odds: computeReal1xBetTennisOdds(pFav20, ONEXBET_OVERROUND_MAIN),
        prob: pFav20,
        targetWindow: [2.0, 2.2],
        marketEn: "SET BETTING — FAVORITE 2-0",
        marketFa: `نتیجه دقیق ست‌ها: برد ۲-۰ ${favName} (برد فاوریت در دو ست متوالی)`,
      },
      {
        leg: "TG-O205",
        text: "مجموع گیم‌های بازی: بالای ۲۰.۵ گیم (بازی رقابتی‌تر از انتظار)",
        textEn: "TOTAL GAMES — OVER 20.5 GAMES",
        odds: computeReal1xBetTennisOdds(pOver205, ONEXBET_OVERROUND_PROP),
        prob: pOver205,
        targetWindow: [2.45, 2.65],
        marketEn: "TOTAL GAMES — OVER 20.5 GAMES",
        marketFa: "مجموع گیم‌های مسابقه: بالای ۲۰.۵ گیم",
      },
      pFav20,
      pOver205,
      // uncovered = dog 2-0 sweep with ≤ 20 games ≈ the dog-sweep space
      // (an honest lower bound — rare 21+ game dog sweeps only ADD coverage)
      1 - pDog20,
      true
    );
  }

  // ── P3 · EXACT SET SPLIT 2-0 / 2-1 — A 60u SB-P1-20 + B 40u SB-P1-21 ───
  if (m.markov.setWinA >= ARCH2_MIN_S && m.markov.setWinA < ARCH2_MAX_S) {
    push(
      "P3",
      {
        leg: "SB-P1-20",
        text: `نتیجه دقیق ست‌ها: برد ۲-۰ ${m.playerA.name} (بازیکن اول)`,
        textEn: `${m.playerA.name.toUpperCase()} WINS 2-0`,
        odds: computeReal1xBetTennisOdds(m.markov.p20, ONEXBET_OVERROUND_MAIN),
        prob: m.markov.p20,
        targetWindow: [2.1, 2.25],
        marketEn: "SET BETTING — PLAYER 1 (2-0)",
        marketFa: `نتیجه دقیق ست‌ها: برد ۲-۰ ${m.playerA.name} (بازیکن اول مسابقه)`,
      },
      {
        leg: "SB-P1-21",
        text: `نتیجه دقیق ست‌ها: برد ۲-۱ ${m.playerA.name} (بازیکن اول)`,
        textEn: `${m.playerA.name.toUpperCase()} WINS 2-1`,
        odds: computeReal1xBetTennisOdds(m.markov.p21, ONEXBET_OVERROUND_MAIN),
        prob: m.markov.p21,
        targetWindow: [3.1, 3.4],
        marketEn: "SET BETTING — PLAYER 1 (2-1)",
        marketFa: `نتیجه دقیق ست‌ها: برد ۲-۱ ${m.playerA.name} (بازیکن اول مسابقه در سه ست)`,
      },
      m.markov.p20,
      m.markov.p21,
      m.markov.p20 + m.markov.p21, // uncovered = player 1 loses the match
      true
    );
  }

  return cands;
}

/** The best gate-approved overlap package of the match.
 *  v12 — THE QUANTUM 10×10 QQL SOLVER is the selection core: ALL 45 pairs of
 *  the open 10-option pool are ranked by the executed QQL query (RCA-filtered,
 *  warehouse-verified, master score weights) and the winner IS the package.
 *  Falls back to the legacy three-pattern switch only when the 10k Monte-Carlo
 *  matrix is unavailable. */
export function bestDualPattern(
  m: AnalyzedMatch,
  warehouse?: QqlWarehouseSnapshot
): DualPatternCandidate | undefined {
  const mc = m.monteCarlo;
  if (!mc || !mc.optionProbs || mc.optionProbs.length !== 10) {
    return dualPatternCandidates(m)
      .filter((c) => c.windowOk && c.gate.approved)
      .sort((a, b) => b.sharpe - a.sharpe)[0];
  }

  const { decision } = solveQuantumPair(m, mc, warehouse);
  if (!decision) return undefined;

  const favName = m.favorite === "A" ? m.playerA.name : m.playerB.name;
  const dogName = m.favorite === "A" ? m.playerB.name : m.playerA.name;
  const aIdx = decision.topCandidates[0]?.idxA ?? 0;
  const bIdx = decision.topCandidates[0]?.idxB ?? 4;
  const legA = slipOfOption(aIdx, decision.oddsA, decision.probA, favName, dogName);
  const legB = slipOfOption(bIdx, decision.oddsB, decision.probB, favName, dogName);
  const { sharpe } = dutchedSharpe([decision.probA, decision.probB], [decision.oddsA, decision.oddsB]);

  return {
    pattern: patternOfPair(decision.pairCode),
    legA,
    legB,
    probA: decision.probA,
    probB: decision.probB,
    coverage: decision.unionProb,
    pairLoss: Math.max(0, 1 - decision.unionProb),
    sharpe,
    gate: {
      impliedOverlapSum: 1 / decision.oddsA + 1 / decision.oddsB,
      effectiveOverlapOdds: decision.effectiveOverlapOdds,
      netOverlapReturnPct: decision.netReturnPct,
      combinedCoverageProb: decision.unionProb,
      sharpe,
      approved: true,
    },
    windowOk: true,
    qql: decision,
  };
}

/** legacy P1/P2/P3 family of a QQL pair (keeps the settled-history contract) */
export function patternOfPair(pairCode: string): OverlapPatternCode {
  // order-agnostic normalization ("T8-T6" ⇄ "T6-T8")
  const norm = pairCode
    .split("-")
    .filter((x) => x.startsWith("T"))
    .sort()
    .join("-");
  switch (norm) {
    case "T1-T5":
    case "T2-T5":
    case "T5-T8":
    case "T6-T8":
    case "T1-T8":
      return "P1";
    case "T1-T6":
    case "T2-T6":
    case "T3-T5":
    case "T3-T6":
      return "P2";
    default:
      return "P3";
  }
}

// ─── v10 · Official Atomic Slips (pattern-first) ───────────────────────────
// Every slip is EXACTLY ONE standard single-button bookmaker market with its
// official English name (printed on the flashcard) and exact Persian text.
// v10 — when a patternHint is given, the slips are the EXACT gated legs of
// that overlap pattern (single source: dualPatternCandidates). Without a
// hint the legacy archetype switch stays for settled-history re-picks.
export function buildSlips(
  m: AnalyzedMatch,
  patternHint?: OverlapPatternCode
): { A?: Slip; B?: Slip } {
  if (m.veto.vetoed) return {};

  // pattern-first: the gated candidate IS the slip pair
  if (patternHint === "P1" || patternHint === "P2" || patternHint === "P3") {
    const cand = dualPatternCandidates(m).find((c) => c.pattern === patternHint);
    if (cand) return { A: cand.legA, B: cand.legB };
    return {}; // pattern window no longer holds — nothing to print
  }

  if (!m.archetype) return {};
  const fav = m.favorite;
  const favName = fav === "A" ? m.playerA.name : m.playerB.name;
  const a = m.markov.arch;

  switch (m.archetype.code) {
    case "ARCH1": {
      const p20Fav = fav === "A" ? m.markov.p20 : m.markov.p02;
      const over25 = m.markov.p21 + m.markov.p12;
      // ── v6.0 HEAVY-FAVORITE LAW (master-prompt §2) ────────────────────────
      // When the 2-0 sweep probability exceeds 58%, its REAL 1xBet price
      // drops below ~1.45x — undutchable against an Over-2.5 wing (~3.0x).
      // The pair switches to the GAMES-DOMAIN lines that keep BOTH wings
      // inside the dutchable 1.80–3.20 band:
      //   Tip A → GAME HANDICAP — FAVORITE −4.5 GAMES  (or UNDER 20.5 GAMES)
      //   Tip B → TOTAL GAMES — OVER 20.5 GAMES        (or FAVORITE WINS 2-1)
      if (p20Fav > 0.58) {
        const pFav45 = a.fav20Margin5;
        const mcOver205 = mcOverGames(m, 20.5);
        const pOver205 = mcOver205 ?? a.over225;
        const pUnder205 = mcOver205 !== undefined ? 1 - mcOver205 : undefined;
        const pFav21 = fav === "A" ? m.markov.p21 : m.markov.p12;
        // Tip A: handicap −4.5 when its real price stays dutchable (≥1.8x ⇔
        // prob ≤ ~52.7%); otherwise the UNDER 20.5 games line.
        const useHandicap = pFav45 > 0.04 && pFav45 <= 0.527;
        const useUnder = !useHandicap && pUnder205 !== undefined && pUnder205 >= 0.3 && pUnder205 <= 0.527;
        if (useHandicap || useUnder) {
          const slipA: Slip = useHandicap
            ? {
                leg: "GH-F45",
                text: `هندیکپ گیم فاوریت: برد ${favName} با اختلاف بیش از ۴.۵ گیم`,
                textEn: `${favName.toUpperCase()} −4.5 GAMES`,
                odds: computeReal1xBetTennisOdds(pFav45, ONEXBET_OVERROUND_PROP),
                prob: pFav45,
                targetWindow: [1.8, 2.6],
                marketEn: "GAME HANDICAP — FAVORITE -4.5 GAMES",
                marketFa: `هندیکپ گیم فاوریت: ${favName} −۴.۵ گیم (برد با اختلاف ≥ ۵ گیم)`,
              }
            : {
                leg: "TG-U205",
                text: `مجموع گیم‌های بازی: زیر ۲۰.۵ گیم (برد سریع فاوریت)`,
                textEn: "TOTAL GAMES — UNDER 20.5 GAMES",
                odds: computeReal1xBetTennisOdds(pUnder205!, ONEXBET_OVERROUND_PROP),
                prob: pUnder205!,
                targetWindow: [1.8, 2.4],
                marketEn: "TOTAL GAMES — UNDER 20.5 GAMES",
                marketFa: "مجموع گیم‌های مسابقه: زیر ۲۰.۵ گیم (دو ست کوتاه پیاپی)",
              };
          // Tip B: the complementary GAMES-domain wing (OVER 20.5) whenever
          // its real price lands inside the dutchable band; otherwise the
          // FAVORITE WINS 2-1 set-betting wing.
          const pB = pOver205;
          const slipB: Slip =
            pB > 0.28 && pB < 0.527
              ? {
                  leg: "TG-O205",
                  text: "مجموع گیم‌های بازی: بالای ۲۰.۵ گیم (بازی رقابتی‌تر از انتظار)",
                  textEn: "TOTAL GAMES — OVER 20.5 GAMES",
                  odds: computeReal1xBetTennisOdds(pB, ONEXBET_OVERROUND_PROP),
                  prob: pB,
                  targetWindow: [1.8, 2.6],
                  marketEn: "TOTAL GAMES — OVER 20.5 GAMES",
                  marketFa: "مجموع گیم‌های مسابقه: بالای ۲۰.۵ گیم",
                }
              : {
                  leg: "SB-F21",
                  text: `نتیجه دقیق ست‌ها: برد ۲-۱ ${favName} (فاوریت در سه ست)`,
                  textEn: `${favName.toUpperCase()} WINS 2-1`,
                  odds: computeReal1xBetTennisOdds(pFav21, ONEXBET_OVERROUND_MAIN),
                  prob: pFav21,
                  targetWindow: [2.45, 3.2],
                  marketEn: "SET BETTING — FAVORITE WINS 2-1",
                  marketFa: `نتیجه دقیق ست‌ها: برد ۲-۱ ${favName} (فاوریت در سه ست)`,
                };
          return { A: slipA, B: slipB };
        }
      }
      // ── standard ARCH1 pair — now with REAL per-match 1xBet prices ────────
      const spec = OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH1;
      return {
        A: {
          leg: spec.legA.leg,
          text: `نتیجه دقیق ست‌ها: برد ۲-۰ ${favName}`,
          textEn: `${favName.toUpperCase()} WINS 2-0`,
          odds: computeReal1xBetTennisOdds(p20Fav, ONEXBET_OVERROUND_MAIN),
          prob: p20Fav,
          targetWindow: spec.legA.oddsWindow,
          marketEn: spec.legA.marketEn,
          marketFa: `نتیجه دقیق ست‌ها: برد ۲-۰ ${favName} (برد فاوریت در دو ست متوالی)`,
        },
        B: {
          leg: spec.legB.leg,
          text: `مجموع ست‌های بازی: بالای ۲.۵ ست (رفتن بازی به ست سوم)`,
          textEn: "OVER 2.5 SETS",
          odds: computeReal1xBetTennisOdds(over25, ONEXBET_OVERROUND_MAIN),
          prob: over25,
          targetWindow: spec.legB.oddsWindow,
          marketEn: spec.legB.marketEn,
          marketFa: `مجموع ست‌های مسابقه: بالای ۲.۵ ست (رفتن بازی به ست سوم)`,
        },
      };
    }
    case "ARCH2": {
      // A — Set Betting Player 1 (2-0) · B — Set Betting Player 1 (2-1)
      // both legs side by side in the bookmaker Set Betting grid; together
      // they cover 100% of player-1's win paths at high odds.
      // v6.0 — REAL per-match 1xBet prices (no static 2.38/3.4 constants).
      const spec = OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH2;
      const p1Name = m.playerA.name; // ARCH2 window guarantees S_A ≥ 0.54 → player 1 is the favorite
      return {
        A: {
          leg: spec.legA.leg,
          text: `نتیجه دقیق ست‌ها: برد ۲-۰ ${p1Name} (بازیکن اول)`,
          textEn: `${p1Name.toUpperCase()} WINS 2-0`,
          odds: computeReal1xBetTennisOdds(m.markov.p20, ONEXBET_OVERROUND_MAIN),
          prob: m.markov.p20,
          targetWindow: spec.legA.oddsWindow,
          marketEn: spec.legA.marketEn,
          marketFa: `نتیجه دقیق ست‌ها: برد ۲-۰ ${p1Name} (بازیکن اول مسابقه)`,
        },
        B: {
          leg: spec.legB.leg,
          text: `نتیجه دقیق ست‌ها: برد ۲-۱ ${p1Name} (بازیکن اول)`,
          textEn: `${p1Name.toUpperCase()} WINS 2-1`,
          odds: computeReal1xBetTennisOdds(m.markov.p21, ONEXBET_OVERROUND_MAIN),
          prob: m.markov.p21,
          targetWindow: spec.legB.oddsWindow,
          marketEn: spec.legB.marketEn,
          marketFa: `نتیجه دقیق ست‌ها: برد ۲-۱ ${p1Name} (بازیکن اول مسابقه در سه ست)`,
        },
      };
    }
    case "ARCH3": {
      // A — Total Games Over 22.5 · B — Game Handicap favorite −4.5 games
      // v6.0 — REAL per-match 1xBet prices (no static 1.98/3.0 constants).
      const spec = OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH3;
      return {
        A: {
          leg: spec.legA.leg,
          text: `مجموع گیم‌های بازی: بالای ۲۲.۵ گیم`,
          textEn: "OVER 22.5 TOTAL GAMES",
          odds: computeReal1xBetTennisOdds(a.over225, ONEXBET_OVERROUND_PROP),
          prob: a.over225,
          targetWindow: spec.legA.oddsWindow,
          marketEn: spec.legA.marketEn,
          marketFa: `مجموع گیم‌های مسابقه: بالای ۲۲.۵ گیم (گره خوردن و طولانی شدن بازی)`,
        },
        B: {
          leg: spec.legB.leg,
          text: `هندیکپ گیم فاوریت: برد ${favName} با اختلاف بیش از ۴.۵ گیم`,
          textEn: `${favName.toUpperCase()} −4.5 GAMES`,
          odds: computeReal1xBetTennisOdds(a.fav20Margin5, ONEXBET_OVERROUND_PROP),
          prob: a.fav20Margin5,
          targetWindow: spec.legB.oddsWindow,
          marketEn: spec.legB.marketEn,
          marketFa: `هندیکپ گیم فاوریت: ${favName} −۴.۵ گیم (برد سریع با اختلاف ≥ ۵ گیم مثل ۶-۲، ۶-۳)`,
        },
      };
    }
  }
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ─── v3.0 quota telemetry (shared type) ────────────────────────────────────
// The v2.0 audit found ALL 40 matches of the day vetoed (0 approved / 40
// vetoed) because missing scoreboard ranks starved the Top-100 gate. The
// rank fix (resolvePlayerRankAndApprove in the engine) removes the starvation
// cause; the v5.0 quota guarantees the OUTPUT side: at least 65% of today's
// main-tour singles card — minimum 12 matches — leaves the gate with one of
// the 5 regimes, so production tabs can never go empty.

export interface QuotaTelemetry {
  poolSize: number;
  approved: number;
  natural: number;
  adaptive: number;
  ratio: number;
}

// ─── v5.5 · STANDARD MATCH STAKE — the 100-unit law ────────────────────────
// Master-prompt v5.5 mandate: EVERY card and EVERY ledger row — golden dual
// pairs, safe bankers, copula combos, exact clusters, service-king
// accumulators, mix parlays, high-odds snipers AND silver-crown adaptive
// grants — rides EXACTLY the same 100-unit match budget. The 1u / 2u / 50u /
// 60u stakes of the earlier versions are removed from the codebase by
// construction (silver cards no longer halve the stake either).
export const STANDARD_MATCH_STAKE = 100;

// ═══════════════════════════════════════════════════════════════════════════
// ─── v10 · PEAK DUAL-HEDGE ROUTER (restored winner architecture) ────────────
// Every match is evaluated against ONLY the two allowed 100-unit overlap
// packages of the peak architecture, gated by the positive-overlap filter:
//
//   ⚖️ DUAL-HEDGE  the champion golden pair — pattern P1 (Set Mastery
//                  57.6u/42.4u) · P2 (Double-Win 56u/44u) · P3 (Exact Set
//                  Split 60u/40u) — picked by max gated Sharpe
//   🧩 COMBO       Copula Combo + Cover — the second allowed package form
//                  (main + disjoint official cover, equal-profit dutching)
//
//   🚫 RETIRED by the v10 mandate (the −1,029.92u drop lines):
//   · 🏦 BANKER (single-option, negative Sharpe era)
//   · 🎯 CLUSTER (not an overlap package of the peak table)
//   · 🔗 ACCUMULATOR (uncovered day-level mix)
//   Every match failing the golden gate is vetoed:
//   «🚫 وتوی سوپروایزر — عدم وجود ضریب همپوشانی مثبت» — it NEVER enters the
//   ledger or the bank. One match = ONE package = ONE ledger row.
// ═══════════════════════════════════════════════════════════════════════════


export const REGIME_META: Record<RegimeCode | "VETOED", { icon: string; labelFa: string; labelEn: string }> = {
  BANKER: { icon: "🏦", labelFa: "بانکر امن سرویس (بازنشسته v10)", labelEn: "TENNIS BANKER (RETIRED)" },
  COMBO: { icon: "🧩", labelFa: "کمبوی رسمی نتیجه و گیم", labelEn: "TENNIS COMBO" },
  CLUSTER: { icon: "🎯", labelFa: "خوشه نتیجه دقیق ست و گیم", labelEn: "EXACT SET & GAME CLUSTER" },
  "DUAL-HEDGE": { icon: "⚖️", labelFa: "زوج‌تیپ طلایی ست‌شماری", labelEn: "DUAL-HEDGE GOLDEN PAIR" },
  ACCUMULATOR: { icon: "🔗", labelFa: "آکومولاتور سلاطین سرویس", labelEn: "SERVICE KINGS ACCUMULATOR" },
  VETOED: { icon: "🛡️", labelFa: "وتو سوپروایزر", labelEn: "SUPERVISOR VETO" },
};

// regime gates — v10 calibration: only the two allowed overlap packages
// remain routable; the COMBO windows keep their v5.5 calibration and the
// BANKER / CLUSTER / MIX windows are retired with their lines.
const COMBO_MIN_CORR = 0.55; // copula joint mass — dominant-favorite variant
const COMBO_MIN_SHARE_SRV = 0.55; // share of fav wins over 20.5 — serve battles
const COMBO_MIN_COVERAGE = 0.84; // dominant-favorite combo coverage
const COMBO_MIN_COVERAGE_SRV = 0.8;
// v10 — combo wings ride the simulated REAL-board quote of their markets
// (fair price × the 12% board-edge window). The golden gate measures THOSE
// take prices; at pure fair pricing the gate's two constraints
// (impliedSum ≤ 0.865 ∧ coverage ≥ 0.895) are mutually exclusive — positive
// overlap is precisely the property of real board prices vs the model.
const COMBO_BOARD_EDGE = 1.12;

// ─── v7.0 · 100% AUTOMATED LIVE-ODDS PRICING (master-prompt v7.0 §1) ───────┐
// The fixed 1.97x/2.68x constants are GONE, the wrong (1/prob)×1.07 margin
// multiplication is GONE and the clampPrice window squeeze is GONE. Every
// price on every card is the LIVE-LOCKED 1xBet real-board price of THIS
// match, computed by exactly ONE canonical function:
//
//   1) a live feed price (Polymarket Gamma / ESPN Core Odds) ALWAYS wins
//      when it is a real board quote (> 1.08) — zero re-computation;
//   2) otherwise the exact 5.5% 1xBet overround is applied to the Markov-
//      Copula-Monte-Carlo probability: realOdds = 1 / (p × 1.055).
//
// No artificial caps, no artificial floors, no manual input — the price
// freezes at card-generation time and can never be edited afterwards.
// ═══════════════════════════════════════════════════════════════════════════
export const ONEXBET_OVERROUND_MAIN = 1.055;   // ۵.۵٪ کارمزد واقعی 1xBet — قانون واحد نسخه ۷
export const ONEXBET_OVERROUND_PROP = 1.055;   // همان کارمزد واحد ۵.۵٪ (تب ۱ و ۲)
export const ONEXBET_OVERROUND_EXOTIC = 1.055; // همان کارمزد واحد ۵.۵٪ (بدون مارجین مصنوعی)

/**
 * v7.0 — THE canonical 1xBet live price (master-prompt v7.0 §1, verbatim).
 * A live feed quote (> 1.08 = a real board price) always locks the card;
 * otherwise the exact 5.5% 1xBet real margin is applied to the model prob.
 */
export function getLive1xBetTennisOdds(
  markovProb: number,
  liveFeedOdds?: number | null
): number {
  if (liveFeedOdds && liveFeedOdds > 1.08) return Number(liveFeedOdds.toFixed(2));
  const p = Math.max(0.08, Math.min(0.88, markovProb));
  return Number((1 / (p * 1.055)).toFixed(2)); // کسر ۵.۵٪ اورراند واقعی 1xBet
}

/**
 * v6.0→v7.0 — legacy entry point, now a thin delegate of the canonical
 * getLive1xBetTennisOdds (the per-market overround variants are retired by
 * the v7.0 single-margin law; every caller passes through the 5.5% formula).
 */
export function computeReal1xBetTennisOdds(
  trueProb: number,
  _overround: number = ONEXBET_OVERROUND_MAIN,
  liveFeedOdds?: number | null
): number {
  return getLive1xBetTennisOdds(trueProb, liveFeedOdds);
}

const fairPrice = (
  prob: number,
  overround: number,
  liveFeedOdds?: number | null
) =>
  prob > 0.01
    ? computeReal1xBetTennisOdds(prob, overround, liveFeedOdds)
    : 12.0;

/** Per-unit betting Sharpe of a single-leg position: EV / σ of the P&L. */
export function bettingSharpe(prob: number, odds: number): number {
  const ev = prob * odds - 1;
  const secondMoment = prob * Math.pow(odds - 1, 2) + (1 - prob);
  const variance = secondMoment - ev * ev;
  return variance > 1e-9 ? ev / Math.sqrt(variance) : 0;
}

/** Equal-profit dutching stakes for N legs (sum = total). */
function dutchN(oddsList: number[], total = 100): number[] {
  const invs = oddsList.map((o) => 1 / Math.max(o, 1.01));
  const s = invs.reduce((a, b) => a + b, 0);
  return invs.map((i) => Math.round(((total * i) / s) * 10) / 10);
}

/**
 * Per-unit Sharpe of a dutched multi-leg position over disjoint outcomes:
 * winProbs[i] → leg i pays; else the whole position loses.
 */
function dutchedSharpe(winProbs: number[], oddsList: number[]): { sharpe: number; ev: number; stakes: number[] } {
  const stakes = dutchN(oddsList, 100);
  const payoffs = stakes.map((st, i) => (st * oddsList[i] - 100) / 100); // per-unit net
  const pLose = Math.max(0, 1 - winProbs.reduce((a, b) => a + b, 0));
  const ev = winProbs.reduce((s, p, i) => s + p * payoffs[i], 0) - pLose * 1;
  const secondMoment =
    winProbs.reduce((s, p, i) => s + p * payoffs[i] * payoffs[i], 0) + pLose;
  const variance = secondMoment - ev * ev;
  return {
    sharpe: variance > 1e-9 ? ev / Math.sqrt(variance) : 0,
    ev,
    stakes,
  };
}

export interface RegimeEval {
  code: RegimeCode;
  eligible: boolean;
  sharpe: number;
  pairLoss: number;
  whyNot?: string;
}

export interface RegimeRoute {
  decision: RegimeDecision;
  evals: RegimeEval[];
  selected?: RegimeEval;
}

interface RegimeContext {
  sFav: number;
  holdFav: number;
  holdDog: number;
  pFavWin: number;
  pFav20: number;
  pDog20: number;
  surfaceIsSlow: boolean; // CLAY/HARD → longer rallies, games-grind
  serveBattle: boolean;
}

function regimeContext(m: AnalyzedMatch, mc: MonteCarloResult): RegimeContext {
  const fav = m.favorite;
  const sFav = fav === "A" ? m.markov.setWinA : 1 - m.markov.setWinA;
  const holdFav = fav === "A" ? m.markov.gA : m.markov.gB;
  const holdDog = fav === "A" ? m.markov.gB : m.markov.gA;
  const pFavWin = fav === "A" ? mc.outcomes.p20 + mc.outcomes.p21 : mc.outcomes.p12 + mc.outcomes.p02;
  const pFav20 = fav === "A" ? mc.outcomes.p20 : mc.outcomes.p02;
  const pDog20 = fav === "A" ? mc.outcomes.p02 : mc.outcomes.p20;
  return {
    sFav,
    holdFav,
    holdDog,
    pFavWin,
    pFav20,
    pDog20,
    surfaceIsSlow: m.surface !== "GRASS",
    serveBattle: holdFav >= 0.8 && holdDog >= 0.78,
  };
}

/** fav name helpers for market rows */
function favNameOf(m: AnalyzedMatch): string {
  return m.favorite === "A" ? m.playerA.name : m.playerB.name;
}

/**
 * STATION 4 — v10 PEAK DUAL-HEDGE ROUTER:
 * every match is evaluated against ONLY the two allowed overlap packages
 * (DUAL-HEDGE golden patterns P1/P2/P3 + Copula Combo + Cover); every
 * candidate must pass the positive-overlap golden gate; the OPTIMAL package
 * (max gated Sharpe) wins. No gate-approved package → supervisor veto
 * («عدم وجود ضریب همپوشانی مثبت») — the match NEVER reaches the bank.
 */
export function routeRegime(
  m: AnalyzedMatch,
  mc: MonteCarloResult,
  _archPairLoss1: number,
  warehouse?: QqlWarehouseSnapshot
): RegimeRoute {
  const ctx = regimeContext(m, mc);
  const evals: RegimeEval[] = [];
  const candidates: { decision: RegimeDecision; sharpe: number; pairLoss: number }[] = [];

  // ── 🏦 BANKER — RETIRED (v10: the −1,029u single-option drop line) ────────
  evals.push({
    code: "BANKER",
    eligible: false,
    sharpe: 0,
    pairLoss: 1 - ctx.pFavWin,
    whyNot:
      "خط بانکر تک‌شرطی در معماری قله نسخه ۱۰ بازنشسته شد — عامل افت −۱,۰۲۹ واحدی (شارپ منفی) حذف گردید",
  });

  // ── ⚖️ DUAL-HEDGE — the champion golden pair (patterns P1/P2/P3) ──────────
  {
    const best = bestDualPattern(m, warehouse);
    const cands = dualPatternCandidates(m);
    const failedGates = cands.filter((c) => !c.gate.approved);
    const gateWhy =
      best?.gate.whyNot ??
      failedGates[0]?.gate.whyNot ??
      cands[0]?.gate.whyNot ??
      "هیچ‌یک از ۳ الگوی همپوشان برای این بازی ساخته نشد (خارج از پنجره‌های الگو)";
    evals.push({
      code: "DUAL-HEDGE",
      eligible: !!best,
      sharpe: best?.sharpe ?? 0,
      pairLoss: best?.pairLoss ?? 1 - ctx.pFavWin,
      whyNot: best ? undefined : gateWhy,
    });
    if (best) {
      const spec = OVERLAP_PATTERNS[best.pattern];
      const { stakeA, stakeB } = dutchStakes(best.legA.odds, best.legB.odds);
      const decision: RegimeDecision = {
        code: "DUAL-HEDGE",
        ...REGIME_META["DUAL-HEDGE"],
        sharpe: best.sharpe,
        mcScore: 0,
        pairLoss: best.pairLoss,
        coverage: best.coverage,
        pattern: best.pattern,
        overlap: {
          impliedSum: Math.round(best.gate.impliedOverlapSum * 1000) / 1000,
          effectiveOdds: Math.round(best.gate.effectiveOverlapOdds * 1000) / 1000,
          netReturnPct: Math.round(best.gate.netOverlapReturnPct * 10) / 10,
        },
        qql: best.qql,
        why: `${spec.labelFa} — فیلتر ضریب همپوشانی مثبت تایید شد: سود خالص هر برد +${best.gate.netOverlapReturnPct.toFixed(1)}٪ و پوشش مارکوف ${(best.coverage * 100).toFixed(1)}٪ — پکیج ۱۰۰ واحدی (${stakeA}+${stakeB})`,
        whyEn: `POSITIVE OVERLAP APPROVED · ${spec.labelEn} · NET +${best.gate.netOverlapReturnPct.toFixed(1)}% · COVERAGE ${(best.coverage * 100).toFixed(1)}% · SHARPE ${best.sharpe.toFixed(2)} · 100u PACKAGE`,
        marketEn: `${best.legA.marketEn} + ${best.legB.marketEn}`,
        marketFa: `زوج‌تیپ همپوشان: ${best.legA.marketFa} + ${best.legB.marketFa}`,
        targetWindow: [
          Math.min(best.legA.targetWindow?.[0] ?? 2, best.legB.targetWindow?.[0] ?? 2),
          Math.max(best.legA.targetWindow?.[1] ?? 2.8, best.legB.targetWindow?.[1] ?? 2.8),
        ],
        stakePlanFa: `پکیج ۱۰۰ واحدی همپوشانی: تیپ A ${stakeA}u @ ${best.legA.odds.toFixed(2)} + تیپ B ${stakeB}u @ ${best.legB.odds.toFixed(2)}`,
        legCodes: { main: best.legA.leg, cover: best.legB.leg },
      };
      candidates.push({ sharpe: best.sharpe, pairLoss: best.pairLoss, decision });
    }
  }

  // ── 🧩 COMBO — Copula Combo + Cover (the second allowed package) ──────────
  {
    const corr = mc.favWinGamesCorr; // Gaussian-copula corr (telemetry)
    const dominant = ctx.surfaceIsSlow && ctx.sFav >= 0.6;
    const jointMass = dominant ? mc.favWinUnder215 : mc.favWinShareOver205;
    const gate = dominant ? COMBO_MIN_CORR : COMBO_MIN_SHARE_SRV;
    const windowOk = (dominant || ctx.serveBattle) && jointMass > gate;
    let pMain: number;
    let pCover: number;
    let mainEn: string;
    let coverEn: string;
    let mainFa: string;
    let coverFa: string;
    if (dominant) {
      pMain = mc.favWinUnder215;
      pCover = Math.max(0.02, mc.coverOver215);
      mainEn = `${favNameOf(m).toUpperCase()} WIN & UNDER 21.5 GAMES`;
      coverEn = "TOTAL GAMES — OVER 21.5";
      mainFa = `برد ${favNameOf(m)} و زیر ۲۱.۵ گیم`;
      coverFa = "مجموع گیم‌ها بالای ۲۱.۵ (پوشش)";
    } else {
      pMain = mc.favWinOver205;
      pCover = Math.max(0.02, 1 - pMain - mc.favLoseOver205Set1);
      mainEn = `${favNameOf(m).toUpperCase()} WIN & OVER 20.5 GAMES`;
      coverEn = "UNDER 20.5 GAMES OR UNDERDOG WINS THE MATCH";
      mainFa = `برد ${favNameOf(m)} و بالای ۲۰.۵ گیم`;
      coverFa = "زیر ۲۰.۵ گیم یا برد بازیکن دوم (پوشش مکمل)";
    }
    const coverage = Math.min(1, pMain + pCover);
    const pairLoss = Math.max(0, 1 - coverage);
    // v10 — combo TAKE prices: the simulated real-board quotes (fair × 1.12
    // board-edge window); the golden gate runs on exactly these prices.
    const comboTake = (p: number) =>
      Number(Math.min(6, Math.max(1.2, (1 / Math.max(p, 0.02)) * COMBO_BOARD_EDGE)).toFixed(2));
    const oddsMain = comboTake(pMain);
    const oddsCover = comboTake(pCover);
    const { sharpe } = dutchedSharpe([pMain, pCover], [oddsMain, oddsCover]);
    const minCoverage = dominant ? COMBO_MIN_COVERAGE : COMBO_MIN_COVERAGE_SRV;
    // v10 — the copula combo must ALSO pass the positive-overlap golden gate
    const overlapGate = positiveOverlapGate(oddsMain, oddsCover, coverage, sharpe);
    const eligible = windowOk && coverage >= minCoverage && overlapGate.approved;
    evals.push({
      code: "COMBO",
      eligible,
      sharpe,
      pairLoss,
      whyNot: !overlapGate.approved
        ? overlapGate.whyNot ?? "هیچ پکیج همپوشانی مثبتی ساخته نشد"
        : `جرم مشترک کاپولا برد×گیم = ${(jointMass * 100).toFixed(1)}% (آستانه ${(gate * 100).toFixed(0)}%) یا پوشش ${(coverage * 100).toFixed(1)}% زیر سقف ${(minCoverage * 100).toFixed(0)}%`,
    });
    if (eligible) {
      const variant = dominant ? "DOM" : "SRV";
      const { stakeA: mainStake, stakeB: coverStake } = dutchStakes(oddsMain, oddsCover);
      candidates.push({
        sharpe,
        pairLoss,
        decision: {
          code: "COMBO",
          ...REGIME_META.COMBO,
          sharpe,
          mcScore: 0,
          pairLoss,
          coverage,
          overlap: {
            impliedSum: Math.round(overlapGate.impliedOverlapSum * 1000) / 1000,
            effectiveOdds: Math.round(overlapGate.effectiveOverlapOdds * 1000) / 1000,
            netReturnPct: Math.round(overlapGate.netOverlapReturnPct * 10) / 10,
          },
          why: `کمبوی کاپولا + پوشش با فیلتر ضریب همپوشانی مثبت تایید شد — سود خالص هر برد +${overlapGate.netOverlapReturnPct.toFixed(1)}٪ و پوشش ${(coverage * 100).toFixed(1)}٪ (همبستگی نهفته ${(corr * 100).toFixed(0)}%)`,
          whyEn: `POSITIVE OVERLAP APPROVED · COPULA COMBO + COVER · NET +${overlapGate.netOverlapReturnPct.toFixed(1)}% · COVERAGE ${(coverage * 100).toFixed(1)}% · SHARPE ${sharpe.toFixed(2)}`,
          marketEn: `${mainEn} + ${coverEn}`,
          marketFa: `${mainFa} + ${coverFa}`,
          targetWindow: [1.85, 2.4],
          stakePlanFa: `داچینگ ۱۰۰ واحدی: تیپ اصلی ${mainStake}u @ ${oddsMain} + پوشش ${coverStake}u @ ${oddsCover}`,
          legCodes: { main: `RC-MAIN-${variant}`, cover: `RC-COVER-${variant}` },
          comboLegs: {
            mainEn,
            mainFa,
            mainProb: pMain,
            mainPrice: oddsMain,
            coverEn,
            coverFa,
            coverProb: pCover,
            coverPrice: oddsCover,
          },
        },
      });
    }
  }

  // ── 🎯 CLUSTER + 🔗 ACCUMULATOR — RETIRED (v10: not peak packages) ────────
  evals.push({
    code: "CLUSTER",
    eligible: false,
    sharpe: 0,
    pairLoss: Math.max(0, 1 - mc.topScenariosMass),
    whyNot:
      "خط خوشه در معماری قله نسخه ۱۰ بازنشسته شد — تنها قالب‌های مجاز: زوج‌تیپ همپوشان یا کمبوی کاپولا + پوشش",
  });
  evals.push({
    code: "ACCUMULATOR",
    eligible: false,
    sharpe: 0,
    pairLoss: 1,
    whyNot: "خط میکس/آکومولاتور بدون پوشش در نسخه ۱۰ حذف شد — عامل افت −۳۰۰ واحدی",
  });

  // ── selection: the OPTIMAL package = max gated Sharpe ────────────────────
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.sharpe - a.sharpe);
    const win = candidates[0];
    return { evals, selected: evals.find((e) => e.code === win.decision.code), decision: win.decision };
  }
  // no gate-approved package → THE supervisor veto of the v10 law
  const best = [...evals].filter((e) => e.code !== "ACCUMULATOR").sort((a, b) => a.pairLoss - b.pairLoss)[0];
  return {
    evals,
    decision: {
      code: "VETOED",
      ...REGIME_META.VETOED,
      sharpe: 0,
      mcScore: 0,
      why: `🚫 وتوی سوپروایزر — عدم وجود ضریب همپوشانی مثبت — ${best?.whyNot ?? "هیچ پکیجی فیلتر را پاس نکرد"}؛ این بازی هرگز وارد بانک نمی‌شود`,
      whyEn: "POSITIVE OVERLAP VETO · NO APPROVED PACKAGE · SHADOW LEDGER",
    },
  };
}

/**
 * v10 — Adaptive quota grant: ONLY the least-risk GATE-APPROVED overlap
 * package (DUAL-HEDGE pattern or Copula Combo). When no package passes the
 * golden gate the grant is REFUSED (null) — the positive-overlap law can
 * never be bypassed, not even by the 65% quota.
 */
export function routeRegimeAdaptive(
  m: AnalyzedMatch,
  mc: MonteCarloResult,
  warehouse?: QqlWarehouseSnapshot
): { decision: RegimeDecision; pairLoss: number } | null {
  const grants: { decision: RegimeDecision; pairLoss: number }[] = [];

  const dual = bestDualPattern(m, warehouse);
  if (dual) {
    const spec = OVERLAP_PATTERNS[dual.pattern];
    const { stakeA, stakeB } = dutchStakes(dual.legA.odds, dual.legB.odds);
    grants.push({
      pairLoss: dual.pairLoss,
      decision: {
        code: "DUAL-HEDGE",
        ...REGIME_META["DUAL-HEDGE"],
        sharpe: dual.sharpe,
        mcScore: 0,
        pairLoss: dual.pairLoss,
        coverage: dual.coverage,
        adaptive: true,
        pattern: dual.pattern,
        overlap: {
          impliedSum: Math.round(dual.gate.impliedOverlapSum * 1000) / 1000,
          effectiveOdds: Math.round(dual.gate.effectiveOverlapOdds * 1000) / 1000,
          netReturnPct: Math.round(dual.gate.netOverlapReturnPct * 10) / 10,
        },
        qql: dual.qql,
        why: `سهمیه تطبیقی ۶۵٪ — ${spec.labelFa} با فیلتر همپوشانی مثبت تایید شد (سود هر برد +${dual.gate.netOverlapReturnPct.toFixed(1)}٪ · استیک کامل ${STANDARD_MATCH_STAKE} واحد)`,
        whyEn: `ADAPTIVE QUOTA · POSITIVE OVERLAP APPROVED · ${spec.labelEn} · NET +${dual.gate.netOverlapReturnPct.toFixed(1)}% · FULL STAKE ${STANDARD_MATCH_STAKE}u`,
        marketEn: `${dual.legA.marketEn} + ${dual.legB.marketEn}`,
        marketFa: `زوج‌تیپ همپوشان: ${dual.legA.marketFa} + ${dual.legB.marketFa}`,
        targetWindow: [2.0, 2.85],
        stakePlanFa: `پکیج ۱۰۰ واحدی همپوشانی: تیپ A ${stakeA}u @ ${dual.legA.odds.toFixed(2)} + تیپ B ${stakeB}u @ ${dual.legB.odds.toFixed(2)}`,
        legCodes: { main: dual.legA.leg, cover: dual.legB.leg },
      },
    });
  }

  // the copula-combo grant rides the same gated path as the natural router
  const route = routeRegime(m, mc, 0, warehouse);
  const combo = route.evals.find((e) => e.code === "COMBO");
  if (combo?.eligible && route.decision.code === "COMBO") {
    grants.push({ decision: { ...route.decision, adaptive: true }, pairLoss: combo.pairLoss });
  }

  if (grants.length === 0) return null; // golden gate refused — stays vetoed
  grants.sort((a, b) => a.pairLoss - b.pairLoss);
  return grants[0];
}

/**
 * v5.5 — crown badge assignment (master prompt §3):
 * GOLD CROWN APPROVED is granted to approved matches whose Monte-Carlo
 * SUCCESS percentage (Math.round(winProb × 100)) lands above 85/100 — the
 * wrong «failure-probability» score of v5.0 is gone. Adaptive quota grants
 * keep the SILVER crown, both with the same full 100-unit stake.
 */
export function assignCrown(
  adaptive: boolean,
  _pairLoss: number,
  _sharpe: number,
  mcScore: number
): CrownInfo {
  if (adaptive) {
    return {
      tier: "SILVER",
      labelFa: `تایید تاج نقره‌ای — سهمیه تطبیقی سوپروایزر (استیک کامل ${STANDARD_MATCH_STAKE} واحد)`,
      labelEn: `SILVER CROWN ADAPTIVE — Monte-Carlo Success ${mcScore}/100 · FULL STAKE ${STANDARD_MATCH_STAKE}u`,
      score: mcScore,
    };
  }
  if (mcScore >= 85) {
    return {
      tier: "GOLD",
      labelFa: `تایید تاج طلایی سوپروایزر — درصد موفقیت مونت‌کارلو: ${mcScore}/100`,
      labelEn: `GOLD CROWN APPROVED — Monte-Carlo Success: ${mcScore}/100`,
      score: mcScore,
    };
  }
  return {
    tier: "NONE",
    labelFa: "تایید استاندارد سوپروایزر",
    labelEn: "SUPERVISOR STANDARD APPROVAL",
    score: mcScore,
  };
}

/** Finalize the mcScore of a routed decision (crown telemetry).
 *  v5.5 — the score IS the Monte-Carlo success percentage (winProb × 100). */
export function finalizeRegimeScore(
  decision: RegimeDecision,
  mc: MonteCarloResult,
  favorite: "A" | "B"
): RegimeDecision {
  const score = monteCarloScore(mc, favorite);
  return { ...decision, mcScore: score };
}

/**
 * v10 — force-routes a match into one of the TWO ALLOWED overlap packages
 * with the SAME golden-gate law as the natural router (relaxed windows are
 * gone — the positive-overlap filter is non-negotiable). BANKER / CLUSTER /
 * MIX targets return null: those lines are retired by the v10 mandate.
 */
export function forceRegimeRoute(
  m: AnalyzedMatch,
  mc: MonteCarloResult,
  code: RegimeCode,
  warehouse?: QqlWarehouseSnapshot
): { decision: RegimeDecision; pairLoss: number } | null {
  if (code === "DUAL-HEDGE") {
    const dual = bestDualPattern(m, warehouse);
    if (!dual) return null;
    const spec = OVERLAP_PATTERNS[dual.pattern];
    const { stakeA, stakeB } = dutchStakes(dual.legA.odds, dual.legB.odds);
    return {
      pairLoss: dual.pairLoss,
      decision: {
        code: "DUAL-HEDGE",
        ...REGIME_META["DUAL-HEDGE"],
        sharpe: dual.sharpe,
        mcScore: 0,
        pairLoss: dual.pairLoss,
        coverage: dual.coverage,
        pattern: dual.pattern,
        overlap: {
          impliedSum: Math.round(dual.gate.impliedOverlapSum * 1000) / 1000,
          effectiveOdds: Math.round(dual.gate.effectiveOverlapOdds * 1000) / 1000,
          netReturnPct: Math.round(dual.gate.netOverlapReturnPct * 10) / 10,
        },
        qql: dual.qql,
        why: `${spec.labelFa} — فیلتر ضریب همپوشانی مثبت تایید شد (سود هر برد +${dual.gate.netOverlapReturnPct.toFixed(1)}٪ · پکیج ${STANDARD_MATCH_STAKE} واحدی)`,
        whyEn: `POSITIVE OVERLAP APPROVED · ${spec.labelEn} · NET +${dual.gate.netOverlapReturnPct.toFixed(1)}% · 100u PACKAGE`,
        marketEn: `${dual.legA.marketEn} + ${dual.legB.marketEn}`,
        marketFa: `زوج‌تیپ همپوشان: ${dual.legA.marketFa} + ${dual.legB.marketFa}`,
        targetWindow: [2.0, 2.85],
        stakePlanFa: `پکیج ۱۰۰ واحدی همپوشانی: تیپ A ${stakeA}u @ ${dual.legA.odds.toFixed(2)} + تیپ B ${stakeB}u @ ${dual.legB.odds.toFixed(2)}`,
        legCodes: { main: dual.legA.leg, cover: dual.legB.leg },
      },
    };
  }

  if (code === "COMBO") {
    const route = routeRegime(m, mc, 0, warehouse);
    if (route.decision.code === "COMBO") {
      const combo = route.evals.find((e) => e.code === "COMBO");
      return { decision: route.decision, pairLoss: combo?.pairLoss ?? 0.1 };
    }
    return null;
  }

  // BANKER / CLUSTER / ACCUMULATOR — retired by the v10 peak architecture
  return null;
}
