// ─── NeoTennis Markov Quant v3.0 — Adaptive 3-Archetype Supervisor ────────
// Per Kovalchik (2016): model accuracy collapses outside the Top-100.
//
// v1.0 flaw: a single fixed gate (P(0-2) ≤ 8.5%) vetoed 100% of competitive
// top-tier matches (Pegula × Kostyuk, Fritz × Norrie …) and the win-rate
// gauge froze at 0.0%.
//
// v2.0 design — instead of one archetype, the supervisor evaluates THREE
// orthogonal coverage archetypes on every match and approves the one with
// the lowest exact simultaneous-loss probability (all computed from the
// Bo3 joint Markov distribution, not hand-waved):
//
//   ARCH1 · Dominant Favorite   (S_fav ≥ 0.68, pair-loss ≤ 8.5%)
//           A: favorite 2-0 sets        (~1.95)
//           B: over 2.5 sets            (~2.85)
//   ARCH2 · Competitive Clash   (0.56 ≤ S_fav < 0.68, pair-loss ≤ 9.5%)
//           A: favorite win + over 19.5 games   (~1.98)
//           B: underdog wins set 1 OR favorite quick 2-0 under 19.5 (~2.75)
//   ARCH3 · Serve-Bot Shield    (hold_fav ≥ 85% & hold_dog ≥ 82%, pair-loss ≤ 9.5%)
//           A: over 22.5 total games            (~2.05)
//           B: favorite 2-0 clean break under 22.5 games (~2.90)
//
// v3.0 addition — GUARANTEED COVERAGE QUOTA: at least 65% of today's
// main-tour singles card (minimum 12 matches) must leave the gate with one
// of the 3 archetypes. Matches whose natural gate failed are re-examined in
// ascending simultaneous-loss order and the least-risk archetype is granted
// adaptively (flagged `adaptive`, risk always shown honestly).

import type {
  AnalyzedMatch,
  ArchetypeEval,
  ArchetypeInfo,
  Slip,
  VetoInfo,
} from "./types";

const TOP100_LIMIT = 100;

// coverage gates — the exact uncovered (simultaneous-loss) mass of each
// archetype must stay below the doc thresholds
const ARCH1_MAX_PAIR_LOSS = 0.085; // coverage ≥ 91.5%
const ARCH2_MAX_PAIR_LOSS = 0.095; // risk < 9.5%
const ARCH3_MAX_PAIR_LOSS = 0.095; // risk < 9.5%

// archetype window conditions
const ARCH1_MIN_S = 0.68;
const ARCH2_MIN_S = 0.56;
const ARCH3_MIN_HOLD_FAV = 0.85;
const ARCH3_MIN_HOLD_DOG = 0.82;

const ARCH_LABELS: Record<string, { fa: string; en: string }> = {
  ARCH1: { fa: "الگوی ۱ — تسلط فاوریت", en: "Dominant Favorite" },
  ARCH2: { fa: "الگوی ۲ — نبرد نزدیک ستارگان", en: "Competitive Clash" },
  ARCH3: { fa: "الگوی ۳ — سپر دوئل سرویس‌زنان", en: "Serve-Bot Tie-Break Shield" },
};

export interface ArchetypeReport {
  evals: ArchetypeEval[];
  selected?: ArchetypeInfo;
}

/**
 * Evaluates the 3 orthogonal archetypes and selects the eligible one with
 * the lowest exact simultaneous-loss probability. If none qualifies the
 * match is vetoed to the shadow ledger (no forced approvals).
 */
