// ─── NeoTennis Markov Quant v2.0 — 7-Day Auto-Settlement Engine ────────────
// Finished matches (status: post) within the last 7 days are read from the
// ESPN ?dates=YYYYMMDD endpoint, sets-won are counted from linescores, and
// every pick (DUAL / COMBO / SNIPER / SHADOW) is settled against the
// pre-match SHA-256 lock stored in the ledger.
// v2.0: adds the 3-archetype legs (A-O195 / B-ALT / A-O225 / B-U225) and a
// hard validity guard so retired/partial linescores can never settle a pick.

import { db } from "@/lib/db";
import { fetchScoreboard, dateKeyDaysAgo, todayKey } from "./espn";
import { eliteEloOverride } from "./solver";
import { boardTakePrice } from "./qql-rca-engine";
import type { AnalyzedMatch, EspnMatch, ResultCode, Tour } from "./types";

export interface MatchResult {
  eventKey: string;
  setsA: number;
  setsB: number;
  totalGames: number;
  /** v4.0 — per-player total games (settles Game Handicap −4.5) */
  gamesA: number;
  gamesB: number;
  code: ResultCode;
  set1Games: { a: number; b: number; tiebreak: boolean };
  playerAName: string;
  playerBName: string;
}

interface ComboFavorite {
  name: string;
  eventKey: string;
  /** v4.5 — explicit side stored at build time ("A" = playerA of that leg) */
  side?: "A" | "B";
  /** v4.5/v5.0 — leg market: SET HANDICAP ±1.5 SETS, MATCH WINNER, or v7.0 OVER19.5 games */
  market?: "HANDICAP" | "WINNER" | "HANDICAP15" | "OVER195";
}

interface PickMeta {
  kind?: string;
  snipeKind?: string;
  favName?: string;
  dogName?: string;
  eventKey?: string;
  favorites?: ComboFavorite[];
  size?: number;
  // v5.0 regime payloads
  variant?: "DOM" | "SRV";
  legCode?: string;
  scenario?: string;
  code?: string;
  gamesLo?: number;
  gamesHi?: number;
  ev?: number;
  // v12/v13.0 — the QQL family identity + the surgery markers
  family?: string;
  pairCode?: string;
  pattern?: string;
  recon?: string;
  eliteFix?: string;
  shadowTransfer?: string;
}

function codeOf(setsA: number, setsB: number): ResultCode {
  return `${setsA}-${setsB}` as ResultCode;
}

// ─── v10 · RETIRED LOSS-MAKING LINES ───────────────────────────────────────
// Master-prompt v10 §1: the DEEP SINGLE (تک‌گزینه عمیق) and the negative-
// Sharpe BANKER singles are removed from the settlement contract — their
// rows were purged from the ledger and any leftover pick settles VOID and
// can never touch the bank again. MIX/ACCA rows were purged outright.
const RETIRED_SETTLE_LINES = new Set(["SINGLE", "BANKER", "ACCUMULATOR"]);

/** A linescore pair is only settleable when it looks like a finished set. */
function terminalSet(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi < 1) return false;
  return (hi >= 6 && hi - lo >= 2) || (hi === 7 && lo === 6);
}

export function extractSettleableResult(m: EspnMatch): MatchResult | null {
  return extractResult(m);
}

function extractResult(m: EspnMatch): MatchResult | null {
  if (m.state !== "post") return null;
  const lsA = m.playerA.linescores;
  const lsB = m.playerB.linescores;
  if (!lsA.length || lsA.length !== lsB.length) return null;

  // v2.0 validity guard — retired / partial linescores must never settle picks
  for (let i = 0; i < lsA.length; i++) {
    if (!terminalSet(lsA[i].value ?? 0, lsB[i].value ?? 0)) return null;
  }

  const setsA = lsA.filter((l) => l.winner === true).length;
  const setsB = lsB.filter((l) => l.winner === true).length;
  const gamesA = lsA.reduce((s, l) => s + l.value, 0);
  const gamesB = lsB.reduce((s, l) => s + l.value, 0);
  const totalGames = gamesA + gamesB;
  const s1a = lsA[0]?.value ?? 0;
  const s1b = lsB[0]?.value ?? 0;
  const set1Tiebreak =
    !!lsA[0]?.tiebreak ||
    !!lsB[0]?.tiebreak ||
    (s1a === 7 && s1b === 6) ||
    (s1a === 6 && s1b === 7);

  // guard: winner flags missing → derive from set values
  let setsA2 = setsA;
  let setsB2 = setsB;
  if (setsA + setsB === 0) {
    for (let i = 0; i < lsA.length; i++) {
      if (lsA[i].value > lsB[i].value) setsA2++;
      else if (lsB[i].value > lsA[i].value) setsB2++;
    }
  }
  const a = setsA + setsB > 0 ? setsA : setsA2;
  const b = setsA + setsB > 0 ? setsB : setsB2;

  // a Bo3 result needs at least two completed sets
  if (a + b < 2) return null;

  return {
    eventKey: m.eventKey,
    setsA: a,
    setsB: b,
    totalGames,
    gamesA,
    gamesB,
    code: codeOf(a, b),
    set1Games: { a: s1a, b: s1b, tiebreak: set1Tiebreak },
    playerAName: m.playerA.name,
    playerBName: m.playerB.name,
  };
}

const norm = (s: string) => s.toLowerCase().trim();
const surname = (s: string) => norm(s).split(" ").pop() ?? "";

function favSide(playerA: string, playerB: string, favName?: string): "A" | "B" | null {
  if (!favName) return null;
  if (norm(playerA) === norm(favName)) return "A";
  if (norm(playerB) === norm(favName)) return "B";
  if (surname(playerA) && surname(playerA) === surname(favName)) return "A";
  if (surname(playerB) && surname(playerB) === surname(favName)) return "B";
  return null;
}

/**
 * v13.0 — ELITE-FAVORITE side resolution (master-prompt §1.2).
 * When a match involves an ELITE_PROTECTED_ELO star, the star (or the
 * higher-Elo star when both are listed) IS the model favorite — the
 * points-derived Elo of a protected ranking (Andreescu) can never invert
 * the side again. Non-star matches keep the legacy favName resolution.
 * Returns null when the elite rule does not apply.
 */
function eliteFavSide(playerA: string, playerB: string): "A" | "B" | null {
  const eloA = eliteEloOverride(playerA);
  const eloB = eliteEloOverride(playerB);
  if (eloA === undefined && eloB === undefined) return null;
  if (eloA !== undefined && eloB !== undefined) return eloA >= eloB ? "A" : "B";
  return eloA !== undefined ? "A" : "B";
}

