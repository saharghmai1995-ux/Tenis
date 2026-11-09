// ─── NeoTennis Markov Quant — Tennis Supervisor Agent (Hard Veto Gate) ─────
// Per Kovalchik (2016): model accuracy collapses outside the Top-100.
// Veto rule 1: Top-100 & Main-Draw gate
// Veto rule 2: heavy straight-sets favorite collapse P_0_2 > 8.5%
// Golden gate: dual-hedge only when the favorite holds ≥ 80%

import type { AnalyzedMatch, Slip, VetoInfo } from "./types";

const TOP100_LIMIT = 100;
const P02_RISK_THRESHOLD = 0.085;
const DUAL_HOLD_THRESHOLD = 0.80;
const CLOSE_MATCH_FAV_THRESHOLD = 0.68;

export function supervisorGate(m: AnalyzedMatch): VetoInfo {
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
  if (m.markov.p02 > P02_RISK_THRESHOLD) {
    return {
      vetoed: true,
      code: "P02_RISK",
      reason: `ریسک شکست سنگین ۰-۲ فاوریت = ${(m.markov.p02 * 100).toFixed(1)}% بالاتر از سقف 8.5% — انتقال به دفتر سایه`,
    };
  }
  return { vetoed: false, code: "NONE" };
}

export function isDualEligible(m: AnalyzedMatch): boolean {
  if (m.veto.vetoed) return false;
  const favHold = m.favorite === "A" ? m.markov.gA : m.markov.gB;
  return favHold >= DUAL_HOLD_THRESHOLD;
}

export function buildSlips(m: AnalyzedMatch): { A?: Slip; B?: Slip } {
  if (m.veto.vetoed) return {};
  const fav = m.favorite;
  const favWin = m.favWinProb;
  const favName = fav === "A" ? m.playerA.name : m.playerB.name;
  const dogName = fav === "A" ? m.playerB.name : m.playerA.name;

  // Slip A — favorite wins 2-0 straight sets
  const p20Fav = fav === "A" ? m.markov.p20 : m.markov.p02;
  const A: Slip | undefined =
    p20Fav > 0.03
      ? {
          leg: "A",
          text: `برد ${favName} ۲-۰ در ست‌ها`,
          textEn: `${favName} WINS 2-0 SETS`,
          odds: round2(1 / p20Fav),
          prob: p20Fav,
          targetWindow: [1.95, 2.15],
        }
      : undefined;

  // Slip B — orthogonal coverage of BOTH 2-1 and 1-2
  const over25 = m.markov.p21 + m.markov.p12;
  let B: Slip | undefined;
  if (favWin >= CLOSE_MATCH_FAV_THRESHOLD) {
    B = {
      leg: "B",
      text: `رفتن مسابقه به ست سوم (بالاتر از 2.5 ست)`,
      textEn: `OVER 2.5 SETS`,
      odds: round2(1 / Math.max(over25, 0.01)),
      prob: over25,
      targetWindow: [2.45, 2.95],
    };
  } else {
    // close match → combined hedge: +1.5 sets underdog AND over 20.5 games
    B = {
      leg: "B",
      text: `+1.5 ست ${dogName} + بالاتر از 20.5 گیم`,
      textEn: `${dogName} +1.5 SETS & OVER 20.5 GAMES`,
      odds: round2(1 / Math.max(m.markov.slipBCombined, 0.01)),
      prob: m.markov.slipBCombined,
    };
  }
  return { A, B };
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export { CLOSE_MATCH_FAV_THRESHOLD, DUAL_HOLD_THRESHOLD, P02_RISK_THRESHOLD, TOP100_LIMIT };
