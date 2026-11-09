// ─── NeoTennis Markov Quant — 72h Auto-Settlement Engine ───────────────────
// Finished matches (status: post) within the last 72h are read from the ESPN
// ?dates=YYYYMMDD endpoint, sets-won are counted from linescores, and every
// pick (DUAL / COMBO / SNIPER / SHADOW) is settled against the pre-match
// SHA-256 lock stored in the ledger.

import { db } from "@/lib/db";
import { fetchScoreboard, dateKeyDaysAgo, todayKey } from "./espn";
import type { EspnMatch, ResultCode, Tour } from "./types";

export interface MatchResult {
  eventKey: string;
  setsA: number;
  setsB: number;
  totalGames: number;
  code: ResultCode;
  set1Games: { a: number; b: number; tiebreak: boolean };
  playerAName: string;
  playerBName: string;
}

interface PickMeta {
  kind?: string;
  snipeKind?: string;
  favName?: string;
  dogName?: string;
  eventKey?: string;
  favorites?: { name: string; eventKey: string }[];
  size?: number;
}

function codeOf(setsA: number, setsB: number): ResultCode {
  return `${setsA}-${setsB}` as ResultCode;
}

function extractResult(m: EspnMatch): MatchResult | null {
  if (m.state !== "post") return null;
  const lsA = m.playerA.linescores;
  const lsB = m.playerB.linescores;
  if (!lsA.length || lsA.length !== lsB.length) return null;

  const setsA = lsA.filter((l) => l.winner === true).length;
  const setsB = lsB.filter((l) => l.winner === true).length;
  const totalGames = lsA.reduce((s, l) => s + l.value, 0) + lsB.reduce((s, l) => s + l.value, 0);
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

  return {
    eventKey: m.eventKey,
    setsA: a,
    setsB: b,
    totalGames,
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
    if (pick.leg === "A") {
      const won = side === "A" ? result.code === "2-0" : side === "B" ? result.code === "0-2" : false;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    // leg B — covers both 2-1 and 1-2 regardless of favorite side
    const covered = result.code === "2-1" || result.code === "1-2";
    if (!covered) return { status: "LOST", profit: profitOf(false) };
    if (pick.leg === "B-O205") {
      const won = result.totalGames >= 21;
      return { status: won ? "WON" : "LOST", profit: profitOf(won) };
    }
    return { status: "WON", profit: profitOf(true) };
  }

  if (pick.line === "SNIPER") {
    const kind = meta.snipeKind;
    if (kind === "comeback") {
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
    return { status: "VOID", profit: 0 };
  }

  return { status: "VOID", profit: 0 };
}

export async function runSettlement(windowDays = 3): Promise<{
  settled: number;
  picked: number;
  windowDays: number;
}> {
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

    if (pick.line === "COMBO") {
      const favorites = meta.favorites ?? [];
      if (!favorites.length) continue;
      let allWon = true;
      for (const f of favorites) {
        const ownMatch = fetched.find((x) => x.eventKey === f.eventKey);
        const result = ownMatch ? extractResult(ownMatch) : undefined;
        if (!result) {
          allWon = false;
          break;
        }
        const side = favSide(result.playerAName, result.playerBName, f.name);
        const won =
          side === "A"
            ? result.code === "2-0" || result.code === "2-1"
            : side === "B"
              ? result.code === "0-2" || result.code === "1-2"
              : false;
        if (!won) {
          allWon = false;
          break;
        }
      }
      const profit = allWon ? (pick.odds - 1) * pick.stake : -pick.stake;
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
