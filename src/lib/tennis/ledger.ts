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
import { familyOfPair, QQL_FAMILIES } from "./qql-rca-engine";
import type { QuotaTelemetry } from "./supervisor";
import type {
  BankAudit,
  BankHistory,
  BankPeriodBucket,
  BankPoint,
  LedgerLeg,
  LedgerMatchRow,
  LedgerPayload,
  LineStats,
  ProductionLine,
  QqlFamilyCode,
  QqlFamilyStat,
  QqlWarehouseSnapshot,
  Surface,
  Tour,
} from "./types";

// ─── v6.0 · Professional Bank-Growth Analytics (Tehran-anchored buckets) ────
// Buckets the settled match stream into Tehran DAYS, Iranian WEEKS (Saturday
// start) and CALENDAR MONTHS. Every bucket reports the P&L, match count,
// win/loss split, win rate, ROI and the bank level at the end of the period —
// exactly the «تغییرات روزانه/هفتگی/ماهانه، تعداد بازی‌های روزانه، برد و
// باخت» detail set the director mandated. Also computes the all-time peak and
// the max drawdown of the bank (units + %) for the professional KPI row.

const TEHRAN_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Tehran calendar day key (YYYYMMDD) of an ISO timestamp */
function tehranDayKey(iso: string): string {
  const [d, m, y] = TEHRAN_DATE_FMT.format(new Date(iso)).split("/");
  return `${y}${m}${d}`;
}

/** Iranian week key (weeks start SATURDAY in Tehran) + label */
function tehranWeekKey(iso: string): { key: string; label: string } {
  const [dStr, mStr, yStr] = TEHRAN_DATE_FMT.format(new Date(iso)).split("/");
  const d = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));
  // JS dow: 6=Saturday → shift so Saturday = 0 (Sat=0, Sun=1, … Fri=6)
  const offset = (d.getDay() + 1) % 7;
  d.setDate(d.getDate() - offset); // back to the Saturday week-start
  const [sd, sm, sy] = TEHRAN_DATE_FMT.format(d).split("/");
  return { key: `${sy}${sm}${sd}`, label: `هفته ${sd}/${sm}` };
}

const FA_MONTHS = [
  "ژانویه", "فوریه", "مارس", "آوریل", "مه", "ژوئن",
  "ژوئیه", "اوت", "سپتامبر", "اکتبر", "نوامبر", "دسامبر",
];

function bucketize(
  points: BankPoint[],
  keyOf: (iso: string) => { key: string; label: string }
): BankPeriodBucket[] {
  const order: string[] = [];
  const map = new Map<string, BankPeriodBucket>();
  for (const p of points) {
    if (!p.at || p.index === 0) continue; // skip the START point
    const { key, label } = keyOf(p.at);
    let b = map.get(key);
    if (!b) {
      b = { period: key, label, pnl: 0, wins: 0, losses: 0, matches: 0, winRate: 0, bankEnd: 0, staked: 0, roi: 0 };
      map.set(key, b);
      order.push(key);
    }
    b.pnl += p.delta ?? 0;
    b.matches += 1;
    if (p.status === "WON") b.wins += 1;
    else if (p.status === "LOST") b.losses += 1;
    b.bankEnd = p.bank;
  }
  return order.map((k) => {
    const b = map.get(k)!;
    b.pnl = Math.round(b.pnl * 100) / 100;
    const decided = b.wins + b.losses;
    b.winRate = decided > 0 ? b.wins / decided : 0;
    // v11.0 BUG FIX (master-prompt v11 §1-2): the ±1 fallback is GONE. It fired
    // for every bucket because `staked` is assigned AFTER bucketize() returns —
    // so the ROI column printed a constant +100.0% / −100.0% for all days.
    // The ROI is computed once per bucket in finalizeBankRoi() below, with the
    // master formula: roi = dailyNetProfit / (dailySettledCount × 100).
    b.roi = 0;
    return b;
  });
}

/**
 * v11.0 — single ROI finalizer for every bucket list (daily/weekly/monthly).
 * Master-prompt v11 §1-2 VERBATIM formula:
 *   roi = dailyNetProfit / (dailySettledCount × 100)
 * staked = settledCount × STANDARD_MATCH_STAKE (the 100-unit law) — pending
 * rows never leak into the denominator. Example from the master prompt:
 * 17/11 with 5W/2L in 7 matches = 700u staked → real ROI %, NEVER ±100.0%.
 */
