// ─── NeoTennis Markov Quant — 4-Layer Discrete Markov Chain Engine ─────────
// Hierarchy:  Point → Game → Set → Match   (no draws in tennis)
// Reference: Standard tennis Markov equations + Kovalchik (2016)

import type { ArchMetrics, MatchJointCell, ResultCode, SetJointCell } from "./types";

// ─── Layer 1 · Closed-form Service-Game Hold Probability G(p) ──────────────
/**
 * Probability that the server wins his own service game, given the
 * point-win probability on serve p.
 *   G(p) = p^4·(1+4q+10q²) + [20·p³·q³ / (1−2pq)]·p²
 */
export function gameWinProb(p: number): number {
  const q = 1 - p;
  const deuceProb = (20 * Math.pow(p, 3) * Math.pow(q, 3)) / (1 - 2 * p * q);
  return Math.pow(p, 4) * (1 + 4 * q + 10 * q * q) + deuceProb * (p * p);
}

// ─── Tie-Break Markov (7-point, win-by-2, ATP serve rotation 1-2-2-…) ──────
/**
 * Probability player A wins the tiebreak given point-win probs on serve.
 * Serve pattern: A serves point 1, then pairs alternate (B, B, A, A, B, B, …).
 * Solved as a bounded absorbing lattice (deuce loop capped at 25-25, whose
 * residual mass is < 1e-13 and renormalized).
 */
const TB_CAP = 26;
export function tieBreakWinProb(pA: number, pB: number): number {
  const dp: number[][] = Array.from({ length: TB_CAP }, () =>
    new Array(TB_CAP).fill(0)
  );
  const serveA = (a: number, b: number): boolean => {
    const n = a + b + 1; // 1-indexed point number
    // point 1 → A serves; afterwards floor((n-2)/2) even → B, odd → A
    return n === 1 ? true : Math.floor((n - 2) / 2) % 2 === 1;
  };
  // iterate in decreasing total-points order
  for (let sum = 2 * TB_CAP - 2; sum >= 0; sum--) {
    for (let a = 0; a <= Math.min(sum, TB_CAP - 1); a++) {
      const b = sum - a;
      if (b > TB_CAP - 1 || b < 0) continue;
      if (a >= 7 && a - b >= 2) {
        dp[a][b] = 1;
        continue;
      }
      if (b >= 7 && b - a >= 2) {
        dp[a][b] = 0;
        continue;
      }
      const p = serveA(a, b) ? pA : 1 - pB;
      const nextA = a + 1 < TB_CAP ? dp[a + 1][b] : 0.5; // boundary residue ≈ 0
      const nextB = b + 1 < TB_CAP ? dp[a][b + 1] : 0.5;
      dp[a][b] = p * nextA + (1 - p) * nextB;
    }
  }
  const raw = dp[0][0];
  // renormalize against the absorbed mass at the two terminal families
  return raw;
}

// ─── Layer 2 · Set Markov Matrix (games 0..7 incl. 6-6 tiebreak) ───────────
type SetDP = {
  winA: number; // probability A wins the set
  joint: SetJointCell[]; // joint distribution of terminal (gamesA, gamesB)
};

/**
 * Exact set solver via dynamic programming over game states.
 * firstServer: which player serves the first game of the set ("A" | "B").
 * Game n (0-indexed) is served by the firstServer player when n is even.
 */
