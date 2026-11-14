// ─── NeoTennis Markov Quant v3.0 — Match-Level Consolidated Ledger ─────────
// BUG FIXED (v2.0 audit): the SHA-256 record table logged TWO rows per match
// (one for winning slip A, one for losing slip B) which produced the absurd
// 29 wins / 30 losses (49.2%) next to an 89.7% gauge.
//
// v3.0 · Match-Level Dual-Slip Accounting:
//   · the two complementary slips are TWO WINGS of ONE position per match
//     (total investment = Stake_A + Stake_B = 100 units);
//   · the match is WON when EITHER wing wins;
//   · netMatchProfit = winningSlipStake × winningSlipOdds − (stakeA + stakeB);
//   · the official record table holds EXACTLY ONE row per match with both
//     wings shown side by side (winner marked) — the Combined Win Rate, the
//     bank curve and the table are now one consistent accounting identity.
// The shadow veto ledger stays disjoint and is excluded from the official
// record (disjoint / no double counting).

import { db } from "@/lib/db";
import { sha256 } from "./hash";
import type { QuotaTelemetry } from "./supervisor";
import type {
  BankAudit,
  BankPoint,
  LedgerLeg,
  LedgerMatchRow,
  LedgerPayload,
  LineStats,
  ProductionLine,
  Surface,
  Tour,
} from "./types";

const BANK_START = 1000;

// ─── v5.5 · STANDARD MATCH STAKE mirror (ledger side of the 100-unit law) ──
// Every ledger row — dual pairs, bankers, copula combos, exact clusters,
// accumulators, mix parlays, snipers — is normalized to the SAME 100-unit
// match budget; 1u / 2u / 50u / 60u stakes are rewritten on every build.
const STANDARD_MATCH_STAKE = 100;

interface PickWithMatch {
  id: string;
  matchId: string;
  line: string;
  leg: string;
  desc: string;
  odds: number;
  prob: number;
  stake: number;
  meta: string | null;
  status: string;
  profit: number | null;
  settledAt: Date | null;
  createdAt: Date;
  match: {
    eventKey: string;
    tournament: string;
    tour: string;
    surface: string;
    round: string;
    playerA: string;
    playerB: string;
    hashPre: string | null;
    resultSetsA: number | null;
    resultSetsB: number | null;
    resultCode: string | null;
  };
}

interface PickMeta {
  kind?: string;
  arch?: string;
  archLabelFa?: string;
  archLabelEn?: string;
  archCoverage?: number;
  archAdaptive?: boolean;
  favName?: string;
  eventKey?: string;
}

const ARCH_FALLBACK: Record<string, { labelFa: string; labelEn: string }> = {
  ARCH1: { labelFa: "الگوی رسمی ۱ — تسلط ست‌ها", labelEn: "Set Mastery" },
  ARCH2: { labelFa: "الگوی رسمی ۲ — تفکیک دقیق ست‌ها", labelEn: "Exact Set Split" },
  ARCH3: { labelFa: "الگوی رسمی ۳ — گیم‌های سرویس‌زنان", labelEn: "Serve-Bot Games" },
};

function espnUrlOf(eventKey: string): string | undefined {
  return /^\d+$/.test(eventKey)
    ? `https://www.espn.com/tennis/match/_/gameId/${eventKey}`
    : undefined;
}

/** exact wing P&L — settlement is re-derived (never trusts stale stored profit) */
function wingProfitOf(status: string, odds: number, stake: number): number {
  if (status === "WON") return (odds - 1) * stake;
  if (status === "LOST") return -stake;
  return 0;
}

