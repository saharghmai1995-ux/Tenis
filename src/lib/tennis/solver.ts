// ─── NeoTennis Markov Quant — Reverse-Odds & Market-Fusion Solver ──────────
// 1) Margin removal from bookmaker odds: Shin model / power method
// 2) Reverse-Markov Implied Serve Solver: grid search on pA, pB ∈ [0.52, 0.76]
// 3) Surface-Weighted Elo fusion: pFinal = 0.65·pMarket + 0.35·pSurfaceElo

import { matchWinProbA } from "./markov";
import type { SolverResult, Surface } from "./types";

// ─── 1 · Margin Removal ────────────────────────────────────────────────────

/** Power method: find γ so that Σ (1/odds_i)^γ = 1, then p_i = (1/odds_i)^γ */
export function powerProbs(odds: number[]): number[] {
  const raw = odds.map((o) => 1 / o);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) < 1e-9) return raw;
  let lo = 0.2;
  let hi = 2.5;
  const total = (g: number) => raw.reduce((a, r) => a + Math.pow(r, g), 0);
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > 1) lo = mid;
    else hi = mid;
  }
  const gamma = (lo + hi) / 2;
  const probs = raw.map((r) => Math.pow(r, gamma));
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / s);
}

/**
 * Shin (1993) model — accounts for insider-trading proportion z.
 * p_i = (√(z² + 4(1−z)·π_i²/S) − z) / (2(1−z)),  Σp_i = 1  (bisection on z)
 */
export function shinProbs(odds: number[]): number[] {
  const raw = odds.map((o) => 1 / o);
  const S = raw.reduce((a, b) => a + b, 0);
  const pi = raw.map((r) => r / S); // normalize to sum 1
  if (Math.abs(S - 1) < 1e-9) return raw;

  const probsAt = (z: number): number[] =>
    pi.map((p) => (Math.sqrt(z * z + 4 * (1 - z) * p * p) - z) / (2 * (1 - z)));

  let lo = 0.0001;
  let hi = 0.35;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    const sum = probsAt(mid).reduce((a, b) => a + b, 0);
    if (sum > 1) lo = mid;
    else hi = mid;
  }
  const z = (lo + hi) / 2;
  const probs = probsAt(z);
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / s);
}

/** Margin-free probabilities with graceful Shin → power fallback. */
export function removeMargin(
  odds: number[],
  preferred: "shin" | "power" = "shin"
): { probs: number[]; method: "shin" | "power" } {
  try {
    const probs = preferred === "shin" ? shinProbs(odds) : powerProbs(odds);
    if (probs.every((p) => p > 0.005 && p < 0.995)) {
      return { probs, method: preferred };
    }
  } catch {
    /* fall through */
  }
  return { probs: powerProbs(odds), method: "power" };
}

// ─── 2 · Surface-Weighted Elo (derived from LIVE ESPN ranking points) ──────
// Elo proxy: E = 1500 + K_surface·log10(points / 650) — a monotone transform
// of the official live ranking points. Equivalent to the standard power-law
// ranking model (Kovalchik 2016 review) with surface-tuned variance:
// grass ⇒ flatter (more upsets), clay ⇒ steeper (grindier).
export const ELO_BASE = 1500;
const ELO_ANCHOR = 650;

const ELO_K: Record<Surface, number> = {
  HARD: 460, // exponent 1.15
  CLAY: 480, // exponent 1.20
  GRASS: 408, // exponent 1.02
};

export function eloKFor(surface: Surface): number {
  return ELO_K[surface];
}

export function eloFromPoints(points: number | undefined, surface: Surface = "HARD"): number {
  const p = Math.max(points ?? 0, 30);
  return ELO_BASE + ELO_K[surface] * Math.log10(p / ELO_ANCHOR);
}

export function eloWinProbA(
  pointsA: number | undefined,
  pointsB: number | undefined,
  surface: Surface
): number {
  const pa = Math.max(pointsA ?? 0, 30);
  const pb = Math.max(pointsB ?? 0, 30);
  // both players outside the points floor → no signal, coin flip
  if (pa <= 30 && pb <= 30) return 0.5;
  const d = (eloFromPoints(pa, surface) - eloFromPoints(pb, surface)) * 1.0;
  const clamped = Math.max(-520, Math.min(520, d));
  const p = 1 / (1 + Math.pow(10, -clamped / 400));
  return Math.max(0.03, Math.min(0.97, p));
}

// ─── 3 · Reverse-Markov Implied Serve Solver ───────────────────────────────
/**
 * Grid search over pA, pB ∈ [0.52, 0.76] (dense 0.002 LUT + local refine)
 * to uncover the serve point-win probabilities the bookmaker's "supercomputer"
 * implicitly priced. Objective: match the margin-free market win probability
 * for player A, with a tiny tie-break penalty pulling (pA − pB) toward the
 * ranking-points-derived spread prior.
 */

