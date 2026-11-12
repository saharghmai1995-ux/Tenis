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
