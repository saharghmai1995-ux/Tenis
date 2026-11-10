// ─── NeoTennis Markov Quant — Reverse-Odds & Market-Fusion Solver ──────────
// 1) Margin removal from bookmaker odds: Shin model / power method
// 2) Reverse-Markov Implied Serve Solver: grid search on pA, pB ∈ [0.52, 0.76]
// 3) Surface-Weighted Elo fusion: pFinal = 0.65·pMarket + 0.35·pSurfaceElo

import { matchWinProbA } from "./markov";
import type { SolverResult, Surface, Tour } from "./types";

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
  surface: Surface,
  tour: Tour = "ATP"
): {
  pServeA: number;
  pServeB: number;
  pEloA: number;
  pEloB: number;
  pFinalA: number;
  pFinalB: number;
  pRawA: number;
  pRawB: number;
  eloWinA: number;
  marketProbA?: number;
  marketGap: boolean;
  method: "shin" | "power";
} {
  const eloWinA = eloWinProbA(pointsA, pointsB, surface);
  const spread = spreadPriorFromPoints(pointsA, pointsB);

  // Elo-side serve probs: reverse-solve from the Elo win probability
  const eloSolved = solveServeProbs(eloWinA, spread);

  let pRawA: number;
  let pRawB: number;
  let marketSolved: SolverResult | null = null;
  let marketGap: boolean;
  let marketProbOut: number | undefined;
  const method: "shin" | "power" = "shin";

  if (
    marketProbA === undefined ||
    !Number.isFinite(marketProbA) ||
    marketProbA <= 0.01 ||
    marketProbA >= 0.99
  ) {
    // Market gap → surface Elo carries the full weight (honest fallback)
    pRawA = eloSolved.pA;
    pRawB = eloSolved.pB;
    marketGap = true;
  } else {
    marketSolved = solveServeProbs(marketProbA, spread);
    pRawA = 0.65 * marketSolved.pA + 0.35 * eloSolved.pA;
    pRawB = 0.65 * marketSolved.pB + 0.35 * eloSolved.pB;
    marketProbOut = marketProbA;
    marketGap = false;
  }

  // v2.0 — Kovalchik tour-average calibration (fixes the v1.0 inflation
  // where both players were priced above 94% hold)
  const cal = calibrateServePair(pRawA, pRawB, tour, surface);

  return {
    // market-implied serve pair when available, Elo solve otherwise (display)
    pServeA: marketSolved ? marketSolved.pA : eloSolved.pA,
    pServeB: marketSolved ? marketSolved.pB : eloSolved.pB,
    pEloA: eloSolved.pA,
    pEloB: eloSolved.pB,
    pFinalA: cal.pA,
    pFinalB: cal.pB,
    pRawA,
    pRawB,
    eloWinA,
    marketProbA: marketProbOut,
    marketGap,
    method,
  };
}

// ─── 4 · v2.0 Kovalchik-2016 Tour Calibration ──────────────────────────────
/**
 * Re-centers the solved serve-point probabilities on the real ATP/WTA tour
 * baselines (Kovalchik 2016: ATP hard ≈ 0.64, clay ≈ 0.61, grass ≈ 0.67;
 * WTA ≈ 0.58) and clamps the pair into physically realistic bounds, so a
 * clear favorite lands in p ∈ [0.65, 0.72] with the opponent in [0.56, 0.63]
 * instead of the v1.0 inflation (both holds > 94%).
 */
export const TOUR_SURFACE_BASE: Record<Tour, Record<Surface, number>> = {
  ATP: { HARD: 0.64, CLAY: 0.61, GRASS: 0.67 },
  WTA: { HARD: 0.585, CLAY: 0.575, GRASS: 0.605 },
};

/** Per-side realistic bounds (favorite / underdog) per tour & surface. */
const SIDE_BOUNDS: Record<
  Tour,
  Record<Surface, { favMin: number; favMax: number; dogMin: number; dogMax: number; muSlack: number }>
> = {
  ATP: {
    HARD: { favMin: 0.6, favMax: 0.72, dogMin: 0.545, dogMax: 0.665, muSlack: 0.025 },
    CLAY: { favMin: 0.585, favMax: 0.7, dogMin: 0.535, dogMax: 0.635, muSlack: 0.025 },
    GRASS: { favMin: 0.615, favMax: 0.735, dogMin: 0.555, dogMax: 0.695, muSlack: 0.025 },
  },
  WTA: {
    HARD: { favMin: 0.565, favMax: 0.685, dogMin: 0.52, dogMax: 0.61, muSlack: 0.025 },
    CLAY: { favMin: 0.555, favMax: 0.675, dogMin: 0.51, dogMax: 0.6, muSlack: 0.025 },
    GRASS: { favMin: 0.58, favMax: 0.7, dogMin: 0.525, dogMax: 0.63, muSlack: 0.025 },
  },
};

/** Maximum realistic serve-quality spread on tour (Kovalchik 2016 domain). */
const MAX_SPREAD = 0.16;

export function calibrateServePair(
  pA: number,
  pB: number,
  tour: Tour,
  surface: Surface
): { pA: number; pB: number } {
  const base = TOUR_SURFACE_BASE[tour][surface];
  const b = SIDE_BOUNDS[tour][surface];

  const muRaw = (pA + pB) / 2;
  const dRaw = Math.abs(pA - pB);

  // 1) blend the raw level toward the tour baseline (55% baseline pull)
  const muBlend = 0.45 * muRaw + 0.55 * base;
  const mu = Math.max(base - b.muSlack, Math.min(base + b.muSlack, muBlend));

  // 2) cap the spread at the calibrated tour maximum
  const d = Math.min(dRaw, MAX_SPREAD);

  // 3) enforce per-side realistic bounds (favorite gets the higher half)
  const fav = Math.max(b.favMin, Math.min(b.favMax, mu + d / 2));
  const dog = Math.max(b.dogMin, Math.min(b.dogMax, mu - d / 2));

  return pA >= pB ? { pA: fav, pB: dog } : { pA: dog, pB: fav };
}