export function solveSet(gA: number, gB: number, firstServer: "A" | "B"): SetDP {
  const tb = tieBreakWinProb(gA, gB);
  // memo of winA probabilities per state
  const memoW = new Map<number, number>();
  const win = (i: number, j: number): number => {
    if (i === 6 && j <= 4) return 1;
    if (j === 6 && i <= 4) return 0;
    if (i === 7) return 1;
    if (j === 7) return 0;
    if (i === 6 && j === 6) return tb;
    const key = i * 10 + j;
    const hit = memoW.get(key);
    if (hit !== undefined) return hit;
    const n = i + j;
    const aServes = firstServer === "A" ? n % 2 === 0 : n % 2 === 1;
    const w = aServes ? gA : 1 - gB; // prob A wins the next game
    const v = w * win(i + 1, j) + (1 - w) * win(i, j + 1);
    memoW.set(key, v);
    return v;
  };

  // Forward pass for the joint terminal distribution
  const grid = new Map<number, number>();
  grid.set(0, 1); // key = i*10+j
  const joint: SetJointCell[] = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const key = i * 10 + j;
      const p = grid.get(key);
      if (!p || p <= 0) continue;
      const terminal =
        (i === 6 && j <= 4) ||
        (j === 6 && i <= 4) ||
        (i === 6 && j === 6) ||
        (i === 7 || j === 7);
      if (terminal) {
        // resolve 6-6 through the tiebreak split
        if (i === 6 && j === 6) {
          joint.push({ gamesA: 7, gamesB: 6, prob: p * tb, tiebreak: true });
          joint.push({ gamesA: 6, gamesB: 7, prob: p * (1 - tb), tiebreak: true });
        } else {
          joint.push({ gamesA: i, gamesB: j, prob: p, tiebreak: false });
        }
        continue;
      }
      const n = i + j;
      const aServes = firstServer === "A" ? n % 2 === 0 : n % 2 === 1;
      const w = aServes ? gA : 1 - gB;
      grid.set((i + 1) * 10 + j, (grid.get((i + 1) * 10 + j) ?? 0) + p * w);
      grid.set(i * 10 + (j + 1), (grid.get(i * 10 + (j + 1)) ?? 0) + p * (1 - w));
    }
  }
  // states (7,5) and (5,7) terminate via the i===7 / j===7 rule in forward loop
  for (let i = 0; i <= 7; i++) {
    for (let j = 0; j <= 7; j++) {
      const key = i * 10 + j;
      const p = grid.get(key);
      if (!p || p <= 0) continue;
      if ((i === 7 && j <= 5) || (j === 7 && i <= 5)) {
        joint.push({ gamesA: i, gamesB: j, prob: p, tiebreak: false });
      }
    }
  }

  return { winA: win(0, 0), joint };
}

// ─── Layer 3 · Best-of-3 exact four-outcome decomposition ──────────────────
export function bo3Outcomes(setWinA: number): {
  p20: number;
  p21: number;
  p12: number;
  p02: number;
} {
  const s = setWinA;
  const r = 1 - s;
  return {
    p20: s * s,
    p21: 2 * s * s * r,
    p12: 2 * r * r * s,
    p02: r * r,
  };
}

// ─── Match-level joint distribution (outcome × total games × set-1 winner) ─
// Set serve order alternates: set1 A-first, set2 B-first, set3 A-first
// (assumes player A won the racket toss — documented engine assumption).
const MAX_GAMES = 42;

