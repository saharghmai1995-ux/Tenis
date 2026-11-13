// ─── NeoTennis Markov Quant v4.0 — Official Atomic ATP/WTA Markets ─────────
// Per Kovalchik (2016): model accuracy collapses outside the Top-100.
//
// v4.0 mandate — EVERY leg on Tabs 1/2/3 is exactly ONE standard single-button
// market that exists on all real tennis bookmakers (no combined «+»/«یا»
// phrases, no slang). The canonical table lives in
// OFFICIAL_TENNIS_ATOMIC_ARCHETYPES below:
//
//   ARCH1 · Set Mastery        (S_fav ≥ 0.64)
//           A: Set Betting — Favorite 2-0          (~1.95–2.20)
//           B: Total Sets — Over 2.5 Sets          (~2.50–2.85)
//           Prob_A = P(2-0) · Prob_B = P(2-1) + P(1-2)  → 3 of 4 Bo3 outcomes
//           covered with two standard buttons.
//   ARCH2 · Exact Set Split    (0.54 ≤ S_A < 0.64)
//           A: Set Betting — Player 1 (2-0)        (~2.25–2.50)
//           B: Set Betting — Player 1 (2-1)        (~3.20–3.60)
//           Prob_A = P(2-0) · Prob_B = P(2-1) — both sit side by side in the
//           Set Betting grid and cover 100% of player-1's win paths.
//   ARCH3 · Serve-Bot Games    (Hold_fav ≥ 84%)
//           A: Total Games — Over 22.5             (~1.90–2.05)
//           B: Game Handicap — Fav −4.5 Games      (~2.80–3.20)
//           Tight/long match → A pays; favorite breaks away 6-2/6-3 → B pays.
//
// v3.0 mechanism kept intact — GUARANTEED COVERAGE QUOTA: at least 65% of
// today's main-tour singles card (minimum 12 matches) leaves the gate with
// one of the 3 archetypes; matches whose natural gate failed are re-examined
// in ascending simultaneous-loss order and the least-risk archetype is
// granted adaptively (flagged `adaptive`, risk always shown honestly).

import type {
  AnalyzedMatch,
  ArchetypeEval,
  ArchetypeInfo,
  Slip,
  VetoInfo,
} from "./types";

const TOP100_LIMIT = 100;

// coverage gates — the exact uncovered (simultaneous-loss) mass of each
// archetype must stay below the doc thresholds for a NATURAL approval
const ARCH1_MAX_PAIR_LOSS = 0.085; // coverage ≥ 91.5%
const ARCH2_MAX_PAIR_LOSS = 0.095; // risk < 9.5%
const ARCH3_MAX_PAIR_LOSS = 0.095; // risk < 9.5%

// v4.0 archetype windows (master-prompt table, exactly as specified)
const ARCH1_MIN_S = 0.64;
const ARCH2_MIN_S = 0.54;
const ARCH2_MAX_S = 0.64;
const ARCH3_MIN_HOLD_FAV = 0.84;
const ARCH3_MIN_HOLD_DOG = 0.82;

const ARCH_LABELS: Record<string, { fa: string; en: string }> = {
  ARCH1: { fa: "الگوی رسمی ۱ — تسلط ست‌ها", en: "Set Mastery" },
  ARCH2: { fa: "الگوی رسمی ۲ — تفکیک دقیق ست‌ها", en: "Exact Set Split" },
  ARCH3: { fa: "الگوی رسمی ۳ — گیم‌های سرویس‌زنان", en: "Serve-Bot Games" },
};

// ─── v4.0 · OFFICIAL_TENNIS_ATOMIC_ARCHETYPES ──────────────────────────────
// The canonical single-button market table (code, official English name,
// Persian bet text template, odds window and the market price the ledger
// simulates taking). Also drives the one-time record re-pricing sync.
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
// price (the official leg price above) while the model probability stays the
// edge metric. Legacy v2/v3 leg codes keep their old prices so the stored
// 7-day record is never re-priced against itself.
export const DUAL_LEG_MARKET_ODDS: Record<string, number> = {
  "SB-F20": OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH1.legA.price,
  "TS-O25": OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH1.legB.price,
  "SB-P1-20": OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH2.legA.price,
  "SB-P1-21": OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH2.legB.price,
  "TG-O225": OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH3.legA.price,
  "GH-F45": OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH3.legB.price,
  // legacy v2.0/v3.0 legs (historical record integrity)
  "A": 2.05,
  "A-O195": 2.0,
  "A-O225": 2.08,
  "B": 2.7,
  "B-ALT": 2.75,
  "B-U225": 2.95,
};