// v4.0 — explicit wing label map for the official atomic legs (+ legacy codes)
const LEG_LABEL: Record<string, string> = {
  "SB-F20": "تیپ A",
  "TS-O25": "تیپ B",
  "SB-P1-20": "تیپ A",
  "SB-P1-21": "تیپ B",
  "TG-O225": "تیپ A",
  "GH-F45": "تیپ B",
  "A": "تیپ A",
  "A-O195": "تیپ A",
  "A-O225": "تیپ A",
  "B": "تیپ B",
  "B-ALT": "تیپ B",
  "B-U225": "تیپ B",
  // ─── v5.0 · 5-Regime legs ──────────────────────────────────────────────
  "MW-FAV": "بانکر",
  "SH-F15": "بانکر",
  "BNK-WIN": "بانکر امن",
  "BNK-SH15": "بانکر امن",
  "RC-FWU215": "تیپ اصلی",
  "RC-O215": "پوشش",
  "RC-FWO205": "تیپ اصلی",
  "RC-U205": "پوشش",
  "RC-MAIN-DOM": "تیپ اصلی",
  "RC-MAIN-SRV": "تیپ اصلی",
  "RC-COVER-DOM": "پوشش",
  "RC-COVER-SRV": "پوشش",
  "CL-F20U195": "سناریو ۱",
  "CL-F20G20": "سناریو ۲",
  "CL-F21": "سناریو ۳",
  "CLU-1": "سناریو ۱",
  "CLU-2": "سناریو ۲",
  "CLU-3": "سناریو ۳",
  // ─── v5.5 · sniper packaged position (main + capital-protection cover) ──
  "SNIPER-MAIN": "اسنایپر — تیپ اصلی",
  "SNIPER-COVER": "پوشش اصل سرمایه",
};

function legLabelOf(leg: string): string {
  if (LEG_LABEL[leg]) return LEG_LABEL[leg];
  if (leg.startsWith("SNIPER-")) return "اسنایپر";
  return leg.startsWith("B") ? "تیپ B" : "تیپ A";
}

function buildLeg(p: PickWithMatch): LedgerLeg {
  const status = p.status as LedgerLeg["status"];
  return {
    leg: p.leg,
    label: legLabelOf(p.leg),
    desc: p.desc,
    odds: p.odds,
    stake: p.stake,
    status: status === "PENDING" || status === "VOID" ? "PENDING" : status,
    prob: p.prob,
    profit: wingProfitOf(status, p.odds, p.stake),
  };
}

function parseMeta(metaStr: string | null): PickMeta {
  try {
    return metaStr ? (JSON.parse(metaStr) as PickMeta) : {};
  } catch {
    return {};
  }
}

/**
 * v5.5 — the 100-unit stake law (master prompt §1, mandatory in ledger.ts).
 * Idempotent migration that rewrites every legacy stake in the database:
 *   1) single-leg cards (BANKER 60u / mix 25u / accumulator 25u / shadow 1u)
 *      → exactly STANDARD_MATCH_STAKE (100u);
 *   2) multi-wing positions (DUAL / REGCOMBO / CLUSTER / SNIPER) → every
 *      match group rescaled proportionally so the wings sum EXACTLY to 100u
 *      (silver-era 50u halves and legacy 50/50 splits included);
 *   3) 1u / 2u naked sniper stakes of the bleeding era are gone by the same
 *      rescale — no ledger row can ever carry them again.
 * Wing profits are re-derived from (odds × stake) at read time, so the
 * accounting identity stays intact after the rewrite.
 */
export async function normalizeStakeUnits(): Promise<void> {
  try {
    await db.tennisPick.updateMany({
      where: {
        line: { in: ["BANKER", "COMBO", "ACCUMULATOR", "SHADOW"] },
        stake: { not: STANDARD_MATCH_STAKE },
      },
      data: { stake: STANDARD_MATCH_STAKE },
    });

    const legs = await db.tennisPick.findMany({
      where: { line: { in: ["DUAL", "REGCOMBO", "CLUSTER", "SNIPER"] } },
      select: { id: true, matchId: true, line: true, stake: true },
    });
    const groups = new Map<string, { id: string; stake: number }[]>();
    for (const l of legs) {
      const key = `${l.line}|${l.matchId}`;
      const arr = groups.get(key) ?? [];
      arr.push({ id: l.id, stake: l.stake });
      groups.set(key, arr);
    }
    for (const group of groups.values()) {
      if (group.length === 0) continue;
      const sum = group.reduce((s, g) => s + g.stake, 0);
      if (sum <= 0) continue;
      const scaled = group.map((g) => ({
        id: g.id,
        stake: Math.round((g.stake / sum) * STANDARD_MATCH_STAKE * 10) / 10,
      }));
      const drift =
        Math.round((STANDARD_MATCH_STAKE - scaled.reduce((s, g) => s + g.stake, 0)) * 10) / 10;
      const biggest = scaled.reduce((a, b) => (b.stake > a.stake ? b : a));
      biggest.stake = Math.round((biggest.stake + drift) * 10) / 10;
      for (const g of scaled) {
        const before = group.find((x) => x.id === g.id)!.stake;
        if (Math.abs(g.stake - before) < 0.05) continue;
        await db.tennisPick.update({ where: { id: g.id }, data: { stake: g.stake } });
      }
    }
  } catch (e) {
    console.error("[ledger] 100-unit stake normalization failed", e);
  }
}

