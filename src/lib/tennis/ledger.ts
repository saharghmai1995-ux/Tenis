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
import type { QuotaTelemetry } from "./supervisor";
import type {
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
  ARCH1: { labelFa: "الگوی ۱ — تسلط فاوریت", labelEn: "Dominant Favorite" },
  ARCH2: { labelFa: "الگوی ۲ — نبرد نزدیک ستارگان", labelEn: "Competitive Clash" },
  ARCH3: { labelFa: "الگوی ۳ — سپر دوئل سرویس‌زنان", labelEn: "Serve-Bot Tie-Break Shield" },
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

function legLabelOf(leg: string): string {
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
  const singles: { p: PickWithMatch; leg: LedgerLeg }[] = [];

  for (const p of all) {
    const leg = buildLeg(p);
    if (p.line === "DUAL") {
      const agg = dual.get(p.matchId) ?? {
        matchId: p.matchId,
        legs: [],
        match: p.match,
        meta: parseMeta(p.meta),
        stake: 0,
        anyPending: false,
        settledAt: (p.settledAt ?? p.createdAt).toISOString(),
        createdAt: p.createdAt.toISOString(),
      };
      // prefer the meta of wing A (carries the archetype lock)
      if (leg.leg.startsWith("A") && !agg.meta.arch && parseMeta(p.meta).arch) {
        agg.meta = parseMeta(p.meta);
      }
      agg.legs.push(leg);
      agg.stake += leg.stake;
      if (leg.status === "PENDING") agg.anyPending = true;
      if (leg.status === "WON") agg.winner = leg;
      const t = (p.settledAt ?? p.createdAt).toISOString();
      if (t > agg.settledAt) agg.settledAt = t;
      dual.set(p.matchId, agg);
    } else if (p.line === "COMBO" || p.line === "SNIPER") {
      singles.push({ p, leg });
    }
    // SHADOW rows stay in the disjoint shadow ledger — never in the record
  }

  const dualRows: LedgerMatchRow[] = [...dual.values()].map((a) => {
    const decided = !a.anyPending && a.legs.every((l) => l.status !== "PENDING");
    const status: LedgerMatchRow["status"] = !decided
      ? "PENDING"
      : a.winner
        ? "WON"
        : "LOST";
    // doc formula: netMatchProfit = Σ(winningSlipStake × winningSlipOdds) − (stakeA + stakeB)
    // (ARCH2 wings can BOTH win — fav loses set 1 then wins 2-1 — every
    // winning wing is settled into the match-level net)
    const wonReturn = a.legs
      .filter((l) => l.status === "WON")
      .reduce((s, l) => s + l.odds * l.stake, 0);
    const profit = !decided ? 0 : wonReturn > 0 ? wonReturn - a.stake : -a.stake;
    const archCode = a.meta.arch;
    const fallback = archCode ? ARCH_FALLBACK[archCode] : undefined;
    return {
      id: `DUAL:${a.matchId}`,
      matchId: a.matchId,
      line: "DUAL" as ProductionLine,
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
      legs: a.legs.sort((x, y) => x.leg.localeCompare(y.leg)),
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
  });

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
  const rows = [...dualRows, ...singleRows]
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
    lineStatsOf("COMBO", singleRows.filter((r) => r.line === "COMBO")),
    lineStatsOf("SNIPER", singleRows.filter((r) => r.line === "SNIPER")),
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
  const official = [...dualRows, ...singleRows];
  const decidedRows = official.filter((r) => r.status !== "PENDING");
  const combinedWonCount = decidedRows.filter((r) => r.status === "WON").length;
  const combinedProfit = decidedRows.reduce((s, r) => s + r.profit, 0);
  const combinedStake = decidedRows.reduce((s, r) => s + r.stake, 0);

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

  return {
    stats: {
      combinedWinRate: decidedRows.length > 0 ? combinedWonCount / decidedRows.length : 0,
      bank: Math.round(bank * 100) / 100,
      bankStart: BANK_START,
      profit: Math.round(combinedProfit * 100) / 100,
      roi: combinedStake > 0 ? combinedProfit / combinedStake : 0,
      picks: official.length,
      settled: decidedRows.length,
      streak,
      bestWin,
    },
    groups,
    rows,
    quota,
    bankCurve,
  };
}