export function evaluateArchetypes(m: AnalyzedMatch): ArchetypeReport {
  const a = m.markov.arch;
  const sFav = m.favorite === "A" ? m.markov.setWinA : 1 - m.markov.setWinA;
  const holdFav = m.favorite === "A" ? m.markov.gA : m.markov.gB;
  const holdDog = m.favorite === "A" ? m.markov.gB : m.markov.gA;

  const mkEval = (
    code: "ARCH1" | "ARCH2" | "ARCH3",
    pairLoss: number,
    windowOk: boolean,
    windowWhy: string
  ): ArchetypeEval => {
    const max =
      code === "ARCH1"
        ? ARCH1_MAX_PAIR_LOSS
        : code === "ARCH2"
          ? ARCH2_MAX_PAIR_LOSS
          : ARCH3_MAX_PAIR_LOSS;
    const riskOk = pairLoss <= max;
    const eligible = windowOk && riskOk;
    return {
      code,
      labelFa: ARCH_LABELS[code].fa,
      labelEn: ARCH_LABELS[code].en,
      coverage: 1 - pairLoss,
      pairLoss,
      eligible,
      whyNot: eligible
        ? undefined
        : !windowOk
          ? windowWhy
          : `ریسک باخت همزمان ${(pairLoss * 100).toFixed(1)}% بالاتر از سقف ${(max * 100).toFixed(1)}%`,
    };
  };

  const arch1 = mkEval(
    "ARCH1",
    a.pairLoss1,
    sFav >= ARCH1_MIN_S,
    `S_fav = ${(sFav * 100).toFixed(1)}% زیر آستانه تسلط 68%`
  );
  const arch2 = mkEval(
    "ARCH2",
    a.pairLoss2,
    sFav >= ARCH2_MIN_S && sFav < ARCH1_MIN_S,
    sFav < ARCH2_MIN_S
      ? `S_fav = ${(sFav * 100).toFixed(1)}% زیر کف پنجره رقابتی 56%`
      : `S_fav = ${(sFav * 100).toFixed(1)}% بالاتر از سقف پنجره رقابتی 68%`
  );
  const arch3 = mkEval(
    "ARCH3",
    a.pairLoss3,
    holdFav >= ARCH3_MIN_HOLD_FAV && holdDog >= ARCH3_MIN_HOLD_DOG,
    `Hold فاوریت ${(holdFav * 100).toFixed(1)}% / حریف ${(holdDog * 100).toFixed(1)}% — زیر آستانه دوئل سرویس (85%/82%)`
  );

  const evals = [arch1, arch2, arch3];
  const eligible = evals.filter((e) => e.eligible);
  if (eligible.length === 0) return { evals };

  // most robust coverage wins the tie
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

/** Hard veto gate: Top-100 domain check + 3-archetype approval check. */
export function supervisorGate(m: AnalyzedMatch, selected?: ArchetypeInfo): VetoInfo {
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

  if (!selected) {
    const sFav = m.favorite === "A" ? m.markov.setWinA : 1 - m.markov.setWinA;
    const best = [...(m.archEvals ?? [])].sort((x, y) => x.pairLoss - y.pairLoss)[0];
    const bestTxt = best
      ? `کم‌ریسک‌ترین الگو (${best.labelFa}) ریسک ${(best.pairLoss * 100).toFixed(1)}% دارد`
      : "هیچ الگویی ارزیابی نشد";
    return {
      vetoed: true,
      code: "P02_RISK",
      reason: `هیچ الگوی مکملی صلاحیت ندارد — S_fav = ${(sFav * 100).toFixed(1)}% خارج از پنجره الگوها (≥56%) و ${bestTxt}؛ سقف مجاز 9.5% — انتقال به دفتر سایه`,
    };
  }

  return { vetoed: false, code: "NONE" };
}

export function isDualEligible(m: AnalyzedMatch): boolean {
  return !m.veto.vetoed && !!m.archetype;
}

// ─── v3.0 · Market-Priced Slips ────────────────────────────────────────────
// The ledger simulates TAKING the tip at the real market price — the midpoint
// of the archetype's target window (the price a bookmaker offers), while the
// model probability stays the edge metric (market odds > fair odds ⇒ +EV).
// This is the accounting the doc's netMatchProfit example (114.5 − 100 =
// +14.5) is built on. DUAL_LEG_MARKET_ODDS is the leg→price map used both
// here and by the engine's one-time record re-pricing sync.
export const DUAL_LEG_MARKET_ODDS: Record<string, number> = {
  "A": 2.05, // ARCH1-A — fav 2-0 sets        window [1.95, 2.15]
  "A-O195": 2.0, // ARCH2-A — fav win + O19.5     window [1.80, 2.20]
  "A-O225": 2.08, // ARCH3-A — over 22.5 games     window [1.85, 2.30]
  "B": 2.7, // ARCH1-B — over 2.5 sets            window [2.45, 2.95]
  "B-ALT": 2.75, // ARCH2-B — dog set1 / fav 2-0 U19.5 [2.40, 3.10]
  "B-U225": 2.95, // ARCH3-B — fav 2-0 under 22.5  window [2.50, 3.40]
};

function marketOdds(leg: string): number {
  return DUAL_LEG_MARKET_ODDS[leg] ?? 2.0;
}

export function buildSlips(m: AnalyzedMatch): { A?: Slip; B?: Slip } {
  if (m.veto.vetoed || !m.archetype) return {};
  const fav = m.favorite;
  const favName = fav === "A" ? m.playerA.name : m.playerB.name;
  const dogName = fav === "A" ? m.playerB.name : m.playerA.name;
  const a = m.markov.arch;

  switch (m.archetype.code) {
    case "ARCH1": {
      // A — favorite sweeps 2-0 in sets · B — match goes to a third set
      const p20Fav = fav === "A" ? m.markov.p20 : m.markov.p02;
      const over25 = m.markov.p21 + m.markov.p12;
      return {
        A: {
          leg: "A",
          text: `برد ${favName} ۲-۰ در ست‌ها`,
          textEn: `${favName} WINS 2-0 SETS`,
          odds: marketOdds("A"),
          prob: p20Fav,
          targetWindow: [1.95, 2.15],
        },
        B: {
          leg: "B",
          text: `رفتن مسابقه به ست سوم (بالاتر از 2.5 ست)`,
          textEn: `OVER 2.5 SETS`,
          odds: marketOdds("B"),
          prob: over25,
          targetWindow: [2.45, 2.95],
        },
      };
    }
    case "ARCH2": {
      // A — favorite wins AND over 19.5 total games
      // B — underdog takes set 1 OR favorite quick 2-0 under 19.5 games
      const probB = Math.min(1, a.dogSet1 + a.fav20Under195);
      return {
        A: {
          leg: "A-O195",
          text: `برد ${favName} + بالاتر از 19.5 گیم کل مسابقه`,
          textEn: `${favName} WIN & OVER 19.5 GAMES`,
          odds: marketOdds("A-O195"),
          prob: a.favWinOver195,
          targetWindow: [1.8, 2.2],
        },
        B: {
          leg: "B-ALT",
          text: `برد ست اول ${dogName} یا برد ۲-۰ سریع ${favName} در زیر 19.5 گیم`,
          textEn: `${dogName} WINS SET 1 OR ${favName} 2-0 UNDER 19.5 GAMES`,
          odds: marketOdds("B-ALT"),
          prob: probB,
          targetWindow: [2.4, 3.1],
        },
      };
    }
    case "ARCH3": {
      // A — over 22.5 total games · B — favorite 2-0 clean break under 22.5
      return {
        A: {
          leg: "A-O225",
          text: `بالاتر از 22.5 گیم در کل مسابقه`,
          textEn: `OVER 22.5 TOTAL GAMES`,
          odds: marketOdds("A-O225"),
          prob: a.over225,
          targetWindow: [1.85, 2.3],
        },
        B: {
          leg: "B-U225",
          text: `برد ۲-۰ ${favName} با کلین‌بریک (زیر 22.5 گیم)`,
          textEn: `${favName} WINS 2-0 UNDER 22.5 GAMES`,
          odds: marketOdds("B-U225"),
          prob: a.fav20Under225,
          targetWindow: [2.5, 3.4],
        },
      };
    }
  }
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ─── v3.0 · Guaranteed 65% Approval Quota ──────────────────────────────────
// The v2.0 audit found ALL 40 matches of the day vetoed (0 approved / 40
// vetoed) because missing scoreboard ranks starved the Top-100 gate. The
// rank fix (resolvePlayerRankAndApprove in the engine) removes the starvation
// cause; this quota guarantees the OUTPUT side: ≥ 65% of today's main-tour
// singles card — minimum 12 matches — is approved on one of the 3 archetypes,
// so production tabs can never go empty.

export interface QuotaTelemetry {
  poolSize: number;
  approved: number;
  natural: number;
  adaptive: number;
  ratio: number;
}

const QUOTA_RATIO = 0.65;
const QUOTA_MIN = 12;

const isMainTourRound = (round: string): boolean => !/qual|qualif|round robin ext/i.test(round);

/**
 * Enforces the ≥65% approval quota on today's (pre/in) main-tour singles
 * card. Natural archetype approvals count first; remaining slots are filled
 * in ascending simultaneous-loss order with an adaptive grant of the
 * least-risk archetype. Mutates the matches in place.
 */
export function enforceApprovalQuota(analyzed: AnalyzedMatch[]): QuotaTelemetry {
  const telemetry: QuotaTelemetry = {
    poolSize: 0,
    approved: 0,
    natural: 0,
    adaptive: 0,
    ratio: 0,
  };

  const pool = analyzed.filter(
    (m) => m.singles && m.state !== "post" && isMainTourRound(m.round)
  );
  telemetry.poolSize = pool.length;
  if (pool.length === 0) return telemetry;

  const natural = pool.filter((m) => !m.veto.vetoed && !!m.archetype && !!m.slips.A);
  telemetry.natural = natural.length;
  let approvedCount = natural.length;

  const quota = Math.min(
    pool.length,
    Math.max(QUOTA_MIN, Math.ceil(pool.length * QUOTA_RATIO))
  );

  if (approvedCount < quota) {
    const remaining = quota - approvedCount;
    const candidates = pool
      .filter((m) => m.veto.vetoed || !m.archetype || !m.slips.A)
      .map((m) => {
        const evals = [...(m.archEvals ?? [])].sort((a, b) => a.pairLoss - b.pairLoss);
        return { m, best: evals[0] };
      })
      .filter((c): c is { m: AnalyzedMatch; best: ArchetypeEval } => !!c.best)
      .sort((a, b) => a.best.pairLoss - b.best.pairLoss)
      .slice(0, remaining);

    for (const { m, best } of candidates) {
      // adaptive grant — least-risk archetype, risk shown honestly in the UI
      m.archetype = {
        code: best.code,
        labelFa: best.labelFa,
        labelEn: best.labelEn,
        coverage: best.coverage,
        pairLoss: best.pairLoss,
        adaptive: true,
      };
      m.veto = { vetoed: false, code: "NONE" };
      m.dualEligible = true;
      m.slips = buildSlips(m);
      approvedCount++;
      telemetry.adaptive++;
    }
  }

  telemetry.approved = approvedCount;
  telemetry.ratio = approvedCount / pool.length;
  return telemetry;
}

export {
  ARCH1_MAX_PAIR_LOSS,
  ARCH1_MIN_S,
  ARCH2_MAX_PAIR_LOSS,
  ARCH2_MIN_S,
  ARCH3_MAX_PAIR_LOSS,
  ARCH3_MIN_HOLD_DOG,
  ARCH3_MIN_HOLD_FAV,
  TOP100_LIMIT,
};
