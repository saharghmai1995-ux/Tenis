// ─── NeoTennis Markov Quant v12.0 — In-Memory QQL Query Core + AI Causal RCA ─
// qql-rca-engine.ts · «موتور زبان پرس‌وجوی تحلیلی + ریشه‌یابی علّی هوش مصنوعی»
//
// This module IS the executed QQL pipeline of master-prompt v12 §2:
//
//   WITH historical_surface_twins AS (
//     SELECT pair_code, AVG(win_flag) AS surface_win_rate, …
//     FROM tennis_historical_warehouse
//     WHERE surface = :match_surface
//       AND ABS(hold_diff − :match_hold_diff) <= 0.08
//       AND ABS(copula_rho − :match_copula_rho) <= 0.06
//     GROUP BY pair_code
//   )
//   SELECT … FROM candidate_45_tennis_pairs c
//   LEFT JOIN historical_surface_twins h ON c.pair_code = h.pair_code
//   WHERE (1/odds_a + 1/odds_b) <= 0.865
//     AND markov_union_prob >= 0.895
//     AND is_blocked_by_rca_rule = FALSE
//   ORDER BY (verified_win_rate*100 + double_win_overlap_prob*80
//             + (effective_overlap_odds − 1)*140) DESC
//   LIMIT 1;
//
// The candidate_45_tennis_pairs table is materialized IN MEMORY for every
// match from the «Quantum 10×10 Combinatorial Matrix» of the 10,000-run
// Monte-Carlo (optionProbs + optionJoint) — every pair's union & double-win
// probability is EXACT, measured on the same simulation, never approximated
// by independent-event algebra. The tennis_historical_warehouse is loaded
// from the settled ledger DB (surface + ΔHold + ρ twins) by ledger.loadQqlWarehouse().
//
// Odds of EVERY option are derived from THIS match's own simulation
// probability, positioned inside its official real-board window (v11 §2:
// «هیچ دو مسابقه‌ای ضرایب یکسان نداشته باشند») — the static 2.06x/2.75x
// template constants are gone by construction.

import type {
  AnalyzedMatch,
  MonteCarloResult,
  QqlDecision,
  QqlFamilyCode,
  QqlOptionSpec,
  QqlPairCandidate,
  QqlWarehouseSnapshot,
  RcaRuleHit,
  Slip,
  Surface,
} from "./types";

// ─── 1 · THE OPEN 10-OPTION ATP/WTA POOL (master-prompt v11 §3, verbatim) ───
export const TENNIS_OPTION_POOL: QqlOptionSpec[] = [
  {
    code: "T1", idx: 0,
    marketEn: "SET BETTING — PLAYER FAVORITE WINS 2-0",
    marketFa: "نتیجه دقیق ست‌ها: برد ۲-۰ فاوریت",
    leg: "T1-SB-F20",
    boardWindow: [1.98, 2.3],
    family: "F1",
  },
  {
    code: "T2", idx: 1,
    marketEn: "SET BETTING — PLAYER FAVORITE WINS 2-1",
    marketFa: "نتیجه دقیق ست‌ها: برد ۲-۱ فاوریت",
    leg: "T2-SB-F21",
    boardWindow: [3.05, 3.5],
    family: "F1",
  },
  {
    code: "T3", idx: 2,
    marketEn: "SET BETTING — PLAYER 2 WINS 2-0",
    marketFa: "نتیجه دقیق ست‌ها: برد ۲-۰ بازیکن دوم",
    leg: "T3-SB-D20",
    boardWindow: [2.85, 3.6],
    family: "F4",
  },
  {
    code: "T4", idx: 3,
    marketEn: "SET BETTING — PLAYER 2 WINS 2-1",
    marketFa: "نتیجه دقیق ست‌ها: برد ۲-۱ بازیکن دوم",
    leg: "T4-SB-D21",
    boardWindow: [3.5, 4.5],
    family: "F4",
  },
  {
    code: "T5", idx: 4,
    marketEn: "TOTAL SETS — OVER 2.5 SETS",
    marketFa: "مجموع ست‌های مسابقه: بالای ۲.۵ ست",
    leg: "T5-TS-O25",
    boardWindow: [2.62, 2.92],
    family: "F1",
  },
  {
    code: "T6", idx: 5,
    marketEn: "TOTAL GAMES — OVER 20.5 GAMES",
    marketFa: "مجموع گیم‌های مسابقه: بالای ۲۰.۵ گیم",
    leg: "T6-TG-O205",
    boardWindow: [2.48, 2.72],
    family: "F2",
  },
  {
    code: "T7", idx: 6,
    marketEn: "TOTAL GAMES — UNDER 21.5 GAMES",
    marketFa: "مجموع گیم‌های مسابقه: زیر ۲۱.۵ گیم",
    leg: "T7-TG-U215",
    boardWindow: [1.5, 1.8],
    family: "F5",
  },
  {
    code: "T8", idx: 7,
    marketEn: "GAME HANDICAP — FAVORITE -3.5 GAMES",
    marketFa: "هندیکپ گیم فاوریت: ۳.۵- گیم",
    leg: "T8-GH-F35",
    boardWindow: [2.72, 3.25],
    family: "F3",
  },
  {
    code: "T9", idx: 8,
    marketEn: "GAME HANDICAP — UNDERDOG +3.5 GAMES",
    marketFa: "هندیکپ گیم آندرداگ: ۳.۵+ گیم",
    leg: "T9-GH-D35",
    boardWindow: [1.4, 1.7],
    family: "F5",
  },
  {
    code: "T10", idx: 9,
    marketEn: "1ST SET WINNER — FAVORITE & OVER 9.5 GAMES",
    marketFa: "برد ست اول فاوریت یا تای‌بریک ست اول",
    leg: "T10-SS-F10",
    boardWindow: [1.85, 2.25],
    family: "F5",
  },
];

