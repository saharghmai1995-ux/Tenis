// ─── NeoTennis Markov Quant — Disjoint Ledger & Win-Rate Command Data ──────
// The 3 production lines + shadow veto ledger are accounted SEPARATELY
// (disjoint / no double counting). Combined Win Rate excludes SHADOW.

import { db } from "@/lib/db";
import { dedupeById } from "./dedupe";
import type {
  BankPoint,
  LedgerPayload,
  LedgerRow,
  LineStats,
  ProductionLine,
} from "./types";

const BANK_START = 1000;

export async function buildLedgerPayload(): Promise<LedgerPayload> {
  const picks = await db.tennisPick.findMany({
    include: { match: true },
    orderBy: { createdAt: "asc" },
  });

  const rows: LedgerRow[] = dedupeById(
    picks.map((p) => ({
      id: p.id,
      matchId: p.matchId, // v2.0 — pair-level hedge accounting
      line: p.line as ProductionLine,
      leg: p.leg,
      desc: p.desc,
      odds: p.odds,
      stake: p.stake,
      status: p.status as LedgerRow["status"],
      profit: p.profit ?? undefined,
      settledAt: p.settledAt?.toISOString(),
      matchLabel: `${p.match.playerA} × ${p.match.playerB}`,
      tournament: p.match.tournament,
      surface: p.match.surface as LedgerRow["surface"],
      result: p.match.resultCode ?? undefined,
      hash: p.match.hashPre ?? undefined, // v2.0 — SHA-256 record table
      createdAt: p.createdAt.toISOString(),
    }))
  );

  const groupOf = (line: ProductionLine): LineStats => {
    const rs = rows.filter((r) => r.line === line);
    const won = rs.filter((r) => r.status === "WON").length;
    const lost = rs.filter((r) => r.status === "LOST").length;
    const pending = rs.filter((r) => r.status === "PENDING").length;
    const profit = rs.reduce((s, r) => s + (r.profit ?? 0), 0);
    const decided = won + lost;
    return {
      line,
      picks: rs.length,
      won,
      lost,
      pending,
      winRate: decided > 0 ? won / decided : 0,
      profit,
      roi: rs.reduce((s, r) => s + r.stake, 0) > 0 ? profit / rs.reduce((s, r) => s + r.stake, 0) : 0,
    };
  };

  // ── v2.0 pair-level accounting for the DUAL hedge ─────────────────────────
  // The supervisor locks the PAIR (leg A + complementary leg B): the hedge
  // wins when EITHER leg wins. Combined Win Rate is therefore a coverage
  // metric computed at pair level — the doc target (~91%+) — while the bank
  // curve keeps exact per-leg P&L accounting.
  interface PairAgg {
    key: string;
    won: boolean;
    lost: boolean;
    anyPending: boolean;
    profit: number;
    stake: number;
    matchLabel: string;
    settledAt: string;
  }
  const pairs = new Map<string, PairAgg>();
  for (const r of rows.filter((r) => r.line === "DUAL")) {
    const p = pairs.get(r.matchId) ?? {
      key: r.matchId,
      won: false,
      lost: false,
      anyPending: false,
      profit: 0,
      stake: 0,
      matchLabel: r.matchLabel,
      settledAt: r.settledAt ?? r.createdAt,
    };
    if (r.status === "WON") p.won = true;
    else if (r.status === "LOST") p.lost = true;
    else if (r.status === "PENDING") p.anyPending = true;
    p.profit += r.profit ?? 0;
    p.stake += r.stake;
    const t = r.settledAt ?? r.createdAt;
    if (t > p.settledAt) p.settledAt = t;
    pairs.set(r.matchId, p);
  }
  const pairList = [...pairs.values()];
  const pairDecided = pairList.filter((p) => p.won || p.lost);
  const pairWon = pairDecided.filter((p) => p.won).length;
  const pairLost = pairDecided.length - pairWon;

  const groups: LineStats[] = [
    {
      ...groupOf("DUAL"),
      // win-rate shown at pair (coverage) level; won/lost stay leg-level detail
      winRate: pairDecided.length > 0 ? pairWon / pairDecided.length : 0,
    },
    groupOf("COMBO"),
    groupOf("SNIPER"),
    groupOf("SHADOW"),
  ];

  // combined stats exclude the shadow ledger (pair-level for DUAL)
  const mainRows = rows.filter((r) => r.line !== "SHADOW" && r.status !== "PENDING" && r.status !== "VOID");
  const otherWon = mainRows.filter((r) => r.line !== "DUAL" && r.status === "WON").length;
  const otherDecided = mainRows.filter((r) => r.line !== "DUAL").length;
  const combinedDecided = pairDecided.length + otherDecided;
  const combinedWonCount = pairWon + otherWon;
  const combinedProfit = mainRows.reduce((s, r) => s + (r.profit ?? 0), 0);
  const combinedStake = mainRows.reduce((s, r) => s + r.stake, 0);

  // bank curve over settled main-line picks (chronological, exact per-leg P&L)
  const settledMain = [...mainRows].sort(
    (a, b) => (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt)
  );
  const bankCurve: BankPoint[] = [{ index: 0, bank: BANK_START, label: "START" }];
  let bank = BANK_START;
  settledMain.forEach((r, i) => {
    bank += r.profit ?? 0;
    bankCurve.push({
      index: i + 1,
      bank: Math.round(bank * 100) / 100,
      label: `${r.matchLabel} · ${r.status}`,
    });
  });

  // current streak — pair-aware (DUAL pairs collapse to one result event)
  const resultEvents: { status: "WON" | "LOST"; at: string }[] = [
    ...pairDecided.map((p) => ({
      status: (p.won ? "WON" : "LOST") as "WON" | "LOST",
      at: p.settledAt,
    })),
    ...mainRows
      .filter((r) => r.line !== "DUAL")
      .map((r) => ({ status: r.status as "WON" | "LOST", at: r.settledAt ?? r.createdAt })),
  ].sort((a, b) => a.at.localeCompare(b.at));
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

  const bestWin = rows
    .filter((r) => r.status === "WON")
    .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))[0];

  return {
    stats: {
      combinedWinRate: combinedDecided > 0 ? combinedWonCount / combinedDecided : 0,
      bank: Math.round(bank * 100) / 100,
      bankStart: BANK_START,
      profit: Math.round(combinedProfit * 100) / 100,
      roi: combinedStake > 0 ? combinedProfit / combinedStake : 0,
      picks: rows.length,
      settled: combinedDecided,
      streak,
      bestWin,
    },
    groups,
    rows: rows.slice(-80).reverse(), // latest first, bounded
    bankCurve,
  };
}