export async function buildLedgerPayload(
  quota?: QuotaTelemetry
): Promise<LedgerPayload> {
  const picks = (await db.tennisPick.findMany({
    include: { match: true },
    orderBy: { createdAt: "asc" },
  })) as unknown as PickWithMatch[];

  // de-id dupes defensively
  const byId = new Map<string, PickWithMatch>();
  for (const p of picks) if (!byId.has(p.id)) byId.set(p.id, p);
  const all = [...byId.values()];

  // ── v3.0 · group the DUAL hedge into ONE match row ────────────────────────
  interface DualAgg {
    matchId: string;
    legs: LedgerLeg[];
    match: PickWithMatch["match"];
    meta: PickMeta;
    stake: number;
    anyPending: boolean;
    winner?: LedgerLeg;
    settledAt: string;
    createdAt: string;
  }
  const dual = new Map<string, DualAgg>();
  const cluster = new Map<DualAgg["matchId"], DualAgg>();
  // v5.5 — REGCOMBO (main + cover) and the packaged SNIPER position
  // (main + capital-protection cover) also group into ONE match row so the
  // SHA-256 record keeps exactly one row per match across ALL regimes.
  const regCombo = new Map<DualAgg["matchId"], DualAgg>();
  const sniperAgg = new Map<DualAgg["matchId"], DualAgg>();
  const singles: { p: PickWithMatch; leg: LedgerLeg }[] = [];

  const aggFor = (map: Map<string, DualAgg>, p: PickWithMatch): DualAgg => {
    let agg = map.get(p.matchId);
    if (!agg) {
      agg = {
        matchId: p.matchId,
        legs: [],
        match: p.match,
        meta: parseMeta(p.meta),
        stake: 0,
        anyPending: false,
        settledAt: (p.settledAt ?? p.createdAt).toISOString(),
        createdAt: p.createdAt.toISOString(),
      };
      map.set(p.matchId, agg);
    }
    return agg;
  };

  const pushAgg = (map: Map<string, DualAgg>, p: PickWithMatch, leg: LedgerLeg) => {
    const agg = aggFor(map, p);
    agg.legs.push(leg);
    agg.stake += leg.stake;
    if (leg.status === "PENDING") agg.anyPending = true;
    if (leg.status === "WON") agg.winner = leg;
    const t = (p.settledAt ?? p.createdAt).toISOString();
    if (t > agg.settledAt) agg.settledAt = t;
  };

  for (const p of all) {
    const leg = buildLeg(p);
    if (p.line === "DUAL") {
      const agg = aggFor(dual, p);
      // prefer the meta of wing A (carries the archetype lock)
      if (leg.leg.startsWith("A") && !agg.meta.arch && parseMeta(p.meta).arch) {
        agg.meta = parseMeta(p.meta);
      }
      pushAgg(dual, p, leg);
      dual.set(p.matchId, agg);
    } else if (p.line === "REGCOMBO") {
      pushAgg(regCombo, p, leg);
    } else if (p.line === "SNIPER") {
      pushAgg(sniperAgg, p, leg);
    } else if (p.line === "CLUSTER") {
      pushAgg(cluster, p, leg);
    } else if (p.line === "COMBO" || p.line === "BANKER" || p.line === "ACCUMULATOR") {
      // v4.5 — VOID rows (buggy-era settlements) stay out of the official record
      if (p.status !== "VOID") singles.push({ p, leg });
    }
    // SHADOW rows stay in the disjoint shadow ledger — never in the record
  }

  // v5.0 — one shared mapper for match-level multi-wing positions (DUAL 2
  // wings, CLUSTER 3 dutching scenarios)
  const aggRowOf = (a: DualAgg, line: ProductionLine): LedgerMatchRow => {
    const decided = !a.anyPending && a.legs.every((l) => l.status !== "PENDING");
    const status: LedgerMatchRow["status"] = !decided
      ? "PENDING"
      : a.winner
        ? "WON"
        : "LOST";
    // doc formula: netMatchProfit = Σ(winningSlipStake × winningSlipOdds) − total stake
    const wonReturn = a.legs
      .filter((l) => l.status === "WON")
      .reduce((s, l) => s + l.odds * l.stake, 0);
    const profit = !decided ? 0 : wonReturn > 0 ? wonReturn - a.stake : -a.stake;
    const archCode = a.meta.arch;
    const fallback = archCode ? ARCH_FALLBACK[archCode] : undefined;
    return {
      id: `${line}:${a.matchId}`,
      matchId: a.matchId,
      line,
      matchLabel: `${a.match.playerA} × ${a.match.playerB}`,
      tournament: a.match.tournament,
      tour: a.match.tour as Tour,
      surface: a.match.surface as Surface,
      round: a.match.round,
      archetype:
        archCode && fallback
          ? {
              code: archCode as "ARCH1" | "ARCH2" | "ARCH3",
              labelFa: a.meta.archLabelFa ?? fallback.labelFa,
              labelEn: a.meta.archLabelEn ?? fallback.labelEn,
              coverage: a.meta.archCoverage ?? 0,
              adaptive: a.meta.archAdaptive,
            }
          : undefined,
      legs: a.legs.sort((x, y) => x.label.localeCompare(y.label)),
      winnerLeg: a.winner?.leg,
      status,
      stake: a.stake,
      profit: Math.round(profit * 100) / 100,
      result: a.match.resultCode ?? undefined,
      setsA: a.match.resultSetsA ?? undefined,
      setsB: a.match.resultSetsB ?? undefined,
      hash: a.match.hashPre ?? undefined,
      espnUrl: espnUrlOf(a.match.eventKey),
      settledAt: decided ? a.settledAt : undefined,
      createdAt: a.createdAt,
    };
  };

  const dualRows: LedgerMatchRow[] = [...dual.values()].map((a) => aggRowOf(a, "DUAL"));
  const clusterRows: LedgerMatchRow[] = [...cluster.values()].map((a) => aggRowOf(a, "CLUSTER"));
  const regComboRows: LedgerMatchRow[] = [...regCombo.values()].map((a) => aggRowOf(a, "REGCOMBO"));
  const sniperRows: LedgerMatchRow[] = [...sniperAgg.values()].map((a) => aggRowOf(a, "SNIPER"));

  const singleRows: LedgerMatchRow[] = singles.map(({ p, leg }) => {
    const decided = leg.status === "WON" || leg.status === "LOST";
    return {
      id: `${p.line}:${p.id}`,
      matchId: p.matchId,
      line: p.line as ProductionLine,
      matchLabel: `${p.match.playerA} × ${p.match.playerB}`,
      tournament: p.match.tournament,
      tour: p.match.tour as Tour,
      surface: p.match.surface as Surface,
      round: p.match.round,
      legs: [leg],
      winnerLeg: leg.status === "WON" ? leg.leg : undefined,
      status: decided ? (leg.status as "WON" | "LOST") : "PENDING",
      stake: leg.stake,
      profit: Math.round(leg.profit * 100) / 100,
      result: p.match.resultCode ?? undefined,
      setsA: p.match.resultSetsA ?? undefined,
      setsB: p.match.resultSetsB ?? undefined,
      hash: p.match.hashPre ?? undefined,
      espnUrl: espnUrlOf(p.match.eventKey),
      settledAt: (p.settledAt ?? undefined)?.toISOString(),
      createdAt: p.createdAt.toISOString(),
    };
  });

  // latest first, bounded
  const rows = [...dualRows, ...clusterRows, ...regComboRows, ...sniperRows, ...singleRows]
    .sort(
      (a, b) =>
        (b.settledAt ?? b.createdAt).localeCompare(a.settledAt ?? a.createdAt)
    )
    .slice(0, 80);

  // ── disjoint line stats (DUAL at MATCH level, others per pick) ────────────
  const lineStatsOf = (line: ProductionLine, rs: LedgerMatchRow[]): LineStats => {
    const won = rs.filter((r) => r.status === "WON").length;
    const lost = rs.filter((r) => r.status === "LOST").length;
    const pending = rs.filter((r) => r.status === "PENDING").length;
    const profit = rs.reduce((s, r) => s + r.profit, 0);
    const stake = rs.reduce((s, r) => s + r.stake, 0);
    const decided = won + lost;
    return {
      line,
      picks: rs.length,
      won,
      lost,
      pending,
      winRate: decided > 0 ? won / decided : 0,
      profit: Math.round(profit * 100) / 100,
      roi: stake > 0 ? profit / stake : 0,
    };
  };

  const groups: LineStats[] = [
    lineStatsOf("DUAL", dualRows),
    lineStatsOf("BANKER", singleRows.filter((r) => r.line === "BANKER")),
    lineStatsOf("REGCOMBO", regComboRows),
    lineStatsOf("CLUSTER", clusterRows),
    lineStatsOf("ACCUMULATOR", singleRows.filter((r) => r.line === "ACCUMULATOR")),
    lineStatsOf("COMBO", singleRows.filter((r) => r.line === "COMBO")),
    lineStatsOf("SNIPER", sniperRows),
    lineStatsOf(
      "SHADOW",
      all
        .filter((p) => p.line === "SHADOW")
        .map((p) => ({
          id: `SHADOW:${p.id}`,
          matchId: p.matchId,
          line: "SHADOW" as ProductionLine,
          matchLabel: `${p.match.playerA} × ${p.match.playerB}`,
          tournament: p.match.tournament,
          tour: p.match.tour as Tour,
          surface: p.match.surface as Surface,
          legs: [buildLeg(p)],
          status: (p.status === "WON" ? "WON" : p.status === "LOST" ? "LOST" : "PENDING") as
            | "PENDING"
            | "WON"
            | "LOST",
          stake: p.stake,
          profit: Math.round(wingProfitOf(p.status, p.odds, p.stake) * 100) / 100,
          createdAt: p.createdAt.toISOString(),
        }))
    ),
  ];

  // ── combined stats (official record only — shadow excluded, match level) ──
  const official = [...dualRows, ...clusterRows, ...regComboRows, ...sniperRows, ...singleRows];
  const decidedRows = official.filter((r) => r.status !== "PENDING");
  const combinedWonCount = decidedRows.filter((r) => r.status === "WON").length;
  const combinedProfit = decidedRows.reduce((s, r) => s + r.profit, 0);
  const combinedStake = decidedRows.reduce((s, r) => s + r.stake, 0);

  // v4.5 — Core System Win Rate: the headline gauge shows the CORE lines only
  // (complementary golden pairs + safe service-king mixes). The high-odds
  // sniper line keeps its own disjoint stats and is never merged into the
  // core number — its 1-unit misses used to drag 89.4% down to 60.6%.
  const coreRows = [
    ...dualRows,
    ...singleRows.filter(
      (r) => r.line === "COMBO" || r.line === "ACCUMULATOR" || r.line === "BANKER"
    ),
    ...regComboRows,
    ...clusterRows,
  ];
  const coreDecided = coreRows.filter((r) => r.status !== "PENDING");
  const coreWon = coreDecided.filter((r) => r.status === "WON").length;
  // v4.5 — stake-weighted alternative: Σ won stake / Σ decided stake over the
  // whole official record
  const wonStake = decidedRows
    .filter((r) => r.status === "WON")
    .reduce((s, r) => s + r.stake, 0);

  // bank curve over decided rows (chronological, match-level P&L for DUAL)
  const chronological = [...decidedRows].sort(
    (a, b) => (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt)
  );
  const bankCurve: BankPoint[] = [{ index: 0, bank: BANK_START, label: "START" }];
  let bank = BANK_START;
  chronological.forEach((r, i) => {
    bank += r.profit;
    bankCurve.push({
      index: i + 1,
      bank: Math.round(bank * 100) / 100,
      label: `${r.matchLabel} · ${r.status}`,
    });
  });

  // current streak — one result event per match (DUAL collapsed)
  const resultEvents = chronological.map((r) => ({
    status: r.status as "WON" | "LOST",
    at: r.settledAt ?? r.createdAt,
  }));
  let streak = 0;
  for (let i = resultEvents.length - 1; i >= 0; i--) {
    const s = resultEvents[i].status;
    if (i === resultEvents.length - 1) {
      streak = s === "WON" ? 1 : -1;
    } else {
      if (s === "WON" && streak > 0) streak++;
      else if (s === "LOST" && streak < 0) streak--;
      else break;
    }
  }

  const bestWin = [...official]
    .filter((r) => r.status === "WON")
    .sort((a, b) => b.profit - a.profit)[0];

  // ── v5.0 · Live Bankroll Audit Inspector ──────────────────────────────────
  // the algebraic accounting box rendered above the SHA-256 record table:
  //   bankStart + Σ dual wins − Σ dual losses + combo + cluster + banker +
  //   sniper + accumulator = current bank (every user can sum it in 3s)
  const lineProfit = (line: ProductionLine, rs: LedgerMatchRow[]) =>
    Math.round(
      rs.filter((r) => r.line === line).reduce((s, r) => s + r.profit, 0) * 100
    ) / 100;
  const dualWonProfit =
    Math.round(dualRows.filter((r) => r.status === "WON").reduce((s, r) => s + r.profit, 0) * 100) / 100;
  const dualLostStake =
    Math.round(dualRows.filter((r) => r.status === "LOST").reduce((s, r) => s + r.profit, 0) * 100) / 100;
  const bankAudit: BankAudit = {
    bankStart: BANK_START,
    dualWonProfit,
    dualLostStake,
    comboProfit: lineProfit("COMBO", singleRows),
    clusterProfit: lineProfit("CLUSTER", singleRows),
    bankerProfit: lineProfit("BANKER", singleRows),
    sniperProfit: lineProfit("SNIPER", singleRows),
    accumulatorProfit: lineProfit("ACCUMULATOR", singleRows),
    otherProfit:
      Math.round((combinedProfit - dualWonProfit - dualLostStake) * 100) / 100 -
      dualWonProfit -
      dualLostStake +
      dualWonProfit +
      dualLostStake -
      lineProfit("COMBO", singleRows) -
      lineProfit("CLUSTER", singleRows) -
      lineProfit("BANKER", singleRows) -
      lineProfit("SNIPER", singleRows) -
      lineProfit("ACCUMULATOR", singleRows),
    bank: Math.round(bank * 100) / 100,
    wonCount: combinedWonCount,
    lostCount: decidedRows.length - combinedWonCount,
    auditHash: "",
  };
  bankAudit.otherProfit =
    Math.round(
      (bankAudit.bank -
        (bankAudit.bankStart +
          bankAudit.dualWonProfit +
          bankAudit.dualLostStake +
          bankAudit.comboProfit +
          bankAudit.clusterProfit +
          bankAudit.bankerProfit +
          bankAudit.sniperProfit +
          bankAudit.accumulatorProfit)) *
        100
    ) / 100;
  bankAudit.auditHash = sha256(
    `${bankAudit.bankStart}|${bankAudit.dualWonProfit}|${bankAudit.dualLostStake}|${bankAudit.comboProfit}|${bankAudit.clusterProfit}|${bankAudit.bankerProfit}|${bankAudit.sniperProfit}|${bankAudit.accumulatorProfit}|${bankAudit.otherProfit}|=${bankAudit.bank}`
  );

  return {
    stats: {
      combinedWinRate: decidedRows.length > 0 ? combinedWonCount / decidedRows.length : 0,
      // v5.0 — core system win rate (DUAL + BANKER + COMBO + CLUSTER; sniper excluded)
      coreWinRate: coreDecided.length > 0 ? coreWon / coreDecided.length : 0,
      // v4.5 — stake-weighted win rate over the official record
      stakeWeightedWinRate: combinedStake > 0 ? wonStake / combinedStake : 0,
      bank: Math.round(bank * 100) / 100,
      bankStart: BANK_START,
      profit: Math.round(combinedProfit * 100) / 100,
      roi: combinedStake > 0 ? combinedProfit / combinedStake : 0,
      picks: official.length,
      settled: decidedRows.length,
      streak,
      bestWin,
      // ─── v5.0 · Live Bankroll Audit Inspector — exact algebraic identity ────
      // bank = bankStart + Σ(profit of WON positions) + Σ(profit of LOST positions)
      winsGross:
        Math.round(
          decidedRows.filter((r) => r.status === "WON").reduce((s, r) => s + r.profit, 0) * 100
        ) / 100,
      lossesGross:
        Math.round(
          decidedRows.filter((r) => r.status === "LOST").reduce((s, r) => s + r.profit, 0) * 100
        ) / 100,
      winsCount: combinedWonCount,
      lossesCount: decidedRows.length - combinedWonCount,
    },
    groups,
    rows,
    quota,
    bankCurve,
    bankAudit,
  };
}