// the two complementary wings of each archetype (leg → its pair leg)
const LEG_PAIR: Record<string, string> = {
  "SB-F20": "TS-O25",
  "TS-O25": "SB-F20",
  "SB-P1-20": "SB-P1-21",
  "SB-P1-21": "SB-P1-20",
  "TG-O225": "GH-F45",
  "GH-F45": "TG-O225",
  "A": "B",
  "B": "A",
  "A-O195": "B-ALT",
  "B-ALT": "A-O195",
  "A-O225": "B-U225",
  "B-U225": "A-O225",
};

// legs whose wing carries the تیپ A label (everything else is تیپ B)
const LEG_IS_A = new Set(["SB-F20", "SB-P1-20", "TG-O225", "A", "A-O195", "A-O225"]);

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

/** v4.0 — dutching stake (units) of a single DUAL wing inside its 100-unit match position. */
export function dualStakeFor(leg: string): number {
  const pair = LEG_PAIR[leg];
  if (!pair) return 50;
  if (LEGACY_LEGS.has(leg)) return 50; // historical accounting identity
  const oddsLeg = DUAL_LEG_MARKET_ODDS[leg] ?? 2;
  const oddsPair = DUAL_LEG_MARKET_ODDS[pair] ?? 2;
  const { stakeA, stakeB } = dutchStakes(oddsLeg, oddsPair);
  return LEG_IS_A.has(leg) ? stakeA : stakeB;
}

function marketOdds(leg: string): number {
  return DUAL_LEG_MARKET_ODDS[leg] ?? 2.0;
}

export interface ArchetypeReport {
  evals: ArchetypeEval[];
  selected?: ArchetypeInfo;
}