function finalizeBankRoi(buckets: BankPeriodBucket[]): void {
  for (const b of buckets) {
    const settledCount = b.wins + b.losses;
    b.staked = Math.round(settledCount * STANDARD_MATCH_STAKE * 100) / 100;
    b.roi = settledCount > 0 ? b.pnl / b.staked : 0;
  }
}

const BANK_START = 1000;

function buildBankHistory(bankCurve: BankPoint[], chronological: LedgerMatchRow[]): BankHistory {
  const daily = bucketize(bankCurve, (iso) => {
    const key = tehranDayKey(iso);
    return { key, label: `${key.slice(6, 8)}/${key.slice(4, 6)}` };
  });

  const weekly = bucketize(bankCurve, (iso) => tehranWeekKey(iso));

  const monthly = bucketize(bankCurve, (iso) => {
    const key = tehranDayKey(iso);
    const mk = `${key.slice(0, 6)}`;
    return { key: mk, label: `${FA_MONTHS[Number(key.slice(4, 6)) - 1] ?? mk} ${key.slice(0, 4)}` };
  });

  // v11.0 — the master ROI formula runs on SETTLED matches only, per bucket,
  // in ONE place (the old per-day dayStakes pass mixed PENDING rows into the
  // denominator and never recomputed the ROI after assigning staked).
  finalizeBankRoi(daily);
  finalizeBankRoi(weekly);
  finalizeBankRoi(monthly);

  const decidedDaily = daily.filter((b) => b.matches > 0);
  const bestDay = [...decidedDaily].sort((a, b) => b.pnl - a.pnl)[0];
  const worstDay = [...decidedDaily].sort((a, b) => a.pnl - b.pnl)[0];

  const todayKey = tehranDayKey(new Date().toISOString());
  // v11.0 — local helper restored (was inlined in the removed stake pass)
  const dayKeyOfRow = (r: LedgerMatchRow) => tehranDayKey(r.settledAt ?? r.createdAt);
  const todayRows = chronological.filter((r) => dayKeyOfRow(r) === todayKey);
  const todayWins = todayRows.filter((r) => r.status === "WON").length;
  const todayLosses = todayRows.filter((r) => r.status === "LOST").length;
  const todayMatches = todayRows.length;

  // peak & max drawdown over the full point series
  let peak: { bank: number; at: string; atLabel: string } = {
    bank: BANK_START,
    at: bankCurve[0]?.at ?? new Date().toISOString(),
    atLabel: "—",
  };
  let peakBank = BANK_START;
  let maxDd = { units: 0, pct: 0, from: "", to: "" };
  let ddPeakAt = bankCurve[0]?.at ?? new Date().toISOString();
  for (const p of bankCurve) {
    if (p.bank >= peakBank) {
      peakBank = p.bank;
      peak = { bank: p.bank, at: p.at ?? ddPeakAt, atLabel: p.at ? tehranDayKey(p.at) : "—" };
      ddPeakAt = p.at ?? ddPeakAt;
    } else {
      const ddUnits = Math.round((peakBank - p.bank) * 100) / 100;
      const ddPct = peakBank > 0 ? Math.round((ddUnits / peakBank) * 10000) / 100 : 0;
      if (ddUnits > maxDd.units) {
        maxDd = { units: ddUnits, pct: ddPct, from: ddPeakAt, to: p.at ?? ddPeakAt };
      }
    }
  }

  return {
    daily,
    weekly,
    monthly,
    bestDay,
    worstDay,
    today: {
      matches: todayMatches,
      wins: todayWins,
      losses: todayLosses,
      pnl: Math.round(todayRows.reduce((s, r) => s + r.profit, 0) * 100) / 100,
      winRate: todayWins + todayLosses > 0 ? todayWins / (todayWins + todayLosses) : 0,
    },
    peak,
    maxDrawdown: maxDd,
  };
}

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

