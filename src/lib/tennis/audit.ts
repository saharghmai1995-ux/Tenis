// ─── NEOBET Audit v14 · Forensic Audit & Backtest Engine ────────────────────
// Answers, with hard numbers from the real ledger:
//   1. «آیا عملکرد روزهای گذشته قابل راستی‌آزمایی است؟»  → verifiability block
//   2. Card odds vs real market (BetForward / 1xBet)                      → reality block
//   3. Tip selection: odds-driven or probability-driven?                  → selection block
//   4. «اگر فقط روی تیپ A ورود می‌شد بازدهی چطور بود؟»                    → backtest block
//   5. Performance coverage of every flashcard category                   → categories block
//
// Everything is computed from immutable-as-recorded rows. No row is rewritten.

import { db } from "@/lib/db";
import { canonicalMatchString, sha256 } from "./hash";
import { realityReport, lastFeedHealth, type RealityRow } from "./reality";

// ── time normalization: the ledger stores mixed epoch seconds/ms — tolerate both
function normEpoch(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (v > 1e12) return v; // ms
  if (v > 1e9) return v * 1000; // s
  return null;
}
const TEHRAN_TZ = "Asia/Tehran";
function dayInTehran(epochMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TEHRAN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
}

interface PickRow {
  id: string;
  line: string;
  leg: string;
  desc: string;
  odds: number;
  prob: number;
  stake: number;
  status: string;
  profit: number | null;
  oddsSource: string;
  createdAt: Date;
  settledAt: Date | null;
  match: {
    eventKey: string;
    playerA: string;
    playerB: string;
    tour: string;
    surface: string;
    crownTier: string | null;
    historyVersion: number;
    marketProbA: number | null;
    slipAOdds: number | null;
    slipBOdds: number | null;
  } | null;
}

function legFamily(leg: string): string {
  if (/^(A|B)(-|$)/.test(leg)) return "MATCH WINNER (DUAL WING)";
  if (leg.startsWith("A-") || leg.startsWith("B-")) return "MATCH WINNER (DUAL WING)";
  if (leg.startsWith("SB") || leg.includes("SB-")) return "SET BETTING";
  if (leg.startsWith("TG")) return "TOTAL GAMES";
  if (leg.startsWith("TS")) return "TOTAL SETS";
  if (leg.startsWith("GH")) return "GAME HANDICAP";
  if (leg.startsWith("RC")) return "REG COMBO";
  if (leg.startsWith("SNIPER")) return "SNIPER";
  if (leg.startsWith("T") && /T\d+-/.test(leg)) return "QQL COMBO FAMILY";
  return "OTHER";
}

function isTipA(leg: string): boolean {
  return leg === "A" || leg.startsWith("A-");
}
function isTipB(leg: string): boolean {
  return leg === "B" || leg.startsWith("B-");
}

interface SliceStat {
  n: number;
  won: number;
  lost: number;
  pending: number;
  staked: number;
  profit: number;
  roiPct: number;
  winRatePct: number;
}

function emptySlice(): SliceStat {
  return { n: 0, won: 0, lost: 0, pending: 0, staked: 0, profit: 0, roiPct: 0, winRatePct: 0 };
}

function addPick(s: SliceStat, p: PickRow) {
  s.n++;
  if (p.status === "PENDING") {
    s.pending++;
    s.staked += p.stake;
    return;
  }
  s.staked += p.stake;
  s.profit += p.profit ?? 0;
  if (p.status === "WON") s.won++;
  if (p.status === "LOST") s.lost++;
}
function finalize(s: SliceStat): SliceStat {
  const decided = s.won + s.lost;
  s.profit = Math.round(s.profit * 100) / 100;
  s.staked = Math.round(s.staked * 100) / 100;
  s.roiPct = s.staked > 0 ? Math.round((100 * s.profit) / s.staked * 10) / 10 : 0;
  s.winRatePct = decided > 0 ? Math.round((100 * s.won) / decided * 10) / 10 : 0;
  return s;
}