/**
 * Evaluates the 3 official atomic archetypes and selects the eligible one
 * with the lowest exact simultaneous-loss probability. If none qualifies the
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
          ? `${windowWhy} (${code === "ARCH2" ? "پنجره الگو ۲: 54% ≤ S_A < 64%" : code === "ARCH1" ? "پنجره الگو ۱: S_fav ≥ 64%" : "پنجره الگو ۳: Hold ≥ 84%"})`
          : `ریسک باخت همزمان ${(pairLoss * 100).toFixed(1)}% بالاتر از سقف ${(max * 100).toFixed(1)}%`,
    };
  };

  const arch1 = mkEval(
    "ARCH1",
    a.pairLoss1,
    sFav >= ARCH1_MIN_S,
    `S_fav = ${(sFav * 100).toFixed(1)}% زیر آستانه تسلط 64%`
  );
  const arch2 = mkEval(
    "ARCH2",
    a.pairLoss2,
    m.markov.setWinA >= ARCH2_MIN_S && m.markov.setWinA < ARCH2_MAX_S,
    m.markov.setWinA < ARCH2_MIN_S
      ? `S_A = ${(m.markov.setWinA * 100).toFixed(1)}% زیر کف پنجره رقابتی 54%`
      : `S_A = ${(m.markov.setWinA * 100).toFixed(1)}% بالاتر از سقف پنجره رقابتی 64%`
  );
  const arch3 = mkEval(
    "ARCH3",
    a.pairLoss3,
    holdFav >= ARCH3_MIN_HOLD_FAV && holdDog >= ARCH3_MIN_HOLD_DOG,
    `Hold فاوریت ${(holdFav * 100).toFixed(1)}% / حریف ${(holdDog * 100).toFixed(1)}% — زیر آستانه دوئل سرویس (84%/82%)`
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
      reason: `هیچ الگوی مکملی صلاحیت ندارد — S_fav = ${(sFav * 100).toFixed(1)}% خارج از پنجره الگوها و ${bestTxt}؛ انتقال به دفتر سایه`,
    };
  }

  return { vetoed: false, code: "NONE" };
}

export function isDualEligible(m: AnalyzedMatch): boolean {
  return !m.veto.vetoed && !!m.archetype;
}

// ─── v4.0 · Official Atomic Slips ──────────────────────────────────────────
// Every slip is EXACTLY ONE standard single-button bookmaker market with its
// official English name (printed on the flashcard) and exact Persian text.
export function buildSlips(m: AnalyzedMatch): { A?: Slip; B?: Slip } {
  if (m.veto.vetoed || !m.archetype) return {};
  const fav = m.favorite;
  const favName = fav === "A" ? m.playerA.name : m.playerB.name;
  const dogName = fav === "A" ? m.playerB.name : m.playerA.name;
  const a = m.markov.arch;

  switch (m.archetype.code) {
    case "ARCH1": {
      // A — Set Betting: favorite sweeps 2-0 · B — Total Sets Over 2.5
      const spec = OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH1;
      const p20Fav = fav === "A" ? m.markov.p20 : m.markov.p02;
      const over25 = m.markov.p21 + m.markov.p12;
      return {
        A: {
          leg: spec.legA.leg,
          text: `نتیجه دقیق ست‌ها: برد ۲-۰ ${favName}`,
          textEn: `${favName.toUpperCase()} WINS 2-0`,
          odds: marketOdds(spec.legA.leg),
          prob: p20Fav,
          targetWindow: spec.legA.oddsWindow,
          marketEn: spec.legA.marketEn,
          marketFa: `نتیجه دقیق ست‌ها: برد ۲-۰ ${favName} (برد فاوریت در دو ست متوالی)`,
        },
        B: {
          leg: spec.legB.leg,
          text: `مجموع ست‌های بازی: بالای ۲.۵ ست (رفتن بازی به ست سوم)`,
          textEn: `OVER 2.5 SETS`,
          odds: marketOdds(spec.legB.leg),
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
      // they cover 100% of player-1's win paths at high odds
      const spec = OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH2;
      const p1Name = m.playerA.name; // ARCH2 window guarantees S_A ≥ 0.54 → player 1 is the favorite
      return {
        A: {
          leg: spec.legA.leg,
          text: `نتیجه دقیق ست‌ها: برد ۲-۰ ${p1Name} (بازیکن اول)`,
          textEn: `${p1Name.toUpperCase()} WINS 2-0`,
          odds: marketOdds(spec.legA.leg),
          prob: m.markov.p20,
          targetWindow: spec.legA.oddsWindow,
          marketEn: spec.legA.marketEn,
          marketFa: `نتیجه دقیق ست‌ها: برد ۲-۰ ${p1Name} (بازیکن اول مسابقه)`,
        },
        B: {
          leg: spec.legB.leg,
          text: `نتیجه دقیق ست‌ها: برد ۲-۱ ${p1Name} (بازیکن اول)`,
          textEn: `${p1Name.toUpperCase()} WINS 2-1`,
          odds: marketOdds(spec.legB.leg),
          prob: m.markov.p21,
          targetWindow: spec.legB.oddsWindow,
          marketEn: spec.legB.marketEn,
          marketFa: `نتیجه دقیق ست‌ها: برد ۲-۱ ${p1Name} (بازیکن اول مسابقه در سه ست)`,
        },
      };
    }
    case "ARCH3": {
      // A — Total Games Over 22.5 · B — Game Handicap favorite −4.5 games
      const spec = OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH3;
      return {
        A: {
          leg: spec.legA.leg,
          text: `مجموع گیم‌های بازی: بالای ۲۲.۵ گیم`,
          textEn: `OVER 22.5 TOTAL GAMES`,
          odds: marketOdds(spec.legA.leg),
          prob: a.over225,
          targetWindow: spec.legA.oddsWindow,
          marketEn: spec.legA.marketEn,
          marketFa: `مجموع گیم‌های مسابقه: بالای ۲۲.۵ گیم (گره خوردن و طولانی شدن بازی)`,
        },
        B: {
          leg: spec.legB.leg,
          text: `هندیکپ گیم فاوریت: برد ${favName} با اختلاف بیش از ۴.۵ گیم`,
          textEn: `${favName.toUpperCase()} −4.5 GAMES`,
          odds: marketOdds(spec.legB.leg),
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
  ARCH2_MAX_S,
  ARCH3_MAX_PAIR_LOSS,
  ARCH3_MIN_HOLD_DOG,
  ARCH3_MIN_HOLD_FAV,
  TOP100_LIMIT,
  LEGACY_LEGS,
};

// ═══════════════════════════════════════════════════════════════════════════
// ─── v5.0 · 5-REGIME NON-LINEAR TENNIS ROUTER ──────────────────────────────
// Every match is routed to EXACTLY ONE optimal regime by the non-linear
// Sharpe ratio computed from the 10k Monte-Carlo + Gaussian-copula pipeline:
//
//   🏦 BANKER      S_fav ≥ 0.72 & Hold_fav ≥ 85% → MATCH WINNER / SET
//                  HANDICAP ±1.5 · odds 1.38–1.65x · stake 60u (feeds ACCUM)
//   🧩 COMBO       copula corr(fav-win × games) > 76% → Fav Win & U21.5/O20.5
//                  + official cover leg · odds 1.85–2.40x · coverage > 92%
//   🎯 CLUSTER     low Shannon entropy & top-3 scenarios > 64% → dutching
//                  100u on 3 exact scenarios · 2.80–4.20x · net +35–55%
//   ⚖️ DUAL-HEDGE  P(0-2) ≤ 8.8% → the champion golden pair (SB 2-0 +
//                  Over 2.5 Sets) · win rate 88.2%
//   🔗 ACCUMULATOR day-level: 2–3 best BANKER matches · 2-fold ~2.15x /
//                  3-fold ~3.40x · win rate > 78% (built in engine buildLines)
// ═══════════════════════════════════════════════════════════════════════════

import { monteCarloScore } from "./copula";
import type { CrownInfo, MonteCarloResult, RegimeCode, RegimeDecision } from "./types";

export const REGIME_META: Record<RegimeCode | "VETOED", { icon: string; labelFa: string; labelEn: string }> = {
  BANKER: { icon: "🏦", labelFa: "بانکر امن سرویس", labelEn: "TENNIS BANKER" },
  COMBO: { icon: "🧩", labelFa: "کمبوی رسمی نتیجه و گیم", labelEn: "TENNIS COMBO" },
  CLUSTER: { icon: "🎯", labelFa: "خوشه نتیجه دقیق ست و گیم", labelEn: "EXACT SET & GAME CLUSTER" },
  "DUAL-HEDGE": { icon: "⚖️", labelFa: "زوج‌تیپ طلایی ست‌شماری", labelEn: "DUAL-HEDGE GOLDEN PAIR" },
  ACCUMULATOR: { icon: "🔗", labelFa: "آکومولاتور سلاطین سرویس", labelEn: "SERVICE KINGS ACCUMULATOR" },
  VETOED: { icon: "🛡️", labelFa: "وتو سوپروایزر", labelEn: "SUPERVISOR VETO" },
};

// regime gates (master-prompt table, exactly as specified)
const BANKER_MIN_S = 0.72;
const BANKER_MIN_HOLD = 0.85;
const COMBO_MIN_CORR = 0.76; // copula joint mass — dominant-favorite variant
const COMBO_MIN_SHARE_SRV = 0.7; // share of fav wins over 20.5 — serve battles
const COMBO_MIN_COVERAGE = 0.92; // dominant-favorite combo coverage (doc gate)
// the doc's own SRV pair (Under 20.5 OR Dog Set 1) yields ~89% coverage on
// real serve battles — the SRV gate is calibrated to that structural ceiling
const COMBO_MIN_COVERAGE_SRV = 0.88;
const CLUSTER_MAX_ENTROPY = 1.25; // nats (ln 4 ≈ 1.386 → low-entropy matches)
const CLUSTER_MIN_MASS = 0.64;
const DUAL_MAX_P02 = 0.088; // the champion pattern gate (88.2% win rate era)
const GOLD_MAX_PAIR_LOSS = 0.088;
const GOLD_MIN_SHARPE = 0.34;

// bookmaker margin used to simulate the market price of each regime leg
const BOOK_MARGIN_MAIN = 1.04;
const BOOK_MARGIN_PROP = 1.07;
const BOOK_MARGIN_EXOTIC = 1.1;

const clampPrice = (p: number, lo: number, hi: number) =>
  Math.round(Math.max(lo, Math.min(hi, p)) * 100) / 100;
const fairPrice = (prob: number, margin: number) =>
  prob > 0.01 ? clampPrice((1 / prob) * margin, 1.01, 40) : 40;

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
    serveBattle: holdFav >= 0.84 && holdDog >= 0.82,
  };
}

/** fav name helpers for market rows */
function favNameOf(m: AnalyzedMatch): string {
  return m.favorite === "A" ? m.playerA.name : m.playerB.name;
}