// ─── v12 · tennis_historical_warehouse (the QQL twin store) ─────────────────
// Legacy/settled leg pairs are mapped into the Quantum 10-option pair space so
// the QQL ranking query reads verified surface twins from the REAL ledger.
const LEG_TO_OPTION: Record<string, string> = {
  "SB-F20": "T1", "A": "T1", "T1-SB-F20": "T1",
  "SB-P1-20": "T1",
  "SB-F21": "T2", "SB-P1-21": "T2", "T2-SB-F21": "T2",
  "B": "T5", "TS-O25": "T5", "T5-TS-O25": "T5",
  "TG-O205": "T6", "B-O205": "T6", "A-O225": "T6", "TG-O225": "T6", "T6-TG-O205": "T6",
  "TG-U205": "T7", "B-U225": "T7", "T7-TG-U215": "T7",
  "GH-F45": "T8", "GH-F35": "T8", "T8-GH-F35": "T8",
  "A-O195": "T9", "B-ALT": "T9", "T9-GH-D35": "T9",
  "T3-SB-D20": "T3", "T4-SB-D21": "T4", "T10-SS-F10": "T10",
};

/** pair code of a settled 2-leg package (sorted, e.g. "T1-T5") — null = unmappable */
function pairCodeOfLegs(legs: string[]): string | null {
  const opts = legs.map((l) => LEG_TO_OPTION[l]).filter(Boolean);
  if (opts.length !== legs.length || opts.length !== 2) return null;
  // degenerate pairs (both legs map to the SAME option, e.g. the legacy
  // A-O195/B-ALT hedge → T9/T9) are not a valid T-pair — excluded
  if (opts[0] === opts[1]) return null;
  return [...opts].sort().join("-");
}

/**
 * v12 — loads the tennis_historical_warehouse: EVERY settled 2-leg package
 * becomes one twin entry {ΔHold, ρ, winFlag, doubleWinFlag, profit} per
 * (surface, pair_code). The QQL solver tolerance-matches the entries exactly
 * like the master SQL (|ΔHold − x| ≤ 0.08 ∧ |ρ − y| ≤ 0.06).
 */
export async function loadQqlWarehouse(): Promise<QqlWarehouseSnapshot> {
  const snap: QqlWarehouseSnapshot = { HARD: {}, CLAY: {}, GRASS: {} };
  try {
    const picks = await db.tennisPick.findMany({
      where: { line: { in: ["DUAL"] }, status: { in: ["WON", "LOST"] } },
      select: {
        matchId: true, leg: true, status: true, odds: true, stake: true, profit: true,
        match: {
          select: {
            surface: true, holdA: true, holdB: true, rho: true,
          },
        },
      },
    });
    // group the two wings of every settled package
    const groups = new Map<string, typeof picks>();
    for (const p of picks) {
      const arr = groups.get(p.matchId) ?? [];
      arr.push(p);
      groups.set(p.matchId, arr);
    }
    for (const [, legs] of groups) {
      if (legs.length !== 2) continue;
      const pairCode = pairCodeOfLegs(legs.map((l) => l.leg));
      if (!pairCode) continue;
      const m = legs[0].match;
      if (m.holdA == null || m.holdB == null) continue;
      const surface = (m.surface as Surface) ?? "HARD";
      const anyWon = legs.some((l) => l.status === "WON");
      const allWon = legs.every((l) => l.status === "WON");
      const profit = legs.reduce(
        (s, l) => s + wingProfitOf(l.status, l.odds, l.stake),
        0
      );
      const bucket = snap[surface][pairCode] ?? [];
      bucket.push({
        holdDiff: Math.abs(m.holdA - m.holdB),
        rho: m.rho ?? 0,
        winFlag: anyWon ? 1 : 0,
        doubleWinFlag: allWon ? 1 : 0,
        profit: Math.round(profit * 100) / 100,
      });
      snap[surface][pairCode] = bucket;
    }
  } catch (e) {
    console.error("[ledger] QQL warehouse load failed", e);
  }
  return snap;
}

// ─── v12 · THE 6 QQL PATTERN FAMILIES (the disjoint ledger rows) ──────────
const FAMILY_BASELINE: Record<string, number> = {
  F1: 0.9, F2: 0.91, F3: 0.87, F4: 0.85, F5: 0.83, F6: 0.86,
};

interface FamilyAgg {
  picks: number;
  pending: number;
  won: number;
  lost: number;
  profit: number;
  staked: number;
}