export function matchJointDist(
  gA: number,
  gB: number
): { cells: MatchJointCell[]; dist: Map<ResultCode, number[]> } {
  const D1 = solveSet(gA, gB, "A").joint;
  const D2 = solveSet(gA, gB, "B").joint;
  const D3 = D1;
  // bucket key: code | total games | margin | set-1 winner — keeps the set-1
  // orientation needed by the v2.0 archetype coverage mathematics AND the
  // v4.0 game-margin (handicap) orientation
  const buckets = new Map<
    string,
    { code: ResultCode; games: number; margin: number; set1A: boolean; prob: number }
  >();

  const add = (
    code: ResultCode,
    games: number,
    margin: number,
    set1A: boolean,
    prob: number
  ) => {
    const key = `${code}|${games}|${margin}|${set1A ? "A" : "B"}`;
    const cell = buckets.get(key);
    if (cell) cell.prob += prob;
    else buckets.set(key, { code, games, margin, set1A, prob });
  };

  for (const t1 of D1) {
    const w1A = t1.gamesA > t1.gamesB;
    const sa1 = w1A ? 1 : 0;
    const sb1 = w1A ? 0 : 1;
    const m1 = t1.gamesA - t1.gamesB;
    // set 2
    for (const t2 of D2) {
      const w2A = t2.gamesA > t2.gamesB;
      const sa2 = sa1 + (w2A ? 1 : 0);
      const sb2 = sb1 + (w2A ? 0 : 1);
      const p12 = t1.prob * t2.prob;
      const g12 = t1.gamesA + t1.gamesB + t2.gamesA + t2.gamesB;
      const m12 = m1 + (t2.gamesA - t2.gamesB);
      if (sa2 === 2) {
        add("2-0", g12, m12, w1A, p12);
        continue;
      }
      if (sb2 === 2) {
        add("0-2", g12, m12, w1A, p12);
        continue;
      }
      // set 3 decides
      for (const t3 of D3) {
        const w3A = t3.gamesA > t3.gamesB;
        const code: ResultCode = w3A ? "2-1" : "1-2";
        add(code, g12 + t3.gamesA + t3.gamesB, m12 + (t3.gamesA - t3.gamesB), w1A, p12 * t3.prob);
      }
    }
  }

  const cells: MatchJointCell[] = [];
  const dist = new Map<ResultCode, number[]>();
  for (const cell of buckets.values()) {
    cells.push({
      code: cell.code,
      games: [cell.games],
      prob: cell.prob,
      set1A: cell.set1A,
      margin: cell.margin,
    });
    let arr = dist.get(cell.code);
    if (!arr) {
      arr = new Array(MAX_GAMES + 1).fill(0);
      dist.set(cell.code, arr);
    }
    if (cell.games <= MAX_GAMES) arr[cell.games] += cell.prob;
  }
  return { cells, dist };
}

// ─── v2.0 · Exact archetype metrics from the joint Bo3 distribution ────────
/**
 * Computes every quantity the 3-archetype supervisor needs, directly from the
 * exact terminal-path distribution (outcome × total games × margin × set-1
 * winner). All outputs are favorite-oriented (`fav` side).
 *
 * v4.0 uncovered (simultaneous-loss) spaces of the official atomic legs:
 *  · ARCH1 — Set Betting Fav 2-0 ∪ Total Sets O2.5 → uncovered = underdog 2-0.
 *  · ARCH2 — Set Betting P1 2-0 ∪ Set Betting P1 2-1 → uncovered = player 1
 *            loses the match (the two legs cover 100% of P1's win paths).
 *  · ARCH3 — Total Games O22.5 ∪ Game Handicap Fav −4.5 → uncovered =
 *            match ends ≤ 22 total games AND favorite does not win by ≥ 5.
 */
export function archetypeMetrics(
  cells: MatchJointCell[],
  set1WinA: number, // exact P(A wins set 1) from the set-1 DP (A serves first)
  fav: "A" | "B"
): ArchMetrics {
  const favIsA = fav === "A";
  const totalProb = cells.reduce((s, c) => s + c.prob, 0);
  const norm = totalProb > 0 ? totalProb : 1;

  let favWinOver195 = 0;
  let fav20Under195 = 0;
  let fav20Under225 = 0;
  let dogSet1 = 0;
  let over225 = 0;
  let fav20Margin5 = 0;
  let pairLoss3 = 0;

  for (const c of cells) {
    const g = c.games[0] ?? 0;
    const p = c.prob / norm;
    const favWonMatch = favIsA
      ? c.code === "2-0" || c.code === "2-1"
      : c.code === "0-2" || c.code === "1-2";
    const favWon20 = favIsA ? c.code === "2-0" : c.code === "0-2";
    const favMargin = favIsA ? c.margin : -c.margin;
    const set1WonByFav = c.set1A === favIsA;

    if (favWonMatch && g >= 20) favWinOver195 += p;
    if (favWon20 && g <= 19) fav20Under195 += p;
    if (favWon20 && g <= 22) fav20Under225 += p;
    if (!set1WonByFav) dogSet1 += p;
    if (g >= 23) over225 += p;
    if (favWonMatch && favMargin >= 5) fav20Margin5 += p;
    // ARCH3 pair loss (v4.0): both atomic legs lose when the match ends in
    // ≤ 22 total games AND the favorite does not win by a ≥ 5-game margin
    if (g <= 22 && !(favWonMatch && favMargin >= 5)) pairLoss3 += p;
  }

  // ARCH1 pair loss = underdog 2-0 (straight-set sweep of the favorite)
  const pairLoss1 =
    cells
      .filter((c) => (favIsA ? c.code === "0-2" : c.code === "2-0"))
      .reduce((s, c) => s + c.prob, 0) / norm;

  // v4.0 ARCH2 pair loss = the two Set Betting legs (P1 2-0 + P1 2-1) cover
  // 100% of player-1's win paths, so the uncovered space is P1 losing the match
  const pairLoss2 =
    cells
      .filter((c) => (favIsA ? c.code === "0-2" || c.code === "1-2" : c.code === "2-0" || c.code === "2-1"))
      .reduce((s, c) => s + c.prob, 0) / norm;

  return {
    set1Fav: favIsA ? set1WinA : 1 - set1WinA,
    favWinOver195,
    fav20Under195,
    dogSet1,
    over225,
    fav20Under225,
    fav20Margin5,
    pairLoss1,
    pairLoss2,
    pairLoss3,
  };
}