export const OPT_BY_CODE = new Map(TENNIS_OPTION_POOL.map((o) => [o.code, o]));

// ─── 2 · THE 6 PATTERN FAMILIES (v12 §3-3 — «۶ خانواده الگوی کشف‌شده») ──────
export const QQL_FAMILIES: Record<QqlFamilyCode, { labelFa: string; labelEn: string }> = {
  F1: { labelFa: "خانواده ۱ — تسلط ست‌ها [T1↔T5]", labelEn: "SET MASTERY OVERLAP" },
  F2: { labelFa: "خانواده ۲ — برد دوبل گیم‌ها [T1↔T6]", labelEn: "DOUBLE-WIN GAME OVERLAP" },
  F3: { labelFa: "خانواده ۳ — نبرد خاک رس [T8↔T5]", labelEn: "CLAY-GRIND HANDICAP" },
  F4: { labelFa: "خانواده ۴ — فاوریت بازیکن دوم [T3↔T5]", labelEn: "PLAYER-2 FAVORITE" },
  F5: { labelFa: "خانواده ۵ — سپر رنک نزدیک و تفکیک دقیق", labelEn: "CLOSE-RANK SHIELD & EXACT SPLIT" },
  F6: { labelFa: "خانواده ۶ — کمبوی کاپولا + پوشش", labelEn: "COPULA COMBO + COVER" },
};

// ─── 3 · THE AI CAUSAL RCA RULEBASE (master-prompt v12 §2-الف, verbatim) ────
export interface RcaEvaluation {
  hits: RcaRuleHit[];
  /** score bonus per pairCode (steering weights) */
  bonus: Map<string, number>;
  /** hard block per pairCode → reason */
  blocked: Map<string, string>;
}

const RCA_TENNIS_01_HOLD = 0.86;
const RCA_TENNIS_02_HOLD_LO = 0.64;
const RCA_TENNIS_02_HOLD_HI = 0.74;
const RCA_TENNIS_03_RANK_GAP = 15;
const RCA_TENNIS_03_DOG20 = 0.12;

/** order-agnostic pair key — "T8"+"T5" and "T5"+"T8" both normalize to "T5-T8" */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