// Module-level lazy LUT of matchWinProbA over the grid — universal across
// matches, computed once per process (~0.3s), then every solve is instant.
const GRID_LO = 0.52;
const GRID_HI = 0.76;
const GRID_STEP = 0.002;
const GRID_N = Math.round((GRID_HI - GRID_LO) / GRID_STEP) + 1; // 121
let LUT: Float64Array | null = null;

function ensureLUT(): Float64Array {
  if (LUT) return LUT;
  const t0 = Date.now();
  const table = new Float64Array(GRID_N * GRID_N);
  // evaluate lazily but synchronously; DP cost amortized once per process
  for (let i = 0; i < GRID_N; i++) {
    const pA = GRID_LO + i * GRID_STEP;
    for (let j = 0; j < GRID_N; j++) {
      const pB = GRID_LO + j * GRID_STEP;
      table[i * GRID_N + j] = matchWinProbA(pA, pB);
    }
  }
  LUT = table;
  console.log(`[solver] serve-prob LUT built in ${Date.now() - t0}ms (${GRID_N}×${GRID_N})`);
  return table;
}

export function solveServeProbs(
  targetWinA: number,
  spreadPrior = 0
): SolverResult {
  const table = ensureLUT();
  const objectiveFromWin = (win: number, pA: number, pB: number): number =>
    Math.abs(win - targetWinA) + 0.12 * Math.abs(pA - pB - spreadPrior);

  let best: SolverResult = { pA: 0.62, pB: 0.62, error: Infinity };
  for (let i = 0; i < GRID_N; i++) {
    const pA = GRID_LO + i * GRID_STEP;
    for (let j = 0; j < GRID_N; j++) {
      const pB = GRID_LO + j * GRID_STEP;
      const err = objectiveFromWin(table[i * GRID_N + j], pA, pB);
      if (err < best.error) best = { pA, pB, error: err };
    }
  }
  // local exact refine around the LUT optimum (±3 cells at 0.0005)
  const fine = 0.0005;
  for (let pA = best.pA - 3 * GRID_STEP; pA <= best.pA + 3 * GRID_STEP + 1e-9; pA += fine) {
    for (let pB = best.pB - 3 * GRID_STEP; pB <= best.pB + 3 * GRID_STEP + 1e-9; pB += fine) {
      if (pA < GRID_LO || pA > GRID_HI || pB < GRID_LO || pB > GRID_HI) continue;
      const err = objectiveFromWin(matchWinProbA(pA, pB), pA, pB);
      if (err < best.error) best = { pA, pB, error: err };
    }
  }
  return best;
}

/** Spread prior from live ranking points ratio (log10 scale, clamped). */
export function spreadPriorFromPoints(
  pointsA?: number,
  pointsB?: number
): number {
  if (!pointsA || !pointsB || pointsA <= 0 || pointsB <= 0) return 0;
  const v = 0.035 * Math.log10(pointsA / pointsB);
  return Math.max(-0.06, Math.min(0.06, v));
}

/** Full reverse pipeline for one match. */
export function reverseAnalysis(
  marketProbA: number | undefined,
  pointsA: number | undefined,
  pointsB: number | undefined,
  surface: Surface
): {
  pServeA: number;
  pServeB: number;
  pEloA: number;
  pEloB: number;
  pFinalA: number;
  pFinalB: number;
  eloWinA: number;
  marketProbA?: number;
  marketGap: boolean;
  method: "shin" | "power";
} {
  const eloWinA = eloWinProbA(pointsA, pointsB, surface);
  const spread = spreadPriorFromPoints(pointsA, pointsB);

  // Elo-side serve probs: reverse-solve from the Elo win probability
  const eloSolved = solveServeProbs(eloWinA, spread);

  if (
    marketProbA === undefined ||
    !Number.isFinite(marketProbA) ||
    marketProbA <= 0.01 ||
    marketProbA >= 0.99
  ) {
    // Market gap → surface Elo carries the full weight (honest fallback)
    return {
      pServeA: eloSolved.pA,
      pServeB: eloSolved.pB,
      pEloA: eloSolved.pA,
      pEloB: eloSolved.pB,
      pFinalA: eloSolved.pA,
      pFinalB: eloSolved.pB,
      eloWinA,
      marketGap: true,
      method: "shin",
    };
  }

  const marketSolved = solveServeProbs(marketProbA, spread);
  return {
    pServeA: marketSolved.pA,
    pServeB: marketSolved.pB,
    pEloA: eloSolved.pA,
    pEloB: eloSolved.pB,
    // 65% market + 35% surface-weighted Elo — doc formula
    pFinalA: 0.65 * marketSolved.pA + 0.35 * eloSolved.pA,
    pFinalB: 0.65 * marketSolved.pB + 0.35 * eloSolved.pB,
    eloWinA,
    marketProbA,
    marketGap: false,
    method: "shin",
  };
}