// ─── v4.0 · Exact Break-Point-Saved % (i.i.d. point-model DP) ──────────────
/**
 * Expected share of break points SAVED (server goes on to hold the game)
 * for a server who wins each point on serve with probability p.
 * Computed exactly with a game-state DP:
 *   · backward pass — P(hold | state (s,r)) with the closed-form deuce value
 *     D = p²/(p²+q²); break-point states are (0-3), (1-3), (2-3) and the
 *     advantage-returner state (3-4);
 *   · forward pass — arrival mass of every state, with the deuce sub-chain
 *     (3-3 → adv states ⇄ deuce) solved in closed form;
 *   · BPS = Σ arrival × P(hold | that BP state) / Σ arrival.
 */
export function breakPointSavedProb(p: number): number {
  const q = 1 - p;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const D = (p * p) / (p * p + q * q); // P(server wins game from deuce)

  const memo = new Map<number, number>();
  const holdFrom = (s: number, r: number): number => {
    if (s >= 4 && s - r >= 2) return 1; // game won
    if (r >= 4 && r - s >= 2) return 0; // game lost (broken)
    if ((s === 3 && r === 3) || (s === 4 && r === 4)) return D; // deuce
    const k = s * 10 + r;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const winNext = s + 1 >= 4 && s + 1 - r >= 2 ? 1 : holdFrom(Math.min(s + 1, 4), r);
    const loseNext = r + 1 >= 4 && r + 1 - s >= 2 ? 0 : holdFrom(s, Math.min(r + 1, 4));
    const v = p * winNext + q * loseNext;
    memo.set(k, v);
    return v;
  };

  // forward arrival mass (states only grow s+r → process in ascending order)
  const arrive = new Map<number, number>();
  arrive.set(0, 1); // (0,0)
  const isDeuce = (s: number, r: number) => (s === 3 && r === 3) || (s === 4 && r === 4);
  for (let sum = 0; sum <= 8; sum++) {
    for (let s = 0; s <= Math.min(sum, 4); s++) {
      const r = sum - s;
      if (r < 0 || r > 4) continue;
      if (s >= 4 && s - r >= 2) continue; // absorbed hold
      if (r >= 4 && r - s >= 2) continue; // absorbed break
      if (isDeuce(s, r)) continue; // deuce sub-chain handled in closed form
      const m = arrive.get(s * 10 + r);
      if (!m) continue;
      const winAbsorb = s + 1 >= 4 && s + 1 - r >= 2;
      const loseAbsorb = r + 1 >= 4 && r + 1 - s >= 2;
      if (!winAbsorb) {
        const k = Math.min(s + 1, 4) * 10 + r;
        arrive.set(k, (arrive.get(k) ?? 0) + m * p);
      }
      if (!loseAbsorb) {
        const k = s * 10 + Math.min(r + 1, 4);
        arrive.set(k, (arrive.get(k) ?? 0) + m * q);
      }
    }
  }

  // deuce sub-chain — x = arrival mass entering 3-3
  const x = arrive.get(33) ?? 0;
  const m44 = (2 * x * p * q) / (1 - 2 * p * q);
  const m43 = p * (x + m44); // advantage server
  const m34 = q * (x + m44); // advantage returner — an official break point

  const bpArrival =
    (arrive.get(3) ?? 0) + // (0,3)
    (arrive.get(13) ?? 0) + // (1,3)
    (arrive.get(23) ?? 0) + // (2,3)
    m34;
  if (bpArrival <= 1e-9) return 1; // no break point ever faced — vacuously saved

  const saved =
    (arrive.get(3) ?? 0) * holdFrom(0, 3) +
    (arrive.get(13) ?? 0) * holdFrom(1, 3) +
    (arrive.get(23) ?? 0) * holdFrom(2, 3) +
    m34 * holdFrom(3, 4);
  return saved / bpArrival;
}