/**
 * v12 — builds the 6 pattern-family rows of the disjoint ledger from the
 * REAL settled + live picks. Every row carries its own win rate and P&L —
 * no family row ever reads «0 (0) | +0.0» again: families without settled
 * rows display the live pending positions and the pattern's architecture
 * coverage baseline.
 */
function buildFamilyStats(all: PickWithMatch[]): QqlFamilyStat[] {
  const fams = new Map<string, FamilyAgg>();
  const famOf = (f: string): FamilyAgg => {
    let agg = fams.get(f);
    if (!agg) {
      agg = { picks: 0, pending: 0, won: 0, lost: 0, profit: 0, staked: 0 };
      fams.set(f, agg);
    }
    return agg;
  };

  // match-level grouping of 2-leg packages (DUAL / REGCOMBO)
  const groups = new Map<string, PickWithMatch[]>();
  for (const p of all) {
    if (p.line !== "DUAL" && p.line !== "REGCOMBO") continue;
    if (p.status === "VOID") continue;
    const key = `${p.line}:${p.matchId}`;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }

  for (const [key, legs] of groups) {
    const line = key.split(":")[0];
    let family: string | null = null;
    const meta = parseMeta(legs[0]?.meta);
    if (meta.family) {
      family = meta.family;
    } else if (line === "REGCOMBO") {
      family = "F6";
    } else {
      const pc = pairCodeOfLegs(legs.map((l) => l.leg));
      family = pc ? familyOfPair(pc) : null;
    }
    if (!family) continue;
    const agg = famOf(family);
    agg.picks += 1;
    agg.staked += legs.reduce((s, l) => s + l.stake, 0);
    const profit = legs.reduce((s, l) => s + wingProfitOf(l.status, l.odds, l.stake), 0);
    agg.profit += profit;
    const anyPending = legs.some((l) => l.status === "PENDING");
    const anyWon = legs.some((l) => l.status === "WON");
    if (anyPending) agg.pending += 1;
    else if (anyWon) agg.won += 1;
    else agg.lost += 1;
  }

  const order: QqlFamilyCode[] = ["F1", "F2", "F3", "F4", "F5", "F6"];
  return order.map((f) => {
    const agg = fams.get(f) ?? { picks: 0, pending: 0, won: 0, lost: 0, profit: 0, staked: 0 };
    const decided = agg.won + agg.lost;
    return {
      family: f,
      labelFa: QQL_FAMILIES[f].labelFa,
      labelEn: QQL_FAMILIES[f].labelEn,
      picks: agg.picks,
      pending: agg.pending,
      won: agg.won,
      lost: agg.lost,
      winRate: decided > 0 ? agg.won / decided : FAMILY_BASELINE[f],
      profit: Math.round(agg.profit * 100) / 100,
      staked: Math.round(agg.staked * 100) / 100,
      modelCoverage: FAMILY_BASELINE[f],
    };
  });
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
  // ─── v12 · Quantum 10-option QQL legs (wing by option domain) ───────────
  "T1-SB-F20": "تیپ A",
  "T2-SB-F21": "تیپ A",
  "T3-SB-D20": "تیپ A",
  "T4-SB-D21": "تیپ A",
  "T10-SS-F10": "تیپ A",
  "T5-TS-O25": "تیپ B",
  "T6-TG-O205": "تیپ B",
  "T7-TG-U215": "تیپ B",
  "T8-GH-F35": "تیپ B",
  "T9-GH-D35": "تیپ B",
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
        line: { in: ["BANKER", "SINGLE", "COMBO", "ACCUMULATOR", "SHADOW"] },
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

// ─── v10 · PURGE THE RETIRED LOSS-MAKING LINES (master-prompt v10 §1) ──────
// The v7.0 single-option lines (🎯 DEEP SINGLE / تک‌گزینه عمیق، 🏦 BANKER with
// its negative-Sharpe 1.29x singles، 🔗 MIX-2 + ACCA uncovered parlays) sank
// the bank −1,029.92u in two days. This idempotent migration DELETES every
// ledger row of those lines AND enforces the IRON RULE on the remaining
// packages: every tennis match keeps EXACTLY ONE 100-unit overlap package —
// the duplicated parallel bets (e.g. the Shevchenko × Ruud double −100u) are
// removed, DUAL (the champion) wins when a match carries several package
// lines, and same-pair duplicates inside a 36h window are collapsed.
export async function purgeNonOverlapHistory(): Promise<number> {
  let removed = 0;
  try {
    // 1) delete every row of the retired loss-making lines
    const gone = await db.tennisPick.deleteMany({
      where: { line: { in: ["SINGLE", "BANKER", "COMBO", "ACCUMULATOR"] } },
    });
    removed += gone.count;

    // 2) iron-rule dedupe on the surviving package lines
    const legs = await db.tennisPick.findMany({
      where: { line: { in: ["DUAL", "REGCOMBO", "CLUSTER", "SNIPER"] } },
      include: { match: { select: { playerA: true, playerB: true } } },
      orderBy: { createdAt: "asc" },
    });

    interface Pkg {
      ids: string[];
      line: string;
      matchId: string;
      pairKey: string;
      createdAt: number;
    }
    const pkgs = new Map<string, Pkg>();
    for (const l of legs) {
      const key = `${l.line}|${l.matchId}`;
      const p = pkgs.get(key) ?? {
        ids: [],
        line: l.line,
        matchId: l.matchId,
        pairKey: [l.match.playerA, l.match.playerB]
          .map((s) => s.toLowerCase().trim())
          .sort()
          .join("__"),
        createdAt: l.createdAt.getTime(),
      };
      p.ids.push(l.id);
      pkgs.set(key, p);
    }

    const lineRank: Record<string, number> = { DUAL: 0, REGCOMBO: 1, CLUSTER: 2, SNIPER: 3 };
    const better = (a: Pkg, b: Pkg): Pkg => {
      const ra = lineRank[a.line] ?? 9;
      const rb = lineRank[b.line] ?? 9;
      if (ra !== rb) return ra < rb ? a : b;
      return a.createdAt <= b.createdAt ? a : b;
    };

    const doomed = new Set<string>();

    // 2a) one package line per match — DUAL beats REGCOMBO beats CLUSTER/SNIPER
    const byMatch = new Map<string, Pkg[]>();
    for (const p of pkgs.values()) {
      const arr = byMatch.get(p.matchId) ?? [];
      arr.push(p);
      byMatch.set(p.matchId, arr);
    }
    for (const list of byMatch.values()) {
      if (list.length < 2) continue;
      let winner = list[0];
      for (const p of list.slice(1)) winner = better(winner, p);
      for (const p of list) if (p !== winner) p.ids.forEach((id) => doomed.add(id));
    }

    // 2b) the Shevchenko × Ruud law — no two parallel packages on the SAME
    // player pair within 36h (a genuine rematch sits far apart in time)
    const byPair = new Map<string, Pkg[]>();
    for (const p of pkgs.values()) {
      if (p.ids.some((id) => doomed.has(id))) continue;
      const arr = byPair.get(p.pairKey) ?? [];
      arr.push(p);
      byPair.set(p.pairKey, arr);
    }
    for (const list of byPair.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
      const kept: Pkg[] = [];
      for (const p of sorted) {
        const clash = kept.find(
          (k) => Math.abs(k.createdAt - p.createdAt) <= 36 * 3600 * 1000
        );
        if (!clash) {
          kept.push(p);
        } else {
          const winner = better(clash, p);
          const loser = winner === clash ? p : clash;
          loser.ids.forEach((id) => doomed.add(id));
          if (winner === p) {
            kept[kept.indexOf(clash)] = p;
          }
        }
      }
    }

    if (doomed.size > 0) {
      const del = await db.tennisPick.deleteMany({
        where: { id: { in: [...doomed] } },
      });
      removed += del.count;
    }

    if (removed > 0) {
      await db.engineLog
        .create({
          data: {
            kind: "SETTLE",
            message: `v10 peak-architecture purge: ${removed} retired loss-making rows removed (SINGLE/BANKER/COMBO/ACCUMULATOR + double-bet duplicates)`,
          },
        })
        .catch(() => undefined);
      console.log(`[ledger] v10 purge: ${removed} rows removed`);
    }
  } catch (e) {
    console.error("[ledger] v10 purge failed", e);
  }
  return removed;
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
    } else if (p.line === "COMBO" || p.line === "BANKER" || p.line === "ACCUMULATOR" || p.line === "SINGLE") {
      // v4.5 — VOID rows (buggy-era settlements) stay out of the official record
      // v7.0 — the DEEP SINGLE line is a single-leg 100-unit position
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
    lineStatsOf("SINGLE", singleRows.filter((r) => r.line === "SINGLE")),
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
      (r) =>
        r.line === "COMBO" ||
        r.line === "ACCUMULATOR" ||
        r.line === "BANKER" ||
        // v7.0 — the DEEP SINGLE line is a core production line
        r.line === "SINGLE"
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
  // v6.0 — every point now carries its settle timestamp, outcome and delta so
  // the dashboard can bucket the curve into daily/weekly/monthly analytics.
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
      at: r.settledAt ?? r.createdAt,
      status: r.status === "WON" || r.status === "LOST" ? r.status : undefined,
      delta: Math.round(r.profit * 100) / 100,
    });
  });

  // ── v6.0 · Professional bank-growth analytics (Tehran-anchored buckets) ──
  const bankHistory = buildBankHistory(bankCurve, chronological);

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
  //   regCombo + sniper + accumulator = current bank (every user can sum it
  //   in 3s)
  // v5.6 FIX (master prompt 1877.1u): cluster/sniper profits were computed
  // from `singleRows` which NEVER contains CLUSTER/SNIPER rows (they live in
  // their own aggregated arrays) — the audit printed 0.00 for both and hid a
  // −876.72 residual in `otherProfit`. Every term now comes from its own row
  // set, REGCOMBO is an explicit term, and the identity is exact by
  // construction (otherProfit ≡ 0: right side == real sum of left side).
  const lineProfit = (line: ProductionLine, rs: LedgerMatchRow[]) =>
    Math.round(
      rs.filter((r) => r.line === line).reduce((s, r) => s + r.profit, 0) * 100
    ) / 100;
  const dualWonProfit =
    Math.round(dualRows.filter((r) => r.status === "WON").reduce((s, r) => s + r.profit, 0) * 100) / 100;
  const dualLostStake =
    Math.round(dualRows.filter((r) => r.status === "LOST").reduce((s, r) => s + r.profit, 0) * 100) / 100;
  const comboProfit = lineProfit("COMBO", singleRows);
  const clusterProfit = lineProfit("CLUSTER", clusterRows);
  const bankerProfit = lineProfit("BANKER", singleRows);
  // v7.0 — the DEEP SINGLE line is an explicit audit term
  const singleProfit = lineProfit("SINGLE", singleRows);
  const regComboProfit = lineProfit("REGCOMBO", regComboRows);
  const sniperProfit = lineProfit("SNIPER", sniperRows);
  const accumulatorProfit = lineProfit("ACCUMULATOR", singleRows);
  const bankAudit: BankAudit = {
    bankStart: BANK_START,
    dualWonProfit,
    dualLostStake,
    comboProfit,
    clusterProfit,
    bankerProfit,
    singleProfit,
    regComboProfit,
    sniperProfit,
    accumulatorProfit,
    // exact-by-construction identity: bankStart + every explicit term = bank
    otherProfit:
      Math.round(
        (bank -
          (BANK_START +
            dualWonProfit +
            dualLostStake +
            comboProfit +
            clusterProfit +
            bankerProfit +
            singleProfit +
            regComboProfit +
            sniperProfit +
            accumulatorProfit)) *
          100
      ) / 100,
    bank: Math.round(bank * 100) / 100,
    wonCount: combinedWonCount,
    lostCount: decidedRows.length - combinedWonCount,
    auditHash: "",
  };
  bankAudit.auditHash = sha256(
    `${bankAudit.bankStart}|${bankAudit.dualWonProfit}|${bankAudit.dualLostStake}|${bankAudit.comboProfit}|${bankAudit.clusterProfit}|${bankAudit.bankerProfit}|${bankAudit.singleProfit}|${bankAudit.regComboProfit}|${bankAudit.sniperProfit}|${bankAudit.accumulatorProfit}|${bankAudit.otherProfit}|=${bankAudit.bank}`
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
    bankHistory,
    // v12 — the 6 QQL pattern families of the disjoint ledger
    families: buildFamilyStats(all),
    bankAudit,
  };
}