export function evaluateRcaRules(m: AnalyzedMatch): RcaEvaluation {
  const hits: RcaRuleHit[] = [];
  const bonus = new Map<string, number>();
  const blocked = new Map<string, string>();
  const favHold = m.favorite === "A" ? m.markov.gA : m.markov.gB;
  const pDog20 = m.favorite === "A" ? m.markov.p02 : m.markov.p20;
  const rankA = m.playerA.rank;
  const rankB = m.playerB.rank;
  const rankGap = rankA && rankB ? Math.abs(rankA - rankB) : undefined;

  // RCA_TENNIS_01_SERVE_DOMINANCE_TRAP — Hold ≥ 86% on hardcourt: 3-set prob
  // collapses but the CLOSE 2-0 (7-6 6-4) mass is high → steer [T1 ↔ T6].
  if (favHold >= RCA_TENNIS_01_HOLD && m.surface === "HARD") {
    hits.push({
      code: "RCA_TENNIS_01_SERVE_DOMINANCE_TRAP",
      fired: true,
      steer: "[T1 ↔ T6]",
      noteFa: `هولد سرو فاوریت ${(favHold * 100).toFixed(1)}% ≥ ۸۶٪ روی هاردکورت — احتمال بازی ۳ سته پایین اما برد ۲-۰ نزدیک (7-6، 6-4) پرحجم است؛ بهینه‌ساز به جفت [T1 ↔ T6] هدایت شد`,
    });
    bonus.set(pairKey("T1", "T6"), (bonus.get(pairKey("T1", "T6")) ?? 0) + 120);
    for (const pc of [pairKey("T1", "T5"), pairKey("T1", "T6"), pairKey("T1", "T2"), pairKey("T1", "T8"), pairKey("T1", "T10")]) {
      bonus.set(pc, (bonus.get(pc) ?? 0) + 40);
    }
  } else {
    hits.push({
      code: "RCA_TENNIS_01_SERVE_DOMINANCE_TRAP",
      fired: false,
      noteFa: `هولد سرو فاوریت ${(favHold * 100).toFixed(1)}% زیر آستانه تسلط ۸۶٪ — قاعده فعال نشد`,
    });
  }

  // RCA_TENNIS_02_WTA_CLAY_BREAK_VOLATILITY — WTA/clay with Hold ∈ [64%,74%]:
  // break-heavy exchange, a bare 2-0 risks the set-1 loss → steer [T8 ↔ T5],
  // block the bare-2-0 game pair.
  if (
    (m.tour === "WTA" || m.surface === "CLAY") &&
    favHold >= RCA_TENNIS_02_HOLD_LO &&
    favHold <= RCA_TENNIS_02_HOLD_HI
  ) {
    hits.push({
      code: "RCA_TENNIS_02_WTA_CLAY_BREAK_VOLATILITY",
      fired: true,
      steer: "[T8 ↔ T5]",
      noteFa: `${m.tour === "WTA" ? "مسابقه WTA" : "زمین خاک رس"} با هولد ${(favHold * 100).toFixed(1)}% در بازه پرنوسان بریک [۶۴٪ تا ۷۴٪] — بستن ۲-۰ خالی ریسک باخت ست اول دارد؛ جفت [T8 ↔ T5] انتخاب شد (برد ۳ سته با اختلاف ≥ ۴ گیم هر دو تیپ را همزمان می‌برد)`,
    });
    bonus.set(pairKey("T8", "T5"), (bonus.get(pairKey("T8", "T5")) ?? 0) + 120);
    for (const pc of [pairKey("T8", "T5"), pairKey("T8", "T6"), pairKey("T8", "T2")]) {
      bonus.set(pc, (bonus.get(pc) ?? 0) + 30);
    }
    blocked.set(pairKey("T1", "T6"), "RCA_TENNIS_02 — بستن ۲-۰ خالی در نوسان بریک بالای خاک رس/WTA ممنوع");
    blocked.set(pairKey("T1", "T7"), "RCA_TENNIS_02 — زیر گیم خالی در بازی پربریک ریسک بالاست");
  } else {
    hits.push({
      code: "RCA_TENNIS_02_WTA_CLAY_BREAK_VOLATILITY",
      fired: false,
      noteFa: `هولد ${(favHold * 100).toFixed(1)}% خارج از بازه نوسان بریک [۶۴٪ تا ۷۴٪] یا سطح/تور پربریک نیست — قاعده فعال نشد`,
    });
  }

  // RCA_TENNIS_03_CLOSE_RANK_UPSET_SHIELD — rank gap < 15 AND underdog 2-0
  // win prob > 12% → prefer [T9 ↔ T3] or veto the match (never a bare fav pair).
  if (rankGap !== undefined && rankGap < RCA_TENNIS_03_RANK_GAP && pDog20 > RCA_TENNIS_03_DOG20) {
    hits.push({
      code: "RCA_TENNIS_03_CLOSE_RANK_UPSET_SHIELD",
      fired: true,
      steer: "[T9 ↔ T3]",
      noteFa: `فاصله رنک دو بازیکن ${rankGap} رتبه (< ۱۵) و احتمال برد ۲-۰ آندرداگ ${(pDog20 * 100).toFixed(1)}% > ۱۲٪ — سپر شوک فعال شد؛ جفت [T9 ↔ T3] یا وتوی کامل بازی`,
    });
    bonus.set(pairKey("T9", "T3"), (bonus.get(pairKey("T9", "T3")) ?? 0) + 90);
    for (const pc of [pairKey("T9", "T3"), pairKey("T9", "T6"), pairKey("T3", "T5")]) {
      bonus.set(pc, (bonus.get(pc) ?? 0) + 25);
    }
    blocked.set(pairKey("T1", "T5"), "RCA_TENNIS_03 — پوشش تسلط فاوریت در بازی نزدیک رنک/پرانحیاز شوک بی‌پوشش است");
    blocked.set(pairKey("T1", "T6"), "RCA_TENNIS_03 — برد ۲-۰ فاوریت در برابر شوک ۲-۰ آندرداگ محافظت نشده است");
  } else {
    hits.push({
      code: "RCA_TENNIS_03_CLOSE_RANK_UPSET_SHIELD",
      fired: false,
      noteFa:
        rankGap === undefined
          ? "رنک رسمی یکی از دو بازیکن در دسترس نیست — قاعده سپر رنک نزدیک ارزیابی نشد"
          : `فاصله رنک ${rankGap} رتبه و احتمال شوک ۲-۰ آندرداگ ${(pDog20 * 100).toFixed(1)}% — قاعده فعال نشد`,
    });
  }

  // RCA_TENNIS_04_PLAYER2_FAVORITE_ORIENTATION — when the LISTED player 2 is
  // the real favorite (model favorite = B), the T-space auto-orients to the
  // player-2 sweep families and the slips are labeled with the player-2 name.
  if (m.favorite === "B") {
    hits.push({
      code: "RCA_TENNIS_04_PLAYER2_FAVORITE_ORIENTATION",
      fired: true,
      steer: "[T3 ↔ T5] (فضای تیپ فاوریت‌محور: [T1 ↔ T5] با نام بازیکن دوم)",
      noteFa: `بازیکن دوم (${m.playerB.name}) فاوریت واقعی مسابقه است (p_B > p_A) — تله‌متری و نام بازارها به‌طور خودکار با نام بازیکن دوم عرضه شد`,
    });
  } else {
    hits.push({
      code: "RCA_TENNIS_04_PLAYER2_FAVORITE_ORIENTATION",
      fired: false,
      noteFa: `بازیکن اول (${m.playerA.name}) فاوریت واقعی مسابقه است — جهت‌گیری پیش‌فرض حفظ شد`,
    });
  }

  return { hits, bonus, blocked };
}