// ── Verifiability ────────────────────────────────────────────────────────────
export async function verifiability() {
  const matches = await db.tennisMatch.findMany({
    select: {
      eventKey: true,
      dateKey: true,
      tour: true,
      tournament: true,
      surface: true,
      round: true,
      playerA: true,
      playerB: true,
      slipAText: true,
      slipAOdds: true,
      slipBText: true,
      slipBOdds: true,
      hashPre: true,
      historyVersion: true,
      marketProbA: true,
      settled: true,
      vetoed: true,
    },
  });

  let pass = 0;
  let fail = 0;
  const failSamples: Array<{ eventKey: string; players: string; historyVersion: number }> = [];
  for (const m of matches) {
    if (!m.hashPre) continue;
    const canon = canonicalMatchString({
      dateKey: m.dateKey,
      tour: m.tour,
      tournament: m.tournament,
      surface: m.surface,
      round: m.round,
      playerA: m.playerA,
      playerB: m.playerB,
      slipAText: m.slipAText ?? undefined,
      slipAOdds: m.slipAOdds ?? undefined,
      slipBText: m.slipBText ?? undefined,
      slipBOdds: m.slipBOdds ?? undefined,
    });
    if (sha256(canon) === m.hashPre) pass++;
    else {
      fail++;
      if (failSamples.length < 6) failSamples.push({ eventKey: m.eventKey, players: `${m.playerA} v ${m.playerB}`, historyVersion: m.historyVersion });
    }
  }

  const histVersions = matches.reduce<Record<string, number>>((acc, m) => {
    const k = String(m.historyVersion);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const picks = await db.tennisPick.findMany({
    select: { createdAt: true, settledAt: true },
  });
  let settled = 0;
  let timeTravel = 0;
  let unitAnomaly = 0;
  for (const p of picks) {
    if (!p.settledAt) continue;
    settled++;
    const c = normEpoch(p.createdAt.getTime());
    const s = normEpoch(p.settledAt.getTime());
    if (s !== null && c !== null && s < c) timeTravel++;
    const rawSettled = p.settledAt.getTime();
    if (rawSettled > 1e13 || rawSettled < 1e12) unitAnomaly++;
  }

  const liveMatches = await db.tennisMatch.count({ where: { vetoed: false } });
  const withMarketProb = await db.tennisMatch.count({ where: { vetoed: false, NOT: { marketProbA: null } } });

  const health = lastFeedHealth();

  return {
    hashChain: {
      total: matches.length,
      pass,
      fail,
      passRatePct: pass + fail > 0 ? Math.round((100 * pass) / (pass + fail) * 10) / 10 : 0,
      failSamples,
      interpretation:
        "FAIL = the match's slip text/odds were rewritten after the pre-lock hash was stamped — by the live veto slip-wipe (positive-overlap gate clears slips but keeps hashPre) and/or the v13 retro migrations. Since v14 the retro migrations are gated off; the live veto path remains the residual mutator.",
    },
    historyMigrations: histVersions,
    settlement: {
      settled,
      timeTravel,
      unitAnomaly,
      verdict:
        timeTravel > 0 || unitAnomaly > 0
          ? "CRITICAL — settlement timestamps are internally inconsistent"
          : "OK",
    },
    marketFeed: {
      liveMatches,
      withRealMarketProb: withMarketProb,
      coveragePct: liveMatches > 0 ? Math.round((100 * withMarketProb) / liveMatches) : 0,
      health,
      verdict:
        withMarketProb === 0
          ? "CRITICAL — zero real market input on live cards; every price is MODEL_BOARD"
          : liveMatches > withMarketProb
            ? "PARTIAL — some cards lack real market input"
            : "OK",
    },
  };
}

// ── Backtest: Tip A only vs Tip B only vs Portfolio ─────────────────────────
export interface BacktestBlock {
  tipAOnly: SliceStat;
  tipBOnly: SliceStat;
  portfolio: SliceStat;
  scenarioRealPricing: {
    factor: number;
    note: string;
    tipAProfit: number;
    tipARoiPct: number;
  };
}

function backtestSlices(picks: PickRow[], realFactor: number): BacktestBlock {
  const tipA = emptySlice();
  const tipB = emptySlice();
  const portfolio = emptySlice();
  let wonStake = 0;
  let wonOddsSum = 0;
  for (const p of picks) {
    addPick(portfolio, p);
    if (isTipA(p.leg)) {
      addPick(tipA, p);
      if (p.status === "WON") {
        wonStake += p.stake;
        wonOddsSum += p.stake * p.odds;
      }
    }
    if (isTipB(p.leg)) addPick(tipB, p);
  }
  finalize(tipA);
  finalize(tipB);
  finalize(portfolio);
  // Reality scenario: payouts scale by the observed real-market factor
  // (real price / recorded card price, e.g. BetForward −3.5 @ 1.88 vs card
  // @ 2.74 → 0.686). The same winners then pay stake×odds×factor instead of
  // stake×odds — stakes unchanged. This delta-on-payouts form is independent
  // of the ledger's per-row profit convention (dutch match-net or leg-net).
  const tipAProfitScenario = Math.round((tipA.profit + wonOddsSum * (realFactor - 1)) * 100) / 100;
  return {
    tipAOnly: tipA,
    tipBOnly: tipB,
    portfolio,
    scenarioRealPricing: {
      factor: realFactor,
      note:
        "Same winners re-priced at observed real-market calibration (real price / recorded card price). Upper-bound honesty check, not a market replay.",
      tipAProfit: tipAProfitScenario,
      tipARoiPct: tipA.staked > 0 ? Math.round((100 * tipAProfitScenario) / tipA.staked * 10) / 10 : 0,
    },
  };
}

// ── Category coverage ────────────────────────────────────────────────────────
function categoryTable(picks: PickRow[], keyOf: (p: PickRow) => string) {
  const map = new Map<string, SliceStat>();
  for (const p of picks) {
    const k = keyOf(p);
    if (!map.has(k)) map.set(k, emptySlice());
    addPick(map.get(k)!, p);
  }
  return [...map.entries()]
    .map(([key, s]) => ({ category: key, ...finalize(s) }))
    .sort((a, b) => b.staked - a.staked);
}

// ── Daily bank curve (DUAL, Tehran days) ────────────────────────────────────
function dailyCurve(picks: PickRow[]) {
  const perDay = new Map<string, SliceStat>();
  const ordered = [...picks]
    .filter((p) => p.status !== "PENDING")
    .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
  let bank = 0;
  const curve: Array<{ day: string; bank: number }> = [];
  for (const p of ordered) {
    const day = dayInTehran(p.createdAt.getTime());
    if (!perDay.has(day)) perDay.set(day, emptySlice());
    const s = perDay.get(day)!;
    addPick(s, p);
    bank += p.profit ?? 0;
    curve.push({ day, bank: Math.round(bank * 100) / 100 });
  }
  // last bank point per day
  const lastByDay = new Map<string, number>();
  for (const pt of curve) lastByDay.set(pt.day, pt.bank);
  return {
    perDay: [...perDay.entries()].map(([day, s]) => ({ day, ...finalize(s) })).sort((a, b) => a.day.localeCompare(b.day)),
    curve: [...lastByDay.entries()].map(([day, bank]) => ({ day, bank })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// ── Tip-selection answer (computed, not asserted) ───────────────────────────
async function selectionAnalysis(picks: PickRow[]) {
  const decided = picks.filter((p) => p.status !== "PENDING" && p.line === "DUAL");
  // model implied edge at signal time: edge = odds × prob − 1
  const edges = decided.map((p) => p.odds * p.prob - 1);
  const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : 0;
  // A wing vs B wing hit rates
  const aDecided = decided.filter((p) => isTipA(p.leg));
  const bDecided = decided.filter((p) => isTipB(p.leg));
  const rate = (arr: PickRow[]) => (arr.length ? Math.round((100 * arr.filter((p) => p.status === "WON").length) / arr.length * 10) / 10 : 0);
  // market calibration gap: model favorite prob vs real market implied prob
  const matches = await db.tennisMatch.findMany({
    where: { vetoed: false },
    select: { pFinalA: true, marketProbA: true, marketOddsA: true, favorite: true },
  });
  let calibrated = 0;
  const gaps: number[] = [];
  for (const m of matches) {
    if (m.pFinalA != null && m.marketProbA != null) {
      gaps.push(Math.abs(m.pFinalA - m.marketProbA));
      calibrated++;
    }
  }
  const avgGap = gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 1000) / 1000 : null;
  return {
    modelEdgeByConstructionPct: Math.round(avgEdge * 1000) / 10,
    interpretation:
      avgEdge > 0.10
        ? "The printed edge comes from the model pricing its own odds (self-referential): tip selection is PROBABILITY-driven, then priced against an internal board window — NOT against real bookmaker odds."
        : "Printed edge is close to fair — prices are effectively market-like.",
    tipAHitRatePct: rate(aDecided),
    tipBHitRatePct: rate(bDecided),
    marketCalibration: {
      matchesWithRealMarket: calibrated,
      avgAbsGapModelVsMarket: avgGap,
      note:
        calibrated === 0
          ? "No live match had a real market probability to fuse with — the 65/35 market/model fusion silently degraded to pure model."
          : "Abs |pFinal − market implied| across live matches.",
    },
  };
}

// ── Full audit ───────────────────────────────────────────────────────────────
export interface AuditReport {
  generatedAt: string;
  verifiability: Awaited<ReturnType<typeof verifiability>>;
  selection: Awaited<ReturnType<typeof selectionAnalysis>>;
  backtest: { dual: BacktestBlock; shadow: BacktestBlock };
  categories: {
    byLegFamily: Array<{ category: string } & SliceStat>;
    byLine: Array<{ category: string } & SliceStat>;
    byCrownTier: Array<{ category: string } & SliceStat>;
    bySurface: Array<{ category: string } & SliceStat>;
    byTour: Array<{ category: string } & SliceStat>;
    byOddsSource: Array<{ category: string } & SliceStat>;
  };
  daily: ReturnType<typeof dailyCurve>;
  reality: { rows: RealityRow[]; observedRealFactor: number | null; note: string };
  delivery: { ok: boolean; posts?: unknown; note: string };
}

export async function runAudit(): Promise<AuditReport> {
  const picks = (await db.tennisPick.findMany({
    include: {
      match: {
        select: {
          eventKey: true,
          playerA: true,
          playerB: true,
          tour: true,
          surface: true,
          crownTier: true,
          historyVersion: true,
          marketProbA: true,
          slipAOdds: true,
          slipBOdds: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  })) as unknown as PickRow[];

  const dual = picks.filter((p) => p.line === "DUAL");
  const shadow = picks.filter((p) => p.line === "SHADOW");

  // observed real factor from stored real quotes vs card prices
  let realFactor: number | null = null;
  try {
    const rows = await realityReport(30);
    const devs = rows
      .filter((r) => r.deviationPct !== null && r.cardOdds && r.cardOdds > 1.3 && r.market !== "MW_A")
      // deviationPct = (card − real)/real → real/card = 1/(1 + dev)
      .map((r) => 1 / (1 + r.deviationPct! / 100));
    if (devs.length > 0) {
      realFactor = Math.round((devs.reduce((a, b) => a + b, 0) / devs.length) * 1000) / 1000;
    }
  } catch {
    realFactor = null;
  }
  const factor = realFactor ?? 0.691; // documented one-match calibration: betforward 1.88 vs card 2.72

  let delivery: AuditReport["delivery"] = { ok: false, note: "agent service unreachable" };
  try {
    const res = await fetch("http://127.0.0.1:3030/status", { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const json = (await res.json()) as unknown;
      delivery = { ok: true, posts: json, note: "live from telegram-agent" };
    }
  } catch {
    /* keep fallback */
  }

  return {
    generatedAt: new Date().toISOString(),
    verifiability: await verifiability(),
    selection: await selectionAnalysis(picks),
    backtest: {
      dual: backtestSlices(dual, factor),
      shadow: backtestSlices(shadow, factor),
    },
    categories: {
      byLegFamily: categoryTable(picks, (p) => legFamily(p.leg)),
      byLine: categoryTable(picks, (p) => p.line),
      byCrownTier: categoryTable(picks, (p) => p.match?.crownTier ?? "NONE"),
      bySurface: categoryTable(picks, (p) => p.match?.surface ?? "—"),
      byTour: categoryTable(picks, (p) => p.match?.tour ?? "—"),
      byOddsSource: categoryTable(picks, (p) => p.oddsSource),
    },
    daily: dailyCurve(dual),
    reality: {
      rows: await realityReport(25).catch(() => []),
      observedRealFactor: realFactor,
      note: realFactor
        ? `Observed real-vs-card factor ${realFactor} from stored real quotes`
        : "No real quotes stored yet — using documented one-match calibration (BetForward −3.5 @ 1.88 vs card @ 2.72 → 0.691). Enter real board prices in the Odds Reality panel to sharpen this scenario.",
    },
    delivery,
  };
}