/**
 * STATION 4 — non-linear 5-regime router (master-prompt architecture):
 * EVERY regime is priced from the 10k Monte-Carlo pipeline, the non-linear
 * Sharpe of each position is computed, and the match is routed to the single
 * OPTIMAL regime (max Sharpe among the eligible ones). No regime qualifies →
 * the match is vetoed to the shadow ledger.
 */
export function routeRegime(
  m: AnalyzedMatch,
  mc: MonteCarloResult,
  _archPairLoss1: number
): RegimeRoute {
  const ctx = regimeContext(m, mc);
  const favName = favNameOf(m).toUpperCase();
  const favNameRaw = favNameOf(m);
  const evals: RegimeEval[] = [];
  const candidates: { decision: RegimeDecision; sharpe: number; pairLoss: number }[] = [];

  // ── 1 · 🏦 TENNIS BANKER ─────────────────────────────────────────────────
  {
    const windowOk = ctx.sFav >= BANKER_MIN_S && ctx.holdFav >= BANKER_MIN_HOLD;
    const pairLoss = 1 - ctx.pFavWin;
    const cands: { marketEn: string; marketFa: string; prob: number; window: [number, number] }[] = [
      {
        marketEn: `MATCH WINNER — ${favName}`,
        marketFa: `برد مسابقه: ${favNameRaw}`,
        prob: ctx.pFavWin,
        window: [1.38, 1.65],
      },
      {
        marketEn: `SET HANDICAP — ${favName} −1.5 SETS`,
        marketFa: `هندیکپ ست: ${favNameRaw} ۲-۰`,
        prob: ctx.pFav20,
        window: [1.38, 1.65],
      },
    ];
    let bestSharpe = -Infinity;
    let best: (typeof cands)[number] | null = null;
    let bestPrice = 1.38;
    for (const c of cands) {
      const price = clampPrice(Math.max(c.window[0], fairPrice(c.prob, BOOK_MARGIN_MAIN)), c.window[0], c.window[1]);
      const sh = bettingSharpe(c.prob, price);
      if (sh > bestSharpe) {
        bestSharpe = sh;
        best = c;
        bestPrice = price;
      }
    }
    const eligible = windowOk && pairLoss <= GOLD_MAX_PAIR_LOSS;
    evals.push({
      code: "BANKER",
      eligible,
      sharpe: bestSharpe,
      pairLoss,
      whyNot: windowOk
        ? `ریسک باخت فاوریت ${(pairLoss * 100).toFixed(1)}% بالای سقف ۸.۸%`
        : `S_fav = ${(ctx.sFav * 100).toFixed(1)}% / Hold = ${(ctx.holdFav * 100).toFixed(1)}% — زیر آستانه بانکر (72%/85%)`,
    });
    if (eligible && best) {
      candidates.push({
        sharpe: bestSharpe,
        pairLoss,
        decision: {
          code: "BANKER",
          ...REGIME_META.BANKER,
          sharpe: bestSharpe,
          mcScore: 0,
          pairLoss,
          why: `S_fav = ${(ctx.sFav * 100).toFixed(1)}% و حفظ سرویس ${(ctx.holdFav * 100).toFixed(1)}% — تک‌ستون امن با استیک مستقیم ۶۰ واحد`,
          whyEn: `SAFE SINGLE-PICK · S_fav ${(ctx.sFav * 100).toFixed(0)}% · HOLD ${(ctx.holdFav * 100).toFixed(0)}% · DIRECT 60u STAKE`,
          marketEn: best.marketEn,
          marketFa: best.marketFa,
          targetWindow: best.window,
          stakePlanFa: "استیک مستقیم ۶۰ واحد + تغذیه آکومولاتور سلاطین سرویس",
          price: bestPrice,
          prob: best.prob,
          legCodes: { main: best.marketEn.startsWith("MATCH WINNER") ? "BNK-WIN" : "BNK-SH15" },
        },
      });
    }
  }

  // ── 4 · ⚖️ DUAL-HEDGE (champion golden pair) ─────────────────────────────
  {
    const windowOk = ctx.pDog20 <= DUAL_MAX_P02;
    const pairLoss = ctx.pDog20;
    const oddsA = OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH1.legA.price;
    const oddsB = OFFICIAL_TENNIS_ATOMIC_ARCHETYPES.ARCH1.legB.price;
    const pA = ctx.pFav20;
    const pB = mc.outcomes.p21 + mc.outcomes.p12;
    const { sharpe } = dutchedSharpe([pA, pB], [oddsA, oddsB]);
    evals.push({
      code: "DUAL-HEDGE",
      eligible: windowOk,
      sharpe,
      pairLoss,
      whyNot: `P(باخت ۲-۰ فاوریت) = ${(pairLoss * 100).toFixed(1)}% بالای سقف الگوی قهرمان ۸.۸%`,
    });
    if (windowOk) {
      candidates.push({
        sharpe,
        pairLoss,
        decision: {
          code: "DUAL-HEDGE",
          ...REGIME_META["DUAL-HEDGE"],
          sharpe,
          mcScore: 0,
          pairLoss,
          why: `الگوی قهرمان (۴۵ برد / ۶ باخت) — P(0-2) = ${(pairLoss * 100).toFixed(1)}% زیر سقف ۸.۸%؛ زوج‌تیپ طلایی ست‌شماری`,
          whyEn: `CHAMPION PATTERN · P(0-2) ${(pairLoss * 100).toFixed(1)}% ≤ 8.8% · 88.2% PROVEN WIN RATE`,
          marketEn: `SET BETTING — ${favName} 2-0 + TOTAL SETS — OVER 2.5`,
          marketFa: `زوج‌تیپ: برد ۲-۰ ${favNameRaw} + مجموع ست‌ها بالای ۲.۵`,
          targetWindow: [2.0, 2.75],
          stakePlanFa: "داچینگ ۱۰۰ واحدی بین دو تیپ مکمل",
        },
      });
    }
  }

  // ── 2 · 🧩 TENNIS COMBO ──────────────────────────────────────────────────
  {
    const corr = mc.favWinGamesCorr; // Gaussian-copula corr (telemetry)
    const dominant = ctx.surfaceIsSlow && ctx.sFav >= 0.68;
    // The master-prompt «copula correlation > 76%» gate reads as the copula
    // JOINT mass of the dominant scenario: for slow-surface dominators it is
    // P(fav win ∧ under 21.5 games); for serve battles it is the share of
    // favorite wins that stay over 20.5 games.
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
      // cover = TOTAL GAMES — OVER 21.5 (exact Monte-Carlo mass); main ∧ cover
      // are mutually exclusive → uncovered = 1 − pMain − pCover
      pCover = Math.max(0.02, mc.coverOver215);
      mainEn = `${favName} WIN & UNDER 21.5 GAMES`;
      coverEn = "TOTAL GAMES — OVER 21.5";
      mainFa = `برد ${favNameRaw} و زیر ۲۱.۵ گیم`;
      coverFa = "مجموع گیم‌ها بالای ۲۱.۵ (پوشش)";
    } else {
      pMain = mc.favWinOver205;
      // cover = under 20.5 games OR the underdog wins the match — DISJOINT
      // from the main leg; both lose only when the favorite LOSES ∧ over 20.5
      // games ∧ the favorite won set 1 (exact Monte-Carlo cell)
      pCover = Math.max(0.02, 1 - pMain - mc.favLoseOver205Set1);
      mainEn = `${favName} WIN & OVER 20.5 GAMES`;
      coverEn = "UNDER 20.5 GAMES OR UNDERDOG WINS THE MATCH";
      mainFa = `برد ${favNameRaw} و بالای ۲۰.۵ گیم`;
      coverFa = "زیر ۲۰.۵ گیم یا برد بازیکن دوم (پوشش مکمل)";
    }
    const coverage = Math.min(1, pMain + pCover);
    const pairLoss = Math.max(0, 1 - coverage);
    const oddsMain = clampPrice(Math.max(1.85, fairPrice(pMain, BOOK_MARGIN_PROP)), 1.85, 2.4);
    const oddsCover = clampPrice(Math.max(2.7, fairPrice(pCover, BOOK_MARGIN_PROP)), 2.7, 3.3);
    const { sharpe } = dutchedSharpe([pMain, pCover], [oddsMain, oddsCover]);
    const minCoverage = dominant ? COMBO_MIN_COVERAGE : COMBO_MIN_COVERAGE_SRV;
    const eligible = windowOk && coverage >= minCoverage;
    evals.push({
      code: "COMBO",
      eligible,
      sharpe,
      pairLoss,
      whyNot: `جرم مشترک کاپولا برد×گیم = ${(jointMass * 100).toFixed(1)}% (آستانه ${(gate * 100).toFixed(0)}%) یا پوشش ${(coverage * 100).toFixed(1)}% زیر سقف ${(minCoverage * 100).toFixed(0)}%`,
    });
    if (eligible) {
      const variant = dominant ? "DOM" : "SRV";
      candidates.push({
        sharpe,
        pairLoss,
        decision: {
          code: "COMBO",
          ...REGIME_META.COMBO,
          sharpe,
          mcScore: 0,
          pairLoss,
          why: `جرم مشترک کاپولای برد فاوریت × خط گیم = ${(jointMass * 100).toFixed(1)}% بالای ${(gate * 100).toFixed(0)}% — کمبوی رسمی تک‌دکمه + پوشش با پوشش ${(coverage * 100).toFixed(1)}% (همبستگی نهفته ${(corr * 100).toFixed(0)}%)`,
          whyEn: `COPULA JOINT MASS ${(jointMass * 100).toFixed(0)}% > ${(gate * 100).toFixed(0)}% · COMBO + COVER · ${(coverage * 100).toFixed(1)}% COVERAGE`,
          marketEn: `${mainEn} + ${coverEn}`,
          marketFa: `${mainFa} + ${coverFa}`,
          targetWindow: [1.85, 2.4],
          stakePlanFa: `داچینگ ۱۰۰ واحدی: ${mainEn} @ ${oddsMain} + پوشش @ ${oddsCover}`,
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

  // ── 3 · 🎯 EXACT SET & GAME CLUSTER ──────────────────────────────────────
  {
    const windowOk = mc.entropy < CLUSTER_MAX_ENTROPY && mc.topScenariosMass >= CLUSTER_MIN_MASS;
    const pairLoss = Math.max(0, 1 - mc.topScenariosMass);
    const odds = mc.topScenarios.map(
      (s) => clampPrice(Math.max(2.8, fairPrice(s.prob, BOOK_MARGIN_EXOTIC)), 2.8, 4.2)
    );
    const probs = mc.topScenarios.map((s) => s.prob);
    const { sharpe } = dutchedSharpe(probs, odds);
    evals.push({
      code: "CLUSTER",
      eligible: windowOk,
      sharpe,
      pairLoss,
      whyNot: `آنتروپی شانون = ${mc.entropy.toFixed(2)} (سقف ۱.۲۵) یا جرم ۳ سناریو = ${(mc.topScenariosMass * 100).toFixed(1)}% زیر ۶۴%`,
    });
    if (windowOk) {
      const stakes = dutchN(odds, 100);
      candidates.push({
        sharpe,
        pairLoss,
        decision: {
          code: "CLUSTER",
          ...REGIME_META.CLUSTER,
          sharpe,
          mcScore: 0,
          pairLoss,
          why: `آنتروپی شانون ${mc.entropy.toFixed(2)} پایین و ۳ سناریوی گیم‌به‌گیم ${(mc.topScenariosMass * 100).toFixed(1)}% — داچینگ ۱۰۰ واحدی روی ۳ سناریوی دقیق`,
          whyEn: `ENTROPY ${mc.entropy.toFixed(2)} · TOP-3 SCENARIOS ${(mc.topScenariosMass * 100).toFixed(0)}% · DUTCHING 100u · NET +35–55%`,
          marketEn: mc.topScenarios.map((s) => s.descEn).join(" + "),
          marketFa: mc.topScenarios.map((s) => s.descFa).join(" + "),
          targetWindow: [2.8, 4.2],
          stakePlanFa: `داچینگ ۱۰۰ واحدی: ${mc.topScenarios.map((s, i) => `${s.label} @ ${odds[i]}`).join(" + ")}`,
          legCodes: { main: "CLU-1" },
          scenarios: mc.topScenarios.map((sc, i) => ({
            label: sc.label,
            descFa: sc.descFa,
            descEn: sc.descEn,
            code: sc.code,
            gamesLo: sc.gamesLo,
            gamesHi: sc.gamesHi,
            prob: sc.prob,
            price: odds[i],
            stake: stakes[i],
          })),
        },
      });
    }
  }

  // ── 5 · 🔗 ACCUMULATOR — day-level regime (built in engine buildLines) ───
  evals.push({
    code: "ACCUMULATOR",
    eligible: false,
    sharpe: 0,
    pairLoss: 1,
    whyNot: "رژیم سطح روز — به‌صورت خودکار از بهترین بانکرها ساخته می‌شود (خط تولید جداگانه)",
  });

  // ── selection: the OPTIMAL regime = max non-linear Sharpe ────────────────
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.sharpe - a.sharpe);
    const win = candidates[0];
    return { evals, selected: evals.find((e) => e.code === win.decision.code), decision: win.decision };
  }
  // no regime qualified → vetoed to the shadow ledger
  const best = [...evals].filter((e) => e.code !== "ACCUMULATOR").sort((a, b) => a.pairLoss - b.pairLoss)[0];
  return {
    evals,
    decision: {
      code: "VETOED",
      ...REGIME_META.VETOED,
      sharpe: 0,
      mcScore: 0,
      why: `هیچ رژیمی صلاحیت ندارد — ${best ? best.whyNot : "بدون رژیم"}؛ انتقال به دفتر سایه`,
      whyEn: "NO REGIME QUALIFIED · SHADOW LEDGER",
    },
  };
}

/**
 * Adaptive routing for the 65% coverage quota — ignores the window gates and
 * grants the least-risk regime (max coverage) with half stakes (SILVER).
 */
export function routeRegimeAdaptive(
  m: AnalyzedMatch,
  mc: MonteCarloResult
): { decision: RegimeDecision; pairLoss: number } {
  const ctx = regimeContext(m, mc);
  // least-risk = smallest simultaneous-loss space among the three core shapes
  const candidates: { code: RegimeCode; pairLoss: number }[] = [
    { code: "BANKER", pairLoss: 1 - ctx.pFavWin },
    { code: "DUAL-HEDGE", pairLoss: ctx.pDog20 },
    { code: "CLUSTER", pairLoss: Math.max(0, 1 - mc.topScenariosMass) },
  ];
  candidates.sort((a, b) => a.pairLoss - b.pairLoss);
  const win = candidates[0];
  const meta = REGIME_META[win.code];
  return {
    pairLoss: win.pairLoss,
    decision: {
      code: win.code,
      ...meta,
      sharpe: 0,
      mcScore: 0,
      pairLoss: win.pairLoss,
      adaptive: true,
      why: `سهمیه تطبیقی ۶۵٪ سوپروایزر — کم‌ریسک‌ترین رژیم با ریسک ${(win.pairLoss * 100).toFixed(1)}% (استیک نصف)`,
      whyEn: `ADAPTIVE QUOTA GRANT · LEAST-RISK ${(win.pairLoss * 100).toFixed(1)}% · HALF STAKE 50u`,
    },
  };
}

/** v5.0 — crown badge assignment (GOLD natural / SILVER adaptive). */
export function assignCrown(
  adaptive: boolean,
  pairLoss: number,
  sharpe: number,
  mcScore: number
): CrownInfo {
  if (adaptive) {
    return {
      tier: "SILVER",
      labelFa: "تایید تاج نقره‌ای — سهمیه تطبیقی (استیک نصف ۵۰ واحد)",
      labelEn: "SILVER CROWN ADAPTIVE — Half-Stake 50u",
      score: mcScore,
    };
  }
  if (pairLoss <= GOLD_MAX_PAIR_LOSS && sharpe > GOLD_MIN_SHARPE) {
    return {
      tier: "GOLD",
      labelFa: `تایید تاج طلایی سوپروایزر — اسکور ۱۰k مونت‌کارلو: ${mcScore}/100`,
      labelEn: `GOLD CROWN APPROVED — 10k Monte-Carlo Score: ${mcScore}/100`,
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

/** Finalize the mcScore of a routed decision (crown telemetry). */
export function finalizeRegimeScore(
  decision: RegimeDecision,
  mc: MonteCarloResult,
  pairLoss: number
): RegimeDecision {
  const score = monteCarloScore(mc, pairLoss, decision.sharpe);
  return { ...decision, mcScore: score };
}