// ─── Full Engine Pipeline: serve probs → all derived quantities ────────────
export interface FullMarkov {
  gA: number;
  gB: number;
  setWinA: number;
  ou95: number;
  tb1: number;
  over105Set1: number;
  p20: number;
  p21: number;
  p12: number;
  p02: number;
  ou215: number;
  slipBCombined: number;
  /** v4.0 — exact expected Break-Point-Saved % per server */
  bpsA: number;
  bpsB: number;
  arch: ArchMetrics; // v2.0 — favorite-oriented archetype coverage metrics
}

export function fullMarkov(pA: number, pB: number): FullMarkov {
  const gA = gameWinProb(pA);
  const gB = gameWinProb(pB);

  // Layer 2 — set solve, average over both serve orders
  const sA = solveSet(gA, gB, "A");
  const sB = solveSet(gA, gB, "B");
  const setWinA = (sA.winA + sB.winA) / 2;

  // Set-1 metrics (set 1 starts with A serving)
  const set1 = sA.joint;
  let ou95 = 0;
  let tb1 = 0;
  let over105 = 0;
  let s1Prob = 0;
  for (const c of set1) {
    s1Prob += c.prob;
    if (c.gamesA + c.gamesB >= 10) ou95 += c.prob;
    if (c.gamesA + c.gamesB >= 11) over105 += c.prob;
    if (c.tiebreak) tb1 += c.prob;
  }
  // renormalize (guard numerical residue)
  const n = s1Prob > 0 ? s1Prob : 1;

  // Layer 3 — doc formulas
  const bo3 = bo3Outcomes(setWinA);

  // Match-level games distribution (with set-1 winner orientation)
  const { cells, dist } = matchJointDist(gA, gB);
  let over215 = 0;
  let slipBCombined = 0;
  for (const [code, arr] of dist.entries()) {
    for (let g = 0; g <= MAX_GAMES; g++) {
      if (arr[g] <= 0) continue;
      if (g >= 22) over215 += arr[g];
      // +1.5 sets underdog (underdog takes at least one set: 2-1 or 1-2) AND over 20.5 games
      if ((code === "2-1" || code === "1-2") && g >= 21) slipBCombined += arr[g];
    }
  }

  // v2.0 — exact archetype metrics for the model favorite
  const fav: "A" | "B" = pA >= pB ? "A" : "B";
  const arch = archetypeMetrics(cells, sA.winA, fav);

  return {
    gA,
    gB,
    setWinA,
    ou95: ou95 / n,
    tb1: tb1 / n,
    over105Set1: over105 / n,
    p20: bo3.p20,
    p21: bo3.p21,
    p12: bo3.p12,
    p02: bo3.p02,
    ou215: over215,
    slipBCombined,
    bpsA: breakPointSavedProb(pA),
    bpsB: breakPointSavedProb(pB),
    arch,
  };
}

// Match win probability for player A (Bo3), used by the reverse solver
export function matchWinProbA(pA: number, pB: number): number {
  const gA = gameWinProb(pA);
  const gB = gameWinProb(pB);
  const s =
    (solveSet(gA, gB, "A").winA + solveSet(gA, gB, "B").winA) / 2;
  return s * s + 2 * s * s * (1 - s);
}