// ─── 4 · DYNAMIC PER-MATCH BOARD PRICING (v11 §2 — no shared constants) ─────
/** deterministic 32-bit hash — per (eventKey, option) jitter seed */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * v11/v12 — the take price of ONE option for ONE match:
 *   1) the match's own Monte-Carlo probability of the option is mapped into
 *      the probability domain implied by the official board window;
 *   2) a deterministic per-match jitter (±0.02) breaks residual collisions;
 *   3) the price is clamped inside the window and rounded to the 2dp board
 *      convention. Every match gets its own quote — the fixed 2.06x/2.75x
 *      template is gone by construction.
 */
export function boardTakePrice(
  idx: number,
  prob: number,
  seedKey: string
): number {
  const spec = TENNIS_OPTION_POOL[idx];
  const [lo, hi] = spec.boardWindow;
  const pLo = 1 / hi; // weakest allowed model prob (→ highest board quote)
  const pHi = 1 / lo; // strongest allowed model prob (→ lowest board quote)
  const t = clamp((prob - pLo) / Math.max(pHi - pLo, 1e-9), 0, 1);
  const base = hi - t * (hi - lo);
  const jitter = ((hash32(`${seedKey}:${spec.code}`) % 1000) / 1000 - 0.5) * 0.04;
  return round2(clamp(base + jitter, lo, hi));
}