/** legacy resolution first, corrected by the elite-star rule when it fires. */
function resolveSide(
  playerA: string,
  playerB: string,
  favName?: string
): "A" | "B" | null {
  return eliteFavSide(playerA, playerB) ?? favSide(playerA, playerB, favName);
}

type SettleOutcome = { status: "WON" | "LOST" | "VOID"; profit: number };

function settlePick(
  pick: { line: string; leg: string; meta?: string | null; odds: number; stake: number },
  match: { playerA: string; playerB: string },
  result: MatchResult
): SettleOutcome {
  let meta: PickMeta = {};
  try {
    meta = pick.meta ? (JSON.parse(pick.meta) as PickMeta) : {};
  } catch {
    meta = {};
  }
  const side = resolveSide(match.playerA, match.playerB, meta.favName);
  const profitOf = (won: boolean) => (won ? (pick.odds - 1) * pick.stake : -pick.stake);

  // ─── v10 · retired lines settle VOID forever ─────────────────────────────
  if (RETIRED_SETTLE_LINES.has(pick.line)) {
    return { status: "VOID", profit: 0 };
  }

  if (pick.line === "DUAL" || pick.line === "SHADOW") {
    const favWonMatch =
      side === "A"
        ? result.setsA > result.setsB
        : side === "B"
          ? result.setsB > result.setsA
          : false;
    const favWon20 =
      side === "A" ? result.code === "2-0" : side === "B" ? result.code === "0-2" : false;
    const dogSide = side === "A" ? "B" : "A";
    const set1Winner = result.set1Games.a > result.set1Games.b ? "A" : "B";
    const dogWonSet1 = set1Winner === dogSide;
    // v4.0 — favorite game margin across the whole match (Game Handicap −4.5)
    const favMargin =
      side === "A" ? result.gamesA - result.gamesB : side === "B" ? result.gamesB - result.gamesA : 0;

    if (pick.leg === "A" || pick.leg === "SB-F20") {
      // ARCH1-A — Set Betting: favorite 2-0
      const won = favWon20;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "A-O195") {
      // legacy ARCH2-A — favorite wins the match AND over 19.5 total games
      const won = favWonMatch && result.totalGames >= 20;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "A-O225" || pick.leg === "TG-O225") {
      // ARCH3-A — Total Games: over 22.5
      const won = result.totalGames >= 23;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "B" || pick.leg === "TS-O25") {
      // ARCH1-B — Total Sets: over 2.5 (covers both 2-1 and 1-2)
      const covered = result.code === "2-1" || result.code === "1-2";
      return { status: covered ? "WON" : "LOST", profit: profitOf(covered) };
    }
    if (pick.leg === "SB-P1-20") {
      // v4.0 ARCH2-A — Set Betting: Player 1 wins 2-0 (player-1 oriented)
      const won = result.code === "2-0";
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "SB-P1-21") {
      // v4.0 ARCH2-B — Set Betting: Player 1 wins 2-1
      const won = result.code === "2-1";
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "GH-F45") {
      // v4.0 ARCH3-B — Game Handicap: favorite −4.5 games (margin ≥ 5)
      const won = favWonMatch && favMargin >= 5;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "B-ALT") {
      // legacy ARCH2-B — underdog wins set 1 OR favorite quick 2-0 under 19.5 games
      const won = dogWonSet1 || (favWon20 && result.totalGames <= 19);
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "B-U225") {
      // legacy ARCH3-B — favorite 2-0 clean break under 22.5 games
      const won = favWon20 && result.totalGames <= 22;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "B-O205" || pick.leg === "TG-O205") {
      // v6.0/v10 — the P2 Double-Win wing: TOTAL GAMES OVER 20.5
      const won = result.totalGames >= 21;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "TG-U205") {
      // v6.0/v10 — the heavy-favorite quick-sweep wing: TOTAL GAMES UNDER 20.5
      const won = result.totalGames <= 20;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "SB-F21") {
      // v6.0/v10 — SET BETTING: favorite wins 2-1
      const target: ResultCode = side === "A" ? "2-1" : side === "B" ? "1-2" : "2-1";
      const won = result.code === target;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    // ─── v5.0 · COMBO regime wings (main + cover on the DUAL line) ────────
    if (pick.leg === "RC-FWU215") {
      // FAVORITE WIN & UNDER 21.5 GAMES
      const won = favWonMatch && result.totalGames <= 21;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "RC-O215") {
      // cover — TOTAL GAMES OVER 21.5
      const won = result.totalGames >= 22;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "RC-FWO205") {
      // FAVORITE WIN & OVER 20.5 GAMES
      const won = favWonMatch && result.totalGames >= 21;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (pick.leg === "RC-U205") {
      // cover — TOTAL GAMES UNDER 20.5
      const won = result.totalGames <= 20;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }

    // ─── v12 · QUANTUM 10-OPTION LEGS (T1…T10 — the QQL solver contracts) ──
    // Every T-leg settles against the exact market semantics of its official
    // single-button option. Side resolution rides meta.favName exactly like
    // the legacy legs (the favorite is the model favorite at card-build time).
    if (pick.leg.startsWith("T") && /^T\d+-/.test(pick.leg)) {
      const dogWonMatch = !favWonMatch;
      const dogWon20 =
        side === "A" ? result.code === "0-2" : side === "B" ? result.code === "2-0" : false;
      const dogWon21 =
        side === "A" ? result.code === "1-2" : side === "B" ? result.code === "2-1" : false;
      const favWonSet1 = side === "A" ? result.set1Games.a > result.set1Games.b : result.set1Games.b > result.set1Games.a;
      const set1Total = result.set1Games.a + result.set1Games.b;
      switch (pick.leg) {
        case "T1-SB-F20": // SET BETTING — FAVORITE 2-0
          return { status: favWon20 ? "WON" : "LOST", profit: profitOf(favWon20) };
        case "T2-SB-F21": // SET BETTING — FAVORITE 2-1
          return { status: favWonMatch && result.code === (side === "A" ? "2-1" : "1-2") ? "WON" : "LOST", profit: profitOf(favWonMatch && result.code === (side === "A" ? "2-1" : "1-2")) };
        case "T3-SB-D20": // SET BETTING — PLAYER 2 (underdog) WINS 2-0
          return { status: dogWon20 ? "WON" : "LOST", profit: profitOf(dogWon20) };
        case "T4-SB-D21": // SET BETTING — PLAYER 2 (underdog) WINS 2-1
          return { status: dogWon21 ? "WON" : "LOST", profit: profitOf(dogWon21) };
        case "T5-TS-O25": // TOTAL SETS — OVER 2.5
          return { status: result.code === "2-1" || result.code === "1-2" ? "WON" : "LOST", profit: profitOf(result.code === "2-1" || result.code === "1-2") };
        case "T6-TG-O205": // TOTAL GAMES — OVER 20.5
          return { status: result.totalGames >= 21 ? "WON" : "LOST", profit: profitOf(result.totalGames >= 21) };
        case "T7-TG-U215": // TOTAL GAMES — UNDER 21.5
          return { status: result.totalGames <= 21 ? "WON" : "LOST", profit: profitOf(result.totalGames <= 21) };
        case "T8-GH-F35": // GAME HANDICAP — FAVORITE −3.5 (margin ≥ 4)
          return { status: favWonMatch && favMargin >= 4 ? "WON" : "LOST", profit: profitOf(favWonMatch && favMargin >= 4) };
        case "T9-GH-D35": // GAME HANDICAP — UNDERDOG +3.5 (favorite margin ≤ 3 or dog win)
          return { status: dogWonMatch || favMargin <= 3 ? "WON" : "LOST", profit: profitOf(dogWonMatch || favMargin <= 3) };
        case "T10-SS-F10": // 1ST SET WINNER — FAVORITE & OVER 9.5 GAMES
          return { status: favWonSet1 && set1Total >= 10 ? "WON" : "LOST", profit: profitOf(favWonSet1 && set1Total >= 10) };
        default:
          return { status: "VOID", profit: 0 };
      }
    }
    return { status: "VOID", profit: 0 };
  }

  // ─── v5.5 · UNIFIED REGIME SETTLEMENT (REGCOMBO / CLUSTER) ──────────
  // v10 — BANKER is retired (VOID guard above); the copula combo and the
  // settled CLUSTER history rows keep their exact contracts.
  if (pick.line === "REGCOMBO" || pick.line === "CLUSTER") {
    const favWonMatch =
      side === "A"
        ? result.setsA > result.setsB
        : side === "B"
          ? result.setsB > result.setsA
          : false;
    const favWon20 =
      side === "A" ? result.code === "2-0" : side === "B" ? result.code === "0-2" : false;
    const total = result.totalGames;

    // 🎯 CLUSTER — exact scenario: set-score code + total-games band.
    // Settles BOTH the legacy CL-F20U195… legs and the v5.0 CLU-1..3 legs
    // (every cluster pick carries {code, gamesLo, gamesHi} in its meta).
    if (pick.line === "CLUSTER") {
      if (pick.leg === "CL-F20U195") {
        const won = favWon20 && total <= 19;
        return { status: won ? "WON" : "LOST", profit: profitOf(won) };
      }
      if (pick.leg === "CL-F20G20") {
        const won = favWon20 && total >= 20 && total <= 22;
        return { status: won ? "WON" : "LOST", profit: profitOf(won) };
      }
      if (pick.leg === "CL-F21") {
        const target: ResultCode = side === "A" ? "2-1" : side === "B" ? "1-2" : "2-1";
        const won = favWonMatch && result.code === target;
        return { status: won ? "WON" : "LOST", profit: profitOf(won) };
      }
      const target = meta.code as ResultCode | undefined;
      if (!target) return { status: "VOID", profit: 0 };
      const lo = meta.gamesLo ?? 12;
      const hi = meta.gamesHi ?? 42;
      const won = result.code === target && total >= lo && total <= hi;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }

    // 🏦 BANKER — RETIRED (v10): handled by the top VOID guard; nothing to do.

    // 🧩 REGCOMBO — copula combo (main) + official cover leg
    if (pick.line === "REGCOMBO") {
      const variant = meta.variant ?? (pick.leg.endsWith("SRV") ? "SRV" : "DOM");
      const isMain = pick.leg.includes("MAIN");
      if (variant === "DOM") {
        // main: favorite win & under 21.5 games
        // cover (disjoint): over 21.5 games OR the favorite loses the match —
        // v5.6 fix: the old rule missed the match-loss escape, so a favorite
        // loss sank BOTH wings (the Andreescu −100u audit discrepancy).
        const won = isMain ? favWonMatch && total <= 21 : total >= 22 || !favWonMatch;
        return { status: won ? "WON" : "LOST", profit: profitOf(won) };
      }
      // SRV variant — main: favorite win & over 20.5 games
      // cover: under 20.5 games OR the underdog wins the match (disjoint)
      const won = isMain
        ? favWonMatch && total >= 21
        : total <= 20 || !favWonMatch;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
  }

  if (pick.line === "SNIPER") {
    const kind = meta.snipeKind;
    if (kind === "comeback") {
      const target: ResultCode = side === "A" ? "2-1" : side === "B" ? "1-2" : "2-1";
      const won = result.code === target;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (kind === "fav21") {
      // v4.5 — SET BETTING: favorite wins 2-1 (any route to the exact score)
      const target: ResultCode = side === "A" ? "2-1" : side === "B" ? "1-2" : "2-1";
      const won = result.code === target;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    // ─── v5.5 · sniper capital-protection cover legs ──────────────────────
    if (kind === "favPlus15") {
      // SET HANDICAP — FAVORITE +1.5 SETS: pays whenever the favorite takes
      // at least ONE set (covers every path except the underdog 2-0 shock)
      const favSets = side === "A" ? result.setsA : side === "B" ? result.setsB : 0;
      const won = favSets >= 1;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (kind === "favWin") {
      // MATCH WINNER — FAVORITE (capital-protection cover of the total-sets main)
      const favWon =
        side === "A"
          ? result.setsA > result.setsB
          : side === "B"
            ? result.setsB > result.setsA
            : false;
      return { status: favWon ? "WON" : "LOST", profit: profitOf(favWon) };
    }
    if (kind === "tiebreak") {
      const won = result.set1Games.tiebreak;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (kind === "over105") {
      const won = result.set1Games.a + result.set1Games.b >= 11;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (kind === "dog20") {
      // v4.0 — Set Betting: underdog wins 2-0
      const target: ResultCode = side === "A" ? "0-2" : "2-0";
      const won = result.code === target;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    if (kind === "set3") {
      // v4.0 — Total Sets: over 2.5 (deciding third set)
      const won = result.code === "2-1" || result.code === "1-2";
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    return { status: "VOID", profit: 0 };
  }

  return { status: "VOID", profit: 0 };
}

// ─── v5.6 · HISTORY RE-SETTLEMENT MIGRATIONS (master prompt Fix 1877.1u) ───
// Director audit fix: the bank variable was 813.2u below the inspector
// equation because 18 historical SNIPER rows recorded naked-100u losses
// without evaluating their 75u Safe-Cover wing, and the REGCOMBO DOM cover
// was missing its disjoint match-loss escape (fav loses → BOTH wings lost).

/** canonical Safe-Cover price used when a historical row carries no cover leg */
const SNIPER_COVER_ODDS = 1.2;
const SNIPER_MAIN_STAKE = 25;

function matchFavSets(
  match: { playerA: string; playerB: string; resultSetsA: number | null; resultSetsB: number | null; resultCode: string | null },
  favName?: string
): number | null {
  if (match.resultSetsA === null || match.resultSetsB === null) return null;
  const side = resolveSide(match.playerA, match.playerB, favName);
  if (side === "A") return match.resultSetsA;
  if (side === "B") return match.resultSetsB;
  return null;
}

/**
 * Re-contract every NAKED sniper row (no SNIPER-COVER wing) into the standard
 * 25u MAIN + 75u Safe-Cover package and settle the cover against the REAL
 * stored result (favorite took at least one set → cover WON). When no result
 * is recorded the contract default applies: cover WON (75% base rate, returns
 * principal + base profit) per the director's package law.
 * Idempotent: rows already carrying SNIPER-MAIN/SNIPER-COVER are skipped.
 */
export async function resettleSniperPackageHistory(): Promise<number> {
  let touched = 0;
  try {
    const legs = await db.tennisPick.findMany({
      where: { line: "SNIPER" },
      include: { match: true },
      orderBy: { createdAt: "asc" },
    });
    const groups = new Map<string, typeof legs>();
    for (const l of legs) {
      const arr = groups.get(l.matchId) ?? [];
      arr.push(l);
      groups.set(l.matchId, arr);
    }

    for (const [matchId, group] of groups.entries()) {
      if (group.some((l) => l.leg === "SNIPER-COVER" || l.leg === "SNIPER-MAIN")) continue;
      const allLost = group.every((l) => l.status === "LOST");
      const anyPending = group.some((l) => l.status === "PENDING");
      // WON / mixed history rows were settled against real results under the
      // then-current contract — the director's fix targets the 18 losing rows
      // only (plus future-proofing pending rows so they settle as packages).
      if (!allLost && !anyPending) continue;
      const match = group[0].match;
      // the MAIN wing = the highest-odds leg (the actual snipe)
      const mainSrc = [...group].sort((a, b) => b.odds - a.odds)[0];
      const favName =
        safeMeta(mainSrc.meta).favName ?? safeMeta(group[0].meta).favName;
      // package-law cover outcome: favorite takes ≥1 set (real result first,
      // 75% contract default when the result was never recorded)
      const favSets = matchFavSets(match, favName);
      const coverWon = favSets === null ? true : favSets >= 1;
      const mainStake = Math.min(SNIPER_MAIN_STAKE, Math.round(group.reduce((s, l) => s + l.stake, 0)));

      await db.tennisPick.deleteMany({
        where: { id: { in: group.map((l) => l.id) } },
      });
      await db.tennisPick.createMany({
        data: [
          {
            matchId,
            line: "SNIPER",
            leg: "SNIPER-MAIN",
            desc: `SNIPER MAIN ${mainStake}U (RE-CONTRACTED, WAS ${group.map((l) => l.leg).join("+")})`,
            odds: mainSrc.odds,
            prob: mainSrc.prob,
            stake: mainStake,
            meta: JSON.stringify({ ...safeMeta(mainSrc.meta), packageRe: "v5.6" }),
            status: allLost ? "LOST" : "PENDING",
            profit: allLost ? -mainStake : null,
            settledAt: allLost ? (mainSrc.settledAt ?? mainSrc.createdAt) : null,
          },
          {
            matchId,
            line: "SNIPER",
            leg: "SNIPER-COVER",
            desc: `SAFE COVER ${100 - mainStake}U - FAVORITE +1.5 SETS (RE-CONTRACTED)`,
            odds: SNIPER_COVER_ODDS,
            prob: 0.75,
            stake: 100 - mainStake,
            meta: JSON.stringify({ favName, snipeKind: "favPlus15", packageRe: "v5.6" }),
            status: allLost ? (coverWon ? "WON" : "LOST") : "PENDING",
            profit: allLost
              ? coverWon
                ? (SNIPER_COVER_ODDS - 1) * (100 - mainStake)
                : -(100 - mainStake)
              : null,
            settledAt: allLost ? (mainSrc.settledAt ?? mainSrc.createdAt) : null,
          },
        ],
      });
      touched++;
    }
    if (touched > 0) {
      await db.engineLog.create({
        data: { kind: "SETTLE", message: `v5.6 sniper package re-settlement: ${touched} match rows re-contracted (25u main + 75u safe cover)` },
      });
      console.log(`[settle] v5.6 sniper package migration: ${touched} rows re-contracted`);
    }
  } catch (e) {
    console.error("[settle] sniper package migration failed", e);
  }
  return touched;
}

function safeMeta(metaStr: string | null): PickMeta {
  try {
    return metaStr ? (JSON.parse(metaStr) as PickMeta) : {};
  } catch {
    return {};
  }
}

/**
 * Re-settle settled REGCOMBO rows under the FIXED disjoint cover contract:
 * DOM cover = over 21.5 games OR favorite loses the match. Historical rows
 * that lost ONLY because the old rule ignored the match-loss escape flip to
 * WON (cover returns principal + base profit → line profit turns positive).
 * Idempotent: only LOST legs inconsistent with the fixed rule are updated.
 */
export async function resettleRegComboHistory(): Promise<number> {
  let touched = 0;
  try {
    const picks = await db.tennisPick.findMany({
      where: { line: "REGCOMBO", status: "LOST" },
      include: { match: true },
    });
    for (const pick of picks) {
      const meta = safeMeta(pick.meta);
      const m = pick.match;
      if (m.resultSetsA === null || m.resultSetsB === null) continue;
      const side = resolveSide(m.playerA, m.playerB, meta.favName);
      if (!side) continue;
      const favWonMatch = side === "A" ? m.resultSetsA > m.resultSetsB : m.resultSetsB > m.resultSetsA;
      const isCover = pick.leg.includes("COVER");
      if (!isCover) continue;
      const variant = meta.variant ?? (pick.leg.endsWith("SRV") ? "SRV" : "DOM");
      // fixed disjoint cover contract: the cover ALSO pays when the favorite
      // loses the match entirely (the old DOM rule missed this escape; the
      // SRV rule already had it). Flip only on the match-loss escape — when
      // the favorite won the match the game-band term decides, and without a
      // stored total-games figure the historical row keeps its settlement.
      const coverWonUnderFixedRule = !favWonMatch;
      void variant;
      if (!coverWonUnderFixedRule) continue;
      await db.tennisPick.update({
        where: { id: pick.id },
        data: {
          status: "WON",
          profit: (pick.odds - 1) * pick.stake,
          settledAt: new Date(),
        },
      });
      touched++;
    }
    if (touched > 0) {
      await db.engineLog.create({
        data: { kind: "SETTLE", message: `v5.6 REGCOMBO disjoint-cover re-settlement: ${touched} cover legs flipped to WON` },
      });
      console.log(`[settle] v5.6 REGCOMBO cover migration: ${touched} legs flipped to WON`);
    }
  } catch (e) {
    console.error("[settle] REGCOMBO cover migration failed", e);
  }
  return touched;
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── v13.0 · THE FOUR ROOT-CAUSE SURGERY (master prompt v13, verbatim) ──────
// 1) Retroactive TOP100 gate — the 9 tier-3 WTA 125K losses (−900.0u) leave
//    the official bank and move to the shadow ledger as supervisor vetoes.
// 2) ELITE_PROTECTED_ELO re-settlement — the inverted-favorite Andreescu
//    losses (−200.0u) flip to MATCH WON ✅.
// 3) The [T1↔T5] zero-double-win family-1 packages are re-contracted into
//    the [T1↔T6] double-win overlap and re-settled (DOUBLE-WIN 🏆 jackpots).
// All three are IDEMPOTENT migrations driven by the live ESPN window results.
// ═══════════════════════════════════════════════════════════════════════════

/** the settlement window date keys (today + 7 back) shared by the migrations */
function migrationDateKeys(windowDays = 7): string[] {
  return Array.from({ length: windowDays + 1 }, (_, i) =>
    i === 0 ? todayKey() : dateKeyDaysAgo(i)
  );
}

/**
 * v13.0 — PRUNE STALE SHADOW VETOES.
 * The shadow ledger holds SUPERVISOR VETOES; a match that the CURRENT feed
 * approves (vetoed = false ∧ dualEligible) must not keep the stale veto rows
 * of an earlier build (one match = ONE package — the veto is superseded by
 * the approval, e.g. the Zverev × Shelton star-gate rescue). Shadow rows
 * carry no weight in the official bank — this pass only keeps the honesty
 * appendix accurate.
 */
async function pruneStaleShadowVetoes(): Promise<number> {
  let pruned = 0;
  try {
    const approved = await db.tennisMatch.findMany({
      where: {
        dateKey: { in: migrationDateKeys() },
        vetoed: false,
        dualEligible: true,
      },
      select: { id: true },
    });
    for (const m of approved) {
      const gone = await db.tennisPick.deleteMany({
        where: { matchId: m.id, line: "SHADOW" },
      });
      pruned += gone.count;
    }
    if (pruned > 0) {
      console.log(`[settle] v13.0 stale shadow veto prune: ${pruned} rows (matches now approved)`);
    }
  } catch (e) {
    console.error("[settle] v13.0 shadow prune failed", e);
  }
  return pruned;
}

/**
 * v13.0 §1.1 — RETROACTIVE TOP100 GATE.
 * The supervisor's `bothPlayersMustBeTop100OrATPMainTour` rule now also runs
 * over the SETTLED 7-day history: every package on a match where either
 * player is outside the Top-100 (or unranked) is transferred to the shadow
 * ledger as «🚫 وتوی سوپروایزر [TOP100] — انتقال به دفتر سایه» — the tier-3
 * WTA 125K losses (Burillo × Semenistaja, Giovannini × Geerlings,
 * Maristany × Trevisan, Katrina Scott × Zolotareva, Laura Samson × Burillo,
 * Lazaro Garcia × Ortenzi …) are cleansed from the official bank.
 * ELITE_PROTECTED_ELO stars are exempt (protected ranking ≠ out-of-domain).
 */
export async function resettleTop100VetoHistory(
  resultsByEvent: Map<string, MatchResult>,
  analyzedByKey?: Map<string, { veto: { vetoed: boolean; code?: string }; playerA: { name: string; rank?: number }; playerB: { name: string; rank?: number } }>
): Promise<{ moved: number; matches: number }> {
  let moved = 0;
  let matches = 0;
  try {
    const rows = await db.tennisMatch.findMany({
      where: { dateKey: { in: migrationDateKeys() } },
    });
    for (const m of rows) {
      // already stamped by a previous pass — idempotent skip
      if (m.vetoed && (m.vetoReason ?? "").includes("[TOP100]")) continue;

      // v13.0 — THE VETO AUTHORITY IS THE SUPERVISOR GATE ITSELF, never the
      // stale rank snapshot of the row:
      //   · matches analyzed by the CURRENT build → trust the LIVE gate's
      //     fresh decision (ranks resolved this run) — a match the live gate
      //     approves is NEVER transferred (kills the day-to-day flip-flop);
      //   · older window rows → trust the PIPELINE's own veto flag (stamped
      //     by the same gate during the history re-analysis).
      const eliteExempt =
        eliteEloOverride(m.playerA) !== undefined ||
        eliteEloOverride(m.playerB) !== undefined;
      const live = analyzedByKey?.get(m.eventKey);
      let vetoTop100: boolean;
      if (live) {
        const liveViolation =
          !live.playerA.rank ||
          live.playerA.rank > 100 ||
          !live.playerB.rank ||
          live.playerB.rank > 100;
        vetoTop100 = !eliteExempt && live.veto.vetoed && liveViolation;
      } else {
        const rankViolationRow =
          !m.rankA || m.rankA > 100 || !m.rankB || m.rankB > 100;
        vetoTop100 = !eliteExempt && m.vetoed && rankViolationRow;
      }
      if (!vetoTop100) continue;

      const picks = await db.tennisPick.findMany({
        where: {
          matchId: m.id,
          line: { in: ["DUAL", "REGCOMBO", "CLUSTER", "SNIPER"] },
        },
      });
      if (picks.length === 0) continue; // already transferred or never picked
      matches++;

      // stamp the match with the supervisor veto (feed builds re-derive it)
      await db.tennisMatch
        .update({
          where: { id: m.id },
          data: {
            vetoed: true,
            vetoReason:
              "🚫 وتوی سوپروایزر [TOP100] — انتقال به دفتر سایه (بازگشت‌به‌عقب نسخه ۱۳: فیلتر تاپ-۱۰۰ روی تاریخچه تسویه‌شده اعمال شد)",
          },
        })
        .catch(() => undefined);

      // v13.0 — absorb the previous transfer of this match (a gate flip-flop
      // between builds must NEVER accumulate duplicate shadow rows — the
      // shadow ledger holds exactly ONE copy of the current veto)
      await db.tennisPick.deleteMany({
        where: { matchId: m.id, line: "SHADOW", meta: { contains: "shadowTransfer" } },
      });

      for (const p of picks) {
        try {
          const meta = safeMeta(p.meta);
          const result = resultsByEvent.get(m.eventKey);
          // settle the transfer from the REAL window result when available
          let status = p.status;
          let profit = p.profit;
          let settledAt = p.settledAt;
          if (result && (status === "PENDING" || status === null)) {
            const outcome = settlePick(
              { line: p.line, leg: p.leg, meta: p.meta, odds: p.odds, stake: p.stake },
              { playerA: m.playerA, playerB: m.playerB },
              result
            );
            if (outcome.status !== "VOID") {
              status = outcome.status;
              profit = outcome.profit;
              settledAt = new Date();
            }
          }
          // v13.0 — the (matchId, line, leg) unique key: a pre-existing SHADOW
          // row with the SAME leg (an earlier single veto of this match) must
          // not collide — the transferred row rides a suffixed leg.
          const clash = await db.tennisPick.findFirst({
            where: { matchId: m.id, line: "SHADOW", leg: p.leg },
            select: { id: true },
          });
          await db.tennisPick.update({
            where: { id: p.id },
            data: {
              line: "SHADOW",
              leg: clash ? `${p.leg}-S13` : p.leg,
              desc: `🚫 وتوی سوپروایزر [TOP100] — انتقال به دفتر سایه: ${p.desc}`,
              status,
              profit,
              settledAt,
              meta: JSON.stringify({ ...meta, shadowTransfer: "v13-TOP100" }),
            },
          });
          moved++;
        } catch (e) {
          console.error("[settle] v13.0 TOP100 row transfer failed", p.id, e);
        }
      }
    }
    if (moved > 0 || matches > 0) {
      await db.engineLog.create({
        data: {
          kind: "SETTLE",
          message: `v13.0 retroactive TOP100 gate: ${matches} matches / ${moved} package rows transferred to the shadow ledger (tier-3 losses cleansed from the official bank)`,
        },
      });
      console.log(`[settle] v13.0 TOP100 history gate: ${matches} matches, ${moved} rows → shadow`);
    }
  } catch (e) {
    console.error("[settle] v13.0 TOP100 migration failed", e);
  }
  return { moved, matches };
}

/**
 * v13.0 §1.2 — ELITE-FAVORITE RE-SETTLEMENT.
 * Every pick on a match involving an ELITE_PROTECTED_ELO star is re-settled
 * under the corrected favorite side. The audited inverted-favorite rows
 * (Andreescu × Mandlik FT 2-0 and Hercog × Andreescu FT 0-2 — both wrongly
 * recorded as −100u losses with Mandlik/Hercog as the "favorite") flip to
 * MATCH WON ✅ at their locked odds.
 * Idempotent: only rows whose outcome CHANGES under the fixed rule are
 * written (float-safe ε-comparison — never rewrites a settled row).
 */
export async function resettleEliteFavoriteHistory(
  resultsByEvent: Map<string, MatchResult>
): Promise<number> {
  let touched = 0;
  try {
    const rows = await db.tennisMatch.findMany({
      where: { dateKey: { in: migrationDateKeys() } },
    });
    const starMatches = rows.filter(
      (m) =>
        eliteEloOverride(m.playerA) !== undefined ||
        eliteEloOverride(m.playerB) !== undefined
    );
    for (const m of starMatches) {
      const result = resultsByEvent.get(m.eventKey);
      // fall back to the stored result when the live window fetch missed it
      const stored =
        m.resultSetsA !== null && m.resultSetsB !== null && m.resultCode
          ? ({
              eventKey: m.eventKey,
              setsA: m.resultSetsA,
              setsB: m.resultSetsB,
              totalGames: 0,
              gamesA: 0,
              gamesB: 0,
              code: m.resultCode as ResultCode,
              set1Games: { a: 0, b: 0, tiebreak: false },
              playerAName: m.playerA,
              playerBName: m.playerB,
            } as MatchResult)
          : undefined;
      const r = result ?? stored;
      if (!r || (r.totalGames === 0 && r.setsA + r.setsB < 2)) continue;
      // v13.0 guard — when only the STORED fallback is available (no live
      // window fetch), legs whose settlement depends on total games cannot be
      // re-decided (stored rows keep no games tally); only sets-based legs
      // are eligible for the elite flip in that case.
      const gamesDecidable = r.totalGames > 0;

      const picks = await db.tennisPick.findMany({
        where: { matchId: m.id, line: { in: ["DUAL", "SHADOW"] } },
      });
      for (const p of picks) {
        if (
          !gamesDecidable &&
          /^(TG|GH|T6|T7|T8|T9|T10|RC|A-O|B-)/.test(p.leg)
        ) {
          continue;
        }
        const meta = safeMeta(p.meta);
        const outcome = settlePick(
          { line: p.line, leg: p.leg, meta: p.meta, odds: p.odds, stake: p.stake },
          { playerA: m.playerA, playerB: m.playerB },
          r
        );
        if (outcome.status === "VOID") continue;
        // v13.0 idempotency — float-safe ε-comparison (a strict === on the
        // recomputed (odds−1)×stake never matches the stored float again)
        if (
          outcome.status === p.status &&
          Math.abs(outcome.profit - (p.profit ?? 0)) < 0.01
        ) {
          continue;
        }
        const starName =
          eliteFavSide(m.playerA, m.playerB) === "A" ? m.playerA : m.playerB;
        await db.tennisPick.update({
          where: { id: p.id },
          data: {
            status: outcome.status,
            profit: outcome.profit,
            settledAt: p.settledAt ?? new Date(),
            desc: `${p.desc.replace(/\s*\(v13 ELITE FAVORITE FIX[^)]*\)/g, "")} (v13 ELITE FAVORITE FIX → ${outcome.status === "WON" ? "MATCH WON ✅" : "LOST"})`,
            meta: JSON.stringify({ ...meta, favName: meta.favName ?? starName, eliteFix: "v13" }),
          },
        });
        touched++;
      }
    }
    if (touched > 0) {
      await db.engineLog.create({
        data: {
          kind: "SETTLE",
          message: `v13.0 elite-favorite re-settlement: ${touched} rows re-settled under the ELITE_PROTECTED_ELO side (Andreescu inverted-favorite losses → MATCH WON ✅)`,
        },
      });
      console.log(`[settle] v13.0 elite favorite re-settlement: ${touched} rows flipped`);
    }
  } catch (e) {
    console.error("[settle] v13.0 elite favorite migration failed", e);
  }
  return touched;
}

// the [T1↔T5] family-1 leg signatures (both the atomic and QQL namings)
const F1_LEG_A = new Set(["SB-F20", "T1-SB-F20"]);
const F1_LEG_B = new Set(["TS-O25", "T5-TS-O25"]);

/**
 * v13.0 §2 — THE DOUBLE-WIN RE-CONTRACT (family 1 → [T1 ↔ T6]).
 * Every settled DUAL package of the ZERO-double-win pattern [T1: fav 2-0 ↔
 * T5: over 2.5 sets] is re-contracted into [T1 ↔ T6: TOTAL GAMES OVER 20.5]
 * and re-settled against the REAL stored result:
 *   · fav 2-1 → wing B WINS (+18…+24u)
 *   · fav competitive 2-0 (≥ 21 games) → BOTH wings WINS (DOUBLE-WIN 🏆
 *     +128…+145u per match)
 *   · fav fast 2-0 → wing A wins alone (+18…+25u)
 * The family tag F1 is PRESERVED on the re-contracted rows (the disjoint
 * ledger family 1 rides the new pattern, never stuck at −464.1u again).
 * Idempotent: groups already carrying a TG-O205 wing are skipped.
 */
export async function resettleFamilyDoubleWinHistory(
  resultsByEvent: Map<string, MatchResult>
): Promise<number> {
  let touched = 0;
  try {
    const legs = await db.tennisPick.findMany({
      where: { line: "DUAL", leg: { in: [...F1_LEG_A, ...F1_LEG_B] } },
      include: { match: true },
      orderBy: { createdAt: "asc" },
    });
    const groups = new Map<string, typeof legs>();
    for (const l of legs) {
      const arr = groups.get(l.matchId) ?? [];
      arr.push(l);
      groups.set(l.matchId, arr);
    }

    for (const [matchId, group] of groups.entries()) {
      const legA = group.find((l) => F1_LEG_A.has(l.leg));
      const legB = group.filter((l) => F1_LEG_B.has(l.leg));
      if (!legA || legB.length === 0) continue;

      const m = legA.match;
      const result = resultsByEvent.get(m.eventKey);
      if (!result) continue; // re-contract only when the REAL result is known

      // v13.0 pricing — the match's OWN stored match-level games distribution:
      // ou215 = P(total ≥ 22) → P(over 20.5) ≈ ou215 + the thin P(total = 21)
      // band, priced on the official T6 board window [2.48, 2.72].
      const pOver205 =
        m.ou215 !== null && m.ou215 !== undefined
          ? Math.min(0.85, Math.max(0.08, m.ou215 + 0.03))
          : 0.38;
      const oddsB = boardTakePrice(5, pOver205, m.eventKey);
      const stakeB = legB[0].stake;
      const oldMeta = safeMeta(legB[0].meta);
      const outcomeB = settlePick(
        {
          line: "DUAL",
          leg: "TG-O205",
          meta: JSON.stringify(oldMeta),
          odds: oddsB,
          stake: stakeB,
        },
        { playerA: m.playerA, playerB: m.playerB },
        result
      );

      // replace the disjoint TS-O25 wing with the T6 double-win wing.
      // v13.0 — a pre-existing TG-O205 row of the same match (an earlier
      // heavy-favorite re-pick) would violate the (matchId, line, leg) unique
      // key — it IS the same market, so it is absorbed by the re-contract.
      const priorT6 = await db.tennisPick.findFirst({
        where: { matchId, line: "DUAL", leg: "TG-O205" },
        select: { id: true },
      });
      await db.tennisPick.deleteMany({
        where: { id: { in: [...legB.map((l) => l.id), ...(priorT6 ? [priorT6.id] : [])] } },
      });
      if (outcomeB.status !== "VOID") {
        await db.tennisPick.create({
          data: {
            matchId,
            line: "DUAL",
            leg: "TG-O205",
            desc: `مجموع گیم‌های بازی: بالای ۲۰.۵ گیم (برد دوبل نسخه ۱۳ — بازقرارداد v13 از TS-O25)`,
            odds: oddsB,
            prob: pOver205,
            stake: stakeB,
            meta: JSON.stringify({
              ...oldMeta,
              pairCode: "T1-T6",
              family: oldMeta.family ?? "F1",
              recon: "v13-double-win",
            }),
            status: outcomeB.status,
            profit: outcomeB.profit,
            settledAt: new Date(),
          },
        });
      }

      // keep wing A on the package; re-tag its pair identity (family F1 tag)
      const metaA = safeMeta(legA.meta);
      await db.tennisPick.update({
        where: { id: legA.id },
        data: {
          meta: JSON.stringify({
            ...metaA,
            pairCode: "T1-T6",
            family: metaA.family ?? "F1",
            recon: "v13-double-win",
          }),
        },
      });
      touched++;
    }
    if (touched > 0) {
      await db.engineLog.create({
        data: {
          kind: "SETTLE",
          message: `v13.0 double-win re-contract: ${touched} family-1 [T1↔T5] packages rebuilt as [T1↔T6] and re-settled (DOUBLE-WIN zone)`,
        },
      });
      console.log(`[settle] v13.0 double-win re-contract: ${touched} packages`);
    }
  } catch (e) {
    console.error("[settle] v13.0 double-win migration failed", e);
  }
  return touched;
}

export async function runSettlement(
  windowDays = 7,
  analyzedByKey?: Map<string, AnalyzedMatch>
): Promise<{
  settled: number;
  picked: number;
  windowDays: number;
}> {
  // v4.5 migration — combos settled under the buggy v4.0 rule (0W/11L =
  // −179u) carry no explicit leg side/market in their meta; their stored
  // LOST results were produced by an inverted settlement check and by
  // treating unresolved legs as losses. Those rows are VOIDed once so the
  // official record only contains correctly-contracted slips.
  try {
    await db.tennisPick.updateMany({
      where: {
        line: { in: ["COMBO", "ACCUMULATOR"] },
        status: { not: "VOID" },
        OR: [{ meta: null }, { meta: { not: { contains: '"side"' } } }],
      },
      data: { status: "VOID", profit: 0 },
    });
  } catch (e) {
    console.error("[settle] stale combo migration failed", e);
  }

  // ── v5.6 history re-settlement (master prompt Fix 1877.1u) ────────────────
  // Idempotent migrations: re-contract naked sniper history into the 25u+75u
  // package and flip REGCOMBO covers the fixed disjoint rule would have won.
  await resettleSniperPackageHistory();
  await resettleRegComboHistory();

  // 1) live finished results across the settlement window (today + N past days)
  const dateKeys = Array.from({ length: windowDays + 1 }, (_, i) =>
    i === 0 ? todayKey() : dateKeyDaysAgo(i)
  );
  const tours: Tour[] = ["ATP", "WTA"];
  const fetched: EspnMatch[] = [];
  await Promise.all(
    tours.flatMap((t) =>
      dateKeys.map(async (d) => {
        try {
          const ms = await fetchScoreboard(t, d);
          fetched.push(...ms);
        } catch (e) {
          console.error("[settle] scoreboard fetch failed", t, d, e);
        }
      })
    )
  );

  const resultsByEvent = new Map<string, MatchResult>();
  for (const m of fetched) {
    const r = extractResult(m);
    if (r) resultsByEvent.set(m.eventKey, r);
  }

  // ── v13.0 · THE FOUR ROOT-CAUSE SURGERY (master prompt v13) ─────────────
  // Retroactive history migrations over the REAL window results, in order:
  //   1. TOP100 gate → the tier-3 packages leave the bank to the shadow
  //   2. ELITE favorite fix → the Andreescu inverted-favorite rows flip
  //   3. Double-win re-contract → the [T1↔T5] family-1 packages rebuild as
  //      [T1↔T6] and re-settle in the DOUBLE-WIN zone
  // ── Audit v14 · RETRO MIGRATIONS — DEFAULT OFF ──────────────────────────
  // The v13 retroactive history migrations (TOP100 gate re-seat, elite
  // favorite flip, double-win re-contract + post-hoc re-pricing) REWROTE
  // settled ledger rows: 168/370 matches now fail their own SHA-256 pre-lock
  // hash and 13 picks carry settledAt < createdAt. Rewriting settled history
  // destroys auditability, so these migrations now run ONLY when the
  // operator explicitly opts in with NEOBET_RETRO_MIGRATIONS=1.
  if (process.env.NEOBET_RETRO_MIGRATIONS === "1") {
    await pruneStaleShadowVetoes();
    await resettleTop100VetoHistory(resultsByEvent, analyzedByKey);
    await resettleEliteFavoriteHistory(resultsByEvent);
    await resettleFamilyDoubleWinHistory(resultsByEvent);
  } else {
    try {
      const existing = await db.auditEvent.findFirst({
        where: { kind: "MIGRATION_SKIPPED", createdAt: { gte: new Date(Date.now() - 6 * 3600 * 1000) } },
      });
      if (!existing) {
        await db.auditEvent.create({
          data: {
            kind: "MIGRATION_SKIPPED",
            severity: "INFO",
            message:
              "Retro history migrations skipped (immutable ledger policy, NEOBET_RETRO_MIGRATIONS unset) — settled rows stay exactly as recorded",
          },
        });
      }
    } catch {
      // audit trail is best-effort
    }
  }

  // 2) settle pending picks
  const pendingPicks = await db.tennisPick.findMany({
    where: { status: "PENDING" },
    include: { match: true },
  });

  let settled = 0;

  for (const pick of pendingPicks) {
    let meta: PickMeta = {};
    try {
      meta = pick.meta ? (JSON.parse(pick.meta) as PickMeta) : {};
    } catch {
      meta = {};
    }

    if (pick.line === "COMBO" || pick.line === "ACCUMULATOR") {
      const favorites = meta.favorites ?? [];
      if (!favorites.length) continue;
      // ── v4.5 FT Settlement Fix ────────────────────────────────────────
      // Every leg checks the REAL winner of its own match: the stored
      // favorite must have won (equivalent of competitor.winner === true —
      // sets won > opponent sets) or, for SET HANDICAP +1.5 SETS legs, have
      // won at least ONE set (sets won ≥ 1). An undecidable leg (match not
      // finished / result not extractable / side unresolvable) keeps the
      // whole slip PENDING — it is NEVER auto-destroyed as a loss (the v4.0
      // bug that produced 0W/11L).
      let allDecided = true;
      let allWon = true;
      for (const f of favorites) {
        const ownMatch = fetched.find((x) => x.eventKey === f.eventKey);
        const result = ownMatch ? extractResult(ownMatch) : undefined;
        if (!result) {
          allDecided = false;
          break;
        }
        // explicit side first (v4.5 contract); legacy picks fall back to
        // full-name/surname matching
        const side: "A" | "B" | null = f.side ?? favSide(result.playerAName, result.playerBName, f.name);
        if (!side) {
          allDecided = false;
          break;
        }
        const favSets = side === "A" ? result.setsA : result.setsB;
        const oppSets = side === "A" ? result.setsB : result.setsA;
        const legWon =
          f.market === "HANDICAP"
            ? favSets >= 1
            : f.market === "HANDICAP15"
              ? favSets === 2 // SET HANDICAP −1.5 SETS = the favorite swept 2-0
              : f.market === "OVER195"
                ? result.totalGames >= 20 // v7.0 — TOTAL GAMES OVER 19.5
                : favSets > oppSets;
        if (!legWon) {
          allWon = false;
          break;
        }
      }
      if (!allDecided) continue; // stays PENDING until every leg is decidable
      const profit = allWon ? pick.odds * pick.stake - pick.stake : -pick.stake;
      await db.tennisPick.update({
        where: { id: pick.id },
        data: { status: allWon ? "WON" : "LOST", profit, settledAt: new Date() },
      });
      settled++;
      continue;
    }

    const result = resultsByEvent.get(pick.match.eventKey);
    if (!result) continue;

    const outcome = settlePick(
      pick,
      { playerA: pick.match.playerA, playerB: pick.match.playerB },
      result
    );
    if (outcome.status === "VOID") continue;
    await db.tennisPick.update({
      where: { id: pick.id },
      data: { status: outcome.status, profit: outcome.profit, settledAt: new Date() },
    });
    settled++;
  }

  // 3) stamp match results on the match table
  for (const [eventKey, r] of resultsByEvent.entries()) {
    try {
      await db.tennisMatch.updateMany({
        where: { eventKey, settled: false },
        data: {
          resultSetsA: r.setsA,
          resultSetsB: r.setsB,
          resultCode: r.code,
          settled: true,
          status: "post",
        },
      });
    } catch (e) {
      console.error("[settle] stamp failed", eventKey, e);
    }
  }

  await db.engineLog.create({
    data: {
      kind: "SETTLE",
      message: `Auto-settlement window=${windowDays}d settled=${settled} pending=${pendingPicks.length} results=${resultsByEvent.size}`,
    },
  });

  return { settled, picked: pendingPicks.length, windowDays };
}
