// ─── NeoTennis Markov Quant v2.0 — 7-Day Auto-Settlement Engine ────────────
// Finished matches (status: post) within the last 7 days are read from the
// ESPN ?dates=YYYYMMDD endpoint, sets-won are counted from linescores, and
// every pick (DUAL / COMBO / SNIPER / SHADOW) is settled against the
// pre-match SHA-256 lock stored in the ledger.
// v2.0: adds the 3-archetype legs (A-O195 / B-ALT / A-O225 / B-U225) and a
// hard validity guard so retired/partial linescores can never settle a pick.

import { db } from "@/lib/db";
import { fetchScoreboard, dateKeyDaysAgo, todayKey } from "./espn";
import type { EspnMatch, ResultCode, Tour } from "./types";

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
  /** v4.5/v5.0 — leg market: SET HANDICAP ±1.5 SETS or MATCH WINNER */
  market?: "HANDICAP" | "WINNER" | "HANDICAP15";
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
}

function codeOf(setsA: number, setsB: number): ResultCode {
  return `${setsA}-${setsB}` as ResultCode;
}

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
  const side = favSide(match.playerA, match.playerB, meta.favName);
  const profitOf = (won: boolean) => (won ? (pick.odds - 1) * pick.stake : -pick.stake);

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
    if (pick.leg === "B-O205") {
      const covered = result.code === "2-1" || result.code === "1-2";
      if (!covered) return { status: "LOST", profit: profitOf(false) };
      const won = result.totalGames >= 21;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    return { status: "VOID", profit: 0 };
  }

  // ── v5.0 · regime markets (BANKER / REGCOMBO / CLUSTER) ──────────────────
  if (pick.line === "BANKER" || pick.line === "REGCOMBO" || pick.line === "CLUSTER") {
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
    const total = result.totalGames;

    // 🔗 CLUSTER — exact scenario: set-score code + total-games band
    if (pick.line === "CLUSTER") {
      const target = meta.code as ResultCode | undefined;
      if (!target) return { status: "VOID", profit: 0 };
      const lo = meta.gamesLo ?? 12;
      const hi = meta.gamesHi ?? 42;
      const won = result.code === target && total >= lo && total <= hi;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }

    // 🏦 BANKER — MATCH WINNER (BNK-WIN) or SET HANDICAP −1.5 (BNK-SH15)
    if (pick.line === "BANKER") {
      const leg = pick.leg;
      if (leg === "BNK-WIN") {
        return { status: favWonMatch ? "WON" : "LOST", profit: profitOf(favWonMatch) };
      }
      if (leg === "BNK-SH15") {
        return { status: favWon20 ? "WON" : "LOST", profit: profitOf(favWon20) };
      }
      return { status: "VOID", profit: 0 };
    }

    // 🧩 REGCOMBO — copula combo (main) + official cover leg
    if (pick.line === "REGCOMBO") {
      const variant = meta.variant ?? (pick.leg.endsWith("SRV") ? "SRV" : "DOM");
      const isMain = pick.leg.includes("MAIN");
      if (variant === "DOM") {
        // main: favorite win & under 21.5 games · cover: over 21.5 games
        const won = isMain ? favWonMatch && total <= 21 : total >= 22;
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

export async function runSettlement(windowDays = 7): Promise<{
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