/** equal-profit dutching stakes of a 100-unit package */
export function dutchStakesOf(oddsA: number, oddsB: number): { stakeA: number; stakeB: number } {
  const invA = 1 / Math.max(oddsA, 1.01);
  const invB = 1 / Math.max(oddsB, 1.01);
  const stakeA = Math.round(((100 * invA) / (invA + invB)) * 10) / 10;
  return { stakeA, stakeB: Math.round((100 - stakeA) * 10) / 10 };
}

/** per-unit Sharpe of the dutched 2-leg package over disjoint win events */
function dutchedSharpe2(winProbs: number[], oddsList: number[]): number {
  const { stakeA, stakeB } = dutchStakesOf(oddsList[0], oddsList[1]);
  const stakes = [stakeA, stakeB];
  const payoffs = stakes.map((st, i) => (st * oddsList[i] - 100) / 100);
  const pLose = Math.max(0, 1 - winProbs.reduce((a, b) => a + b, 0));
  const ev = winProbs.reduce((s, p, i) => s + p * payoffs[i], 0) - pLose;
  const second = winProbs.reduce((s, p, i) => s + p * payoffs[i] * payoffs[i], 0) + pLose;
  const variance = second - ev * ev;
  return variance > 1e-9 ? ev / Math.sqrt(variance) : 0;
}

// ─── 5 · THE EXECUTED QQL PIPELINE (45-pair ranking, verbatim scoring) ──────
export const OVERLAP_MAX_IMPLIED_SUM = 0.865;
export const OVERLAP_MIN_UNION = 0.895;
export const OVERLAP_MIN_SHARPE = 0.25;
const MIN_TAKE = 1.15;

export interface QqlSolveInput {
  mc: MonteCarloResult;
  /** |holdA − holdB| — the ΔHold twin key of the warehouse */
  holdDiff: number;
  copulaRho: number;
  surface: Surface;
  eventKey: string;
  favoriteName: string;
  dogName: string;
  warehouse?: QqlWarehouseSnapshot;
}

/** family of a T-pair (the 6 discovered pattern families) — order-agnostic */
export function familyOfPair(pairCode: string): QqlFamilyCode {
  // normalize to sorted form ("T8-T6" and "T6-T8" are the same pair)
  const norm = pairCode
    .split("-")
    .filter((x) => x.startsWith("T"))
    .sort()
    .join("-");
  switch (norm) {
    case "T1-T5":
    case "T2-T5":
      return "F1";
    case "T1-T6":
    case "T2-T6":
    case "T6-T7":
      return "F2";
    case "T6-T8":
    case "T1-T8":
      return "F3";
    case "T3-T5":
    case "T3-T6":
    case "T3-T4":
    case "T4-T5":
      return "F4";
    default:
      return "F5";
  }
}

/**
 * THE QQL SOLVER — evaluates all 45 candidate pairs of the 10-option pool
 * for one match and returns the winning package + the full trace.
 * 100% synchronous (the warehouse is a pre-loaded snapshot).
 */
