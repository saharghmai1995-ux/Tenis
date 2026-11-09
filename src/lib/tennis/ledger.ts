// ─── NeoTennis Markov Quant — Disjoint Ledger & Win-Rate Command Data ──────
// The 3 production lines + shadow veto ledger are accounted SEPARATELY
// (disjoint / no double counting). Combined Win Rate excludes SHADOW.

import { db } from "@/lib/db";
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

  const rows: LedgerRow[] = picks.map((p) => ({
    id: p.id,
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
    createdAt: p.createdAt.toISOString(),
  }));

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

  const groups: LineStats[] = [
    groupOf("DUAL"),
    groupOf("COMBO"),
    groupOf("SNIPER"),
    groupOf("SHADOW"),
  ];

  // combined stats exclude the shadow ledger
  const mainRows = rows.filter((r) => r.line !== "SHADOW" && r.status !== "PENDING" && r.status !== "VOID");
  const combinedWon = mainRows.filter((r) => r.status === "WON").length;
  const combinedProfit = mainRows.reduce((s, r) => s + (r.profit ?? 0), 0);
  const combinedStake = mainRows.reduce((s, r) => s + r.stake, 0);

  // bank curve over settled main-line picks (chronological)
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

  // current streak
  let streak = 0;
  for (let i = settledMain.length - 1; i >= 0; i--) {
    const s = settledMain[i].status;
    if (i === settledMain.length - 1) {
      streak = s === "WON" ? 1 : s === "LOST" ? -1 : 0;
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
      combinedWinRate: mainRows.length > 0 ? combinedWon / mainRows.length : 0,
      bank: Math.round(bank * 100) / 100,
      bankStart: BANK_START,
      profit: Math.round(combinedProfit * 100) / 100,
      roi: combinedStake > 0 ? combinedProfit / combinedStake : 0,
      picks: rows.length,
      settled: settledMain.length,
      streak,
      bestWin,
    },
    groups,
    rows: rows.slice(-80).reverse(), // latest first, bounded
    bankCurve,
  };
}