export function solveQuantumPair(
  m: AnalyzedMatch,
  mc: MonteCarloResult,
  warehouse?: QqlWarehouseSnapshot
): { decision: QqlDecision | null; candidates: QqlPairCandidate[] } {
  const holdDiff = Math.abs(m.markov.gA - m.markov.gB);
  const matchRho = m.copula?.rhoSetCoupling ?? 0;
  const rca = evaluateRcaRules(m);

  // per-option dynamic board prices (unique per match, derived from the sim)
  const odds = TENNIS_OPTION_POOL.map((o) =>
    Math.max(MIN_TAKE, boardTakePrice(o.idx, Math.max(0.01, mc.optionProbs[o.idx] ?? 0), m.eventKey))
  );

  const surfaceTwins = warehouse?.[m.surface] ?? {};
  const candidates: QqlPairCandidate[] = [];

  /** the historical_surface_twins query — tolerance-matched over the raw
   *  warehouse entries (surface = :match_surface ∧ |ΔHold − x| ≤ 0.08 ∧
   *  |ρ − y| ≤ 0.06), aggregated per pair_code exactly as the SQL groups. */
  const twinOf = (pairCode: string) => {
    const entries = surfaceTwins[pairCode] ?? [];
    const matched = entries.filter(
      (e) => Math.abs(e.holdDiff - holdDiff) <= 0.08 && Math.abs(e.rho - matchRho) <= 0.06
    );
    if (matched.length === 0) return undefined;
    const winRate = matched.reduce((s, e) => s + e.winFlag, 0) / matched.length;
    const doubleWinRate = matched.reduce((s, e) => s + e.doubleWinFlag, 0) / matched.length;
    const avgProfit = matched.reduce((s, e) => s + e.profit, 0) / matched.length;
    return { winRate, doubleWinRate, avgProfit, count: matched.length };
  };

  for (let i = 0; i < TENNIS_OPTION_POOL.length; i++) {
    for (let j = i + 1; j < TENNIS_OPTION_POOL.length; j++) {
      const oi = TENNIS_OPTION_POOL[i];
      const oj = TENNIS_OPTION_POOL[j];
      const pairCode = pairKey(oi.code, oj.code);
      const probA = mc.optionProbs[i] ?? 0;
      const probB = mc.optionProbs[j] ?? 0;
      const joint = mc.optionJoint[i][j] ?? 0;
      const unionProb = Math.min(1, probA + probB - joint);
      const oddsA = odds[i];
      const oddsB = odds[j];
      const impliedSum = 1 / Math.max(oddsA, 1.01) + 1 / Math.max(oddsB, 1.01);
      const effective = 1 / impliedSum;

      // ── the historical_surface_twins LEFT JOIN (COALESCE → union prob) ──
      const twin = twinOf(pairCode);
      const verifiedWinRate = twin && twin.count > 0 ? twin.winRate : unionProb;
      const twinCount = twin?.count ?? 0;

      // ── the master ORDER BY score (verbatim weights) ────────────────────
      // ORDER BY (verified_win_rate*100 + double_win_overlap_prob*80
      //           + (effective_overlap_odds − 1)*140) DESC
      const rcaBonus = rca.bonus.get(pairCode) ?? 0;
      const scoreReal =
        verifiedWinRate * 100 +
        joint * 80 +
        (effective - 1) * 140 +
        rcaBonus;

      const blocked = rca.blocked.get(pairCode);
      const sharpe = dutchedSharpe2([probA, probB], [oddsA, oddsB]);
      const { stakeA, stakeB } = dutchStakesOf(oddsA, oddsB);
      const netReturnPct = (effective - 1) * 100;
      const gateWhy =
        impliedSum > OVERLAP_MAX_IMPLIED_SUM
          ? `مجموع معکوس ضرایب ${impliedSum.toFixed(3)} بالای سقف 0.865`
          : netReturnPct < 15.5
            ? `سود خالص همپوشانی +${netReturnPct.toFixed(1)}% زیر کف +15.5%`
            : unionProb < OVERLAP_MIN_UNION
              ? `پوشش مونت‌کارلو ${(unionProb * 100).toFixed(1)}% زیر کف 89.5%`
              : sharpe < OVERLAP_MIN_SHARPE
                ? `نسبت شارپ داچینگ ${sharpe.toFixed(2)} زیر کف 0.25`
                : undefined;

      candidates.push({
        pairCode,
        idxA: i,
        idxB: j,
        oddsA,
        oddsB,
        probA,
        probB,
        unionProb: Math.round(unionProb * 100000) / 100000,
        doubleWinProb: joint,
        impliedSum: Math.round(impliedSum * 1000) / 1000,
        effectiveOverlapOdds: Math.round(effective * 1000) / 1000,
        stakeA,
        stakeB,
        verifiedWinRate: Math.round(verifiedWinRate * 100000) / 100000,
        twinCount,
        score: Math.round(scoreReal * 1000) / 1000,
        gatePassed: !gateWhy,
        gateWhy,
        blockedByRca: !!blocked,
        rcaBlockWhy: blocked,
      });
    }
  }

  const evaluated = candidates.length; // = 45 (C(10,2))

  // ── the WHERE clauses of the executed query ───────────────────────────────
  const passing = candidates
    .filter((c) => c.gatePassed && !c.blockedByRca)
    .sort((a, b) => b.score - a.score);

  const winner = passing[0];

  const surfaceFa = m.surface === "HARD" ? "هاردکورت" : m.surface === "CLAY" ? "خاک رس" : "چمن";
  const fired = rca.hits.filter((h) => h.fired);

  const decision: QqlDecision | null = winner
    ? {
        ok: true,
        pairCode: winner.pairCode,
        family: familyOfPair(winner.pairCode),
        familyLabelFa: QQL_FAMILIES[familyOfPair(winner.pairCode)].labelFa,
        oddsA: winner.oddsA,
        oddsB: winner.oddsB,
        stakeA: winner.stakeA,
        stakeB: winner.stakeB,
        probA: winner.probA,
        probB: winner.probB,
        unionProb: winner.unionProb,
        doubleWinProb: winner.doubleWinProb,
        verifiedWinRate: winner.verifiedWinRate,
        twinCount: winner.twinCount,
        effectiveOverlapOdds: winner.effectiveOverlapOdds,
        netReturnPct: Math.round((winner.effectiveOverlapOdds - 1) * 1000) / 10,
        evaluated,
        gatePassedCount: passing.length,
        topCandidates: passing.slice(0, 8),
        rca: rca.hits,
        queryFa: `💻 QQL EXECUTED — SELECT best pair FROM candidate_45_tennis_pairs (۴۵ ترکیب از ۱۰ آپشن ATP/WTA) LEFT JOIN tennis_historical_warehouse (تایم‌های ${surfaceFa} با |ΔHold−${(holdDiff * 100).toFixed(0)}%| ≤ ۸٪ و |ρ−${m.copula?.rhoSetCoupling.toFixed(2) ?? "0.00"}| ≤ ۰.۰۶) WHERE مجموع معکوس ضرایب ≤ ۰.۸۶۵ ∧ پوشش مونت‌کارلو ≥ ۸۹.۵٪ ∧ RCA = PASS ORDER BY verified_win_rate×۱۰۰ + برد دوبل×۸۰ + سود مؤثر×۱۴۰ DESC LIMIT 1 — ${passing.length} از ${evaluated} ترکیب فیلترها را عبور داد؛ برنده: [${winner.pairCode}]`,
        traceFa: `🔎 QQL Match Twin: در ${winner.twinCount > 0 ? `${winner.twinCount} مسابقه ${surfaceFa} مشابه با ΔHold=${(holdDiff * 100).toFixed(0)}%` : `شبیه‌سازی ۱۰٬۰۰۰ اجرایی همین بازی (${surfaceFa})`}، الگوی [${winner.pairCode.replace("T", "T").split("-").join(" ↔ ")}] دارای ${(winner.verifiedWinRate * 100).toFixed(1)}٪ وین‌ریت و ${(winner.doubleWinProb * 100).toFixed(0)}٪ برد دوبل همزمان بوده است`,
        traceEn: `QQL TWIN · ${winner.twinCount > 0 ? `${winner.twinCount} surface twins (ΔHold ${(holdDiff * 100).toFixed(0)}%)` : "10k in-match simulation"} · [${winner.pairCode.replace("-", " ↔ ")}] verified ${(winner.verifiedWinRate * 100).toFixed(1)}% · double-win ${(winner.doubleWinProb * 100).toFixed(0)}% · RCA ${fired.length ? fired.map((f) => f.code.replace("RCA_TENNIS_0", "R")).join("+") : "CLEAN"}`,
      }
    : null;

  return { decision, candidates };
}

// ─── 6 · slip builders — official single-button market text ─────────────────
export function slipOfOption(
  idx: number,
  odds: number,
  prob: number,
  favoriteName: string,
  dogName: string,
  side: "FAV" | "DOG" | "NEUTRAL"
): Slip {
  const spec = TENNIS_OPTION_POOL[idx];
  const fav = favoriteName;
  const dog = dogName;
  const favU = fav.toUpperCase();
  const dogU = dog.toUpperCase();
  switch (spec.code) {
    case "T1":
      return {
        leg: spec.leg,
        text: `نتیجه دقیق ست‌ها: برد ۲-۰ ${fav}`,
        textEn: `${favU} WINS 2-0`,
        odds, prob,
        marketEn: "SET BETTING — FAVORITE 2-0",
        marketFa: `نتیجه دقیق ست‌ها: برد ۲-۰ ${fav} (برد فاوریت در دو ست متوالی)`,
      };
    case "T2":
      return {
        leg: spec.leg,
        text: `نتیجه دقیق ست‌ها: برد ۲-۱ ${fav}`,
        textEn: `${favU} WINS 2-1`,
        odds, prob,
        marketEn: "SET BETTING — FAVORITE 2-1",
        marketFa: `نتیجه دقیق ست‌ها: برد ۲-۱ ${fav} (فاوریت در سه ست)`,
      };
    case "T3":
      return {
        leg: spec.leg,
        text: `نتیجه دقیق ست‌ها: برد ۲-۰ ${dog}`,
        textEn: `${dogU} WINS 2-0`,
        odds, prob,
        marketEn: "SET BETTING — PLAYER 2 WINS 2-0",
        marketFa: `نتیجه دقیق ست‌ها: برد ۲-۰ ${dog} (بازیکن دوم با شوک کامل)`,
      };
    case "T4":
      return {
        leg: spec.leg,
        text: `نتیجه دقیق ست‌ها: برد ۲-۱ ${dog}`,
        textEn: `${dogU} WINS 2-1`,
        odds, prob,
        marketEn: "SET BETTING — PLAYER 2 WINS 2-1",
        marketFa: `نتیجه دقیق ست‌ها: برد ۲-۱ ${dog} (بازیکن دوم در سه ست)`,
      };
    case "T5":
      return {
        leg: spec.leg,
        text: "مجموع ست‌های بازی: بالای ۲.۵ ست (رفتن بازی به ست سوم)",
        textEn: "OVER 2.5 SETS",
        odds, prob,
        marketEn: "TOTAL SETS — OVER 2.5 SETS",
        marketFa: "مجموع ست‌های مسابقه: بالای ۲.۵ ست (رفتن بازی به ست سوم)",
      };
    case "T6":
      return {
        leg: spec.leg,
        text: "مجموع گیم‌های بازی: بالای ۲۰.۵ گیم (بازی رقابتی‌تر از انتظار)",
        textEn: "TOTAL GAMES — OVER 20.5 GAMES",
        odds, prob,
        marketEn: "TOTAL GAMES — OVER 20.5 GAMES",
        marketFa: "مجموع گیم‌های مسابقه: بالای ۲۰.۵ گیم",
      };
    case "T7":
      return {
        leg: spec.leg,
        text: "مجموع گیم‌های بازی: زیر ۲۱.۵ گیم (دو ست کوتاه پیاپی)",
        textEn: "TOTAL GAMES — UNDER 21.5 GAMES",
        odds, prob,
        marketEn: "TOTAL GAMES — UNDER 21.5 GAMES",
        marketFa: "مجموع گیم‌های مسابقه: زیر ۲۱.۵ گیم",
      };
    case "T8":
      return {
        leg: spec.leg,
        text: `هندیکپ گیم فاوریت: برد ${fav} با اختلاف بیش از ۳.۵ گیم`,
        textEn: `${favU} −3.5 GAMES`,
        odds, prob,
        marketEn: "GAME HANDICAP — FAVORITE -3.5 GAMES",
        marketFa: `هندیکپ گیم فاوریت: ${fav} −۳.۵ گیم (برد با اختلاف ≥ ۴ گیم)`,
      };
    case "T9":
      return {
        leg: spec.leg,
        text: `هندیکپ گیم آندرداگ: ${dog} +۳.۵ گیم (پوشش در باخت نزدیک یا برد)`,
        textEn: `${dogU} +3.5 GAMES`,
        odds, prob,
        marketEn: "GAME HANDICAP — UNDERDOG +3.5 GAMES",
        marketFa: `هندیکپ گیم آندرداگ: ${dog} +۳.۵ گیم`,
      };
    case "T10":
      return {
        leg: spec.leg,
        text: `برد ست اول ${fav} یا تای‌بریک ست اول (بیش از ۹.۵ گیم ست اول)`,
        textEn: `${favU} WINS SET 1 & OVER 9.5 GAMES`,
        odds, prob,
        marketEn: "1ST SET WINNER — FAVORITE & OVER 9.5 GAMES",
        marketFa: `برد ست اول ${fav} همراه با بیش از ۹.۵ گیم در ست اول`,
      };
  }
}
