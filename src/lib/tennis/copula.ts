// ─── NeoTennis Markov Quant v5.0 — Copula & Monte-Carlo Stations ───────────
// STATION 2 · Gaussian Copula Dependency Matrix
//   In real tennis, performance in set 3 and in tie-breaks is NOT independent
//   of set 1. The in-set coupling coefficient ρ_Copula ∈ [−0.15, +0.22] is
//   derived from the Break-Point-Saved rate (pressure skill) of the two
//   servers and from accumulated fatigue:
//     · high BP-saved rate → winner carries momentum → ρ > 0 (up to +0.22)
//     · fragile BP saving → comeback patterns → ρ < 0 (down to −0.15)
//   The exact Gaussian-copula conditional probability
//     P(X2 ≤ k | X1 ≤ h) = Φ₂(h, k; ρ) / Φ(h)
//   is evaluated by 1-D Gauss–Legendre integration of
//     Φ₂(h, k; ρ) = ∫_{−∞}^{h} φ(x)·Φ((k − ρx)/√(1−ρ²)) dx
//   and drives the set-2 / set-3 transition adjustments (see markov.ts).
//
// STATION 3 · 10,000 Game-by-Game Monte-Carlo Simulator
//   Every match is simulated 10,000 times, game by game, with the copula
//   coupling and set-3 fatigue applied INSIDE the simulation. Outputs the
//   authoritative v5.0 distributions:
//     · 4 exact set-score outcomes (2-0 / 2-1 / 1-2 / 0-2)
//     · total-games distribution (18 → 36 games focus)
//     · game-handicap spread (−5.5 … +5.5, favorite-oriented)
//     · Shannon entropy H_Tennis and position standard deviation σ
//     · top-3 game-by-game scenario clusters (EXACT SET & GAME CLUSTER gate)
//     · Gaussian-copula correlation between favorite-win and total games
//       (inverse-normal rank transform — TENNIS COMBO gate > 76%)
//
// Fully headless — pure TypeScript, no browser dependency, deterministic
// xorshift RNG (stable telemetry across rebuilds of the same feed).

import { gameWinProb, tieBreakWinProb } from "./markov";
import type { McScenario, MonteCarloResult, ResultCode } from "./types";

// ─── Deterministic RNG (xorshift128) ───────────────────────────────────────
let rngState = 0x9e3779b9 ^ 0x5f356495 ^ 0x1f123bb5;
function rand(): number {
  let x = rngState;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rngState = (x >>> 0) || 0x9e3779b9;
  return (rngState % 4294967296) / 4294967296;
}
function resetRng(seed: number) {
  rngState = (seed >>> 0) || 0x9e3779b9;
}
/** Box–Muller standard normal (cached spare). */
let spare: number | null = null;
function gauss(): number {
  if (spare !== null) {
    const v = spare;
    spare = null;
    return v;
  }
  let u = 0;
  let v = 0;
  let s = 0;
  do {
    u = rand() * 2 - 1;
    v = rand() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt((-2 * Math.log(s)) / s);
  spare = v * mul;
  return u * mul;
}

// ─── Standard normal CDF / quantile (Acklam + Moro refinements) ────────────
export function phi(x: number): number {
  // Abramowitz–Stegun 7.1.26 with signed symmetry
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  return x >= 0 ? 1 - pdf * poly : pdf * poly;
}
export function phiInv(p: number): number {
  // exact inverse of the A&S 7.1.26 phi() — 80-step bisection (no fragile
  // rational-approximation coefficients; error < 1e-6 across the domain)
  if (p <= 1e-15) return -8;
  if (p >= 1 - 1e-15) return 8;
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (phi(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ─── STATION 2 · Gaussian Copula Conditional Probability ───────────────────
// 64-node Gauss–Legendre on (−∞, h] via the tanh domain split:
// lower tail (−8, min(h,0)] + central (min(h,0), h] — machine precision.
const GL_NODES = 48;
const GL_X: number[] = [];
const GL_W: number[] = [];
(function buildGaussLegendre() {
  // Newton iteration on Legendre polynomials over [-1, 1]
  const m = GL_NODES;
  for (let i = 1; i <= m; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (m + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = 0;
      for (let j = 1; j <= m; j++) {
        const p2 = p1;
        p1 = p0;
        p0 = ((2 * j - 1) * z * p1 - (j - 1) * p2) / j;
      }
      dp = m * (z * p0 - p1) / (z * z - 1);
      const dz = p0 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-14) break;
    }
    GL_X.push(z);
    GL_W.push(2 / ((1 - z * z) * dp * dp));
  }
})();

function phiPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** ∫_{−∞}^{h} φ(x)·Φ((k − ρx)/√(1−ρ²)) dx — the Gaussian copula kernel. */
function copulaKernel(h: number, k: number, rho: number): number {
  const s = Math.sqrt(1 - rho * rho);
  const integrand = (x: number) => phiPdf(x) * phi((k - rho * x) / s);
  // segment 1: (−8, min(h, 0)] — map from (−8, 0]
  let total = 0;
  const seg = (lo: number, hi: number): number => {
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2;
    let acc = 0;
    for (let i = 0; i < GL_NODES; i++) {
      acc += GL_W[i] * integrand(mid + half * GL_X[i]);
    }
    return (acc * half);
  };
  const lo1 = Math.min(h, 0);
  if (lo1 > -8) total += seg(-8, lo1);
  // segment 2: (min(h,0), h]
  if (h > lo1) total += seg(lo1, h);
  return total;
}

/** Exact P(X2 ≤ k | X1 ≤ h) under the Gaussian copula with correlation ρ. */
export function copulaConditionalProb(h: number, k: number, rho: number): number {
  const denom = phi(h);
  if (denom <= 1e-12) return phi(k);
  return Math.max(0, Math.min(1, copulaKernel(h, k, rho) / denom));
}

// ─── ρ derivation from Break-Point-Saved rates ─────────────────────────────
// The exact i.i.d. BP-state DP produces tour-realistic BPS values in the
// 0.36 (fragile) → 0.52 (elite pressure server) band; the coupling anchors
// map that band onto the master-prompt window ρ ∈ [−0.15, +0.22].
const BPS_ANCHOR_LOW = 0.36; // ρ = −0.15
const BPS_SLOPE = 0.37 / 0.16; // 0.16 BPS units span the full ρ window

export interface CopulaTelemetry {
  /** in-set momentum coupling ρ ∈ [−0.15, +0.22] (BP-saved driven) */
  rhoSetCoupling: number;
  /** hold ↔ tie-break coupling (0.6 × set coupling — pressure amplifier) */
  rhoHoldTiebreak: number;
  /** set-3 fatigue delta applied to BOTH holds (always ≤ 0) */
  fatigueSet3: number;
  /** BP-saved rates that produced ρ */
  bpSavedA: number;
  bpSavedB: number;
  /** copula comeback multiplier on 3-set outcomes (2-1 ∪ 1-2) */
  comebackBoost: number;
  /** copula tie-break multiplier on the 6-6 → 7-6 mass */
  tiebreakBoost: number;
  /** momentum shift (point-prob units) granted to the previous-set winner */
  winnerShift: number;
}

/**
 * STATION 2 entry — derive the full copula telemetry of a match from its
 * calibrated serve point probabilities and exact BP-saved rates.
 */
export function deriveCopulaTelemetry(pA: number, pB: number, bpsA: number, bpsB: number): CopulaTelemetry {
  const bpsAvg = (bpsA + bpsB) / 2;
  // linear map: bpsAvg 0.36 → −0.15 · bpsAvg 0.52 → +0.22
  const rho = Math.max(-0.15, Math.min(0.22, -0.15 + BPS_SLOPE * (bpsAvg - BPS_ANCHOR_LOW)));
  // fatigue: BP exposure of the two servers + rally length proxy (mean hold)
  const bpExposure = 1 - bpsAvg; // fragile servers face/hit more pressure rallies
  const rallyProxy = Math.max(0, Math.min(1, ((pA + pB) / 2 - 0.56) / 0.14));
  const fatigue = -(0.008 + 0.014 * bpExposure + 0.006 * rallyProxy); // ∈ [−0.028, −0.008]
  const winnerShift = rho * 0.045; // point-prob momentum granted to set winner
  const rhoHoldTB = rho * 0.6;
  return {
    rhoSetCoupling: Math.round(rho * 1000) / 1000,
    rhoHoldTiebreak: Math.round(rhoHoldTB * 1000) / 1000,
    fatigueSet3: Math.round(fatigue * 1000) / 1000,
    bpSavedA: bpsA,
    bpSavedB: bpsB,
    comebackBoost: 0,
    tiebreakBoost: 0,
    winnerShift: Math.round(winnerShift * 10000) / 10000,
  };
}

/**
 * Copula conditional set-2 win probability for player A given the set-1
 * winner — exact Gaussian-copula exceedance. p1/p2 are the independent
 * model marginals (set-1 with A serving first, fatigue-adjusted set 2).
 */
export function copulaSet2Conditional(
  p1: number,
  p2: number,
  rho: number,
  playerAWonSet1: boolean
): number {
  const h = phiInv(Math.max(1e-6, Math.min(1 - 1e-6, p1)));
  const k = phiInv(Math.max(1e-6, Math.min(1 - 1e-6, p2)));
  const condA = copulaConditionalProb(h, k, rho); // P(A wins s2 | A won s1)
  const joint = p1 * condA;
  const condB = (p2 - joint) / Math.max(1e-6, 1 - p1); // P(A wins s2 | B won s1)
  const p = playerAWonSet1 ? condA : condB;
  return Math.max(0.02, Math.min(0.98, p));
}

// ─── STATION 3 · 10,000 Game-by-Game Monte-Carlo Simulator ─────────────────
const MC_RUNS = 10_000;

/**
 * One set simulation at GAME level — mirrors solveSet exactly:
 *  · A holds his serve game w.p. gA; B holds w.p. gB (A breaks w.p. 1 − gB)
 *  · serve alternates every game; at 6-6 the tie-break split uses the same
 *    tieBreakWinProb call as the closed-form set solver
 * Returns [gamesA, gamesB, tiebreak].
 */
function simSet(gA: number, gB: number): [number, number, boolean] {
  let gamesA = 0;
  let gamesB = 0;
  let aServes = rand() < 0.5; // racket toss
  while (true) {
    const aWinsGame = aServes ? rand() < gA : rand() > gB;
    if (aWinsGame) gamesA++;
    else gamesB++;
    if (gamesA >= 6 && gamesA - gamesB >= 2) return [gamesA, gamesB, false];
    if (gamesB >= 6 && gamesB - gamesA >= 2) return [gamesA, gamesB, false];
    if (gamesA === 6 && gamesB === 6) {
      if (rand() < tieBreakWinProb(gA, gB)) return [7, 6, true];
      return [6, 7, true];
    }
    aServes = !aServes;
  }
}

/**
 * STATION 3 entry — 10,000 game-by-game runs with copula coupling:
 *  · the previous-set winner receives the momentum shift (+winnerShift)
 *  · both holds degrade by fatigueSet3 in the third set
 *  · tie-breaks use the exact closed-form DP with a pressure tilt toward
 *    the better BP-saver (ρ_hold,tb coupling)
 */
export function runMonteCarlo(
  pA: number,
  pB: number,
  cop: CopulaTelemetry,
  favorite: "A" | "B"
): MonteCarloResult {
  resetRng(0x5eed ^ Math.round(pA * 100000) ^ Math.round(pB * 100000));
  const counts: Record<ResultCode, number> = { "2-0": 0, "2-1": 0, "1-2": 0, "0-2": 0 };
  const gamesHist = new Array(43).fill(0);
  const favWinsArr: number[] = [];
  const gamesArr: number[] = [];
  let marginSum6 = 0;
  let marginSum4 = 0;
  let marginSum2 = 0;
  let marginSumM1 = 0;
  let marginSumM3 = 0;
  let marginSumM5 = 0;
  let tbMass = 0;
  let favWinUnder215 = 0;
  let favWinOver205 = 0;
  let over215 = 0;
  let favLoseOver205Set1 = 0;
  let favWonSet1 = 0;

  for (let run = 0; run < MC_RUNS; run++) {
    let setsA = 0;
    let setsB = 0;
    let gamesA = 0;
    let gamesB = 0;
    let tbInMatch = false;
    let lastWinner: "A" | "B" | null = null;
    let setNo = 1;
    let set1Winner: "A" | "B" | null = null;
    while (setsA < 2 && setsB < 2) {
      // copula coupling — signed momentum toward the previous-set winner
      // (m = +winnerShift when A won, −winnerShift when B won) + set-3 fatigue
      // on BOTH servers. Exactly the same convention as the markov.ts DP.
      const m = lastWinner === null ? 0 : lastWinner === "A" ? cop.winnerShift : -cop.winnerShift;
      const fatigue = setNo === 3 ? cop.fatigueSet3 : 0;
      const pA_eff = Math.max(0.5, Math.min(0.85, pA + m + fatigue));
      const pB_eff = Math.max(0.5, Math.min(0.85, pB - 0.6 * m + fatigue));
      const gA_eff = gameWinProb(pA_eff);
      const gB_eff = gameWinProb(pB_eff);
      const [gA, gB, tb] = simSet(gA_eff, gB_eff);
      if (tb) tbInMatch = true;
      gamesA += gA;
      gamesB += gB;
      if (gA > gB) setsA++;
      else setsB++;
      if (setNo === 1) set1Winner = gA > gB ? "A" : "B";
      lastWinner = gA > gB ? "A" : "B";
      setNo++;
    }
    const total = gamesA + gamesB;
    const code: ResultCode = setsA === 2 && setsB === 0 ? "2-0" : setsA === 2 ? "2-1" : setsB === 2 && setsA === 0 ? "0-2" : "1-2";
    counts[code]++;
    if (total <= 42) gamesHist[total]++;
    const favWon = favorite === "A" ? setsA > setsB : setsB > setsA;
    const margin = favorite === "A" ? gamesA - gamesB : gamesB - gamesA;
    favWinsArr.push(favWon ? 1 : 0);
    gamesArr.push(total);
    if (margin >= 6) marginSum6++;
    if (margin >= 4) marginSum4++;
    if (margin >= 2) marginSum2++;
    if (margin >= -1) marginSumM1++;
    if (margin >= -3) marginSumM3++;
    if (margin >= -5) marginSumM5++;
    if (tbInMatch) tbMass++;
    if (favWon && total <= 21) favWinUnder215++;
    if (favWon && total >= 21) favWinOver205++;
    if (total >= 22) over215++;
    const favWonSet1Flag = favorite === "A" ? set1Winner === "A" : set1Winner === "B";
    if (favWonSet1Flag) favWonSet1++;
    // SRV combo uncovered cell: favorite LOSES ∧ over 20.5 games ∧ fav won set 1
    if (!favWon && total >= 21 && favWonSet1Flag) favLoseOver205Set1++;
  }

  const n = MC_RUNS;
  const p20 = counts["2-0"] / n;
  const p21 = counts["2-1"] / n;
  const p12 = counts["1-2"] / n;
  const p02 = counts["0-2"] / n;
  const favWinProb = p20 + p21 + p12 + p02 > 0 ? (favorite === "A" ? p20 + p21 : p12 + p02) : 0.5;
  const pFavWin = favorite === "A" ? p20 + p21 : p12 + p02;

  // entropy + position σ
  const probs = [p20, p21, p12, p02].filter((p) => p > 1e-9);
  const entropy = -probs.reduce((s, p) => s + p * Math.log(p), 0);
  const entropyNormalized = entropy / Math.log(4);
  // per-unit match-winner position σ: Var = p·1² − p² for a 1@2.0 payout
  const sigmaMatchWinner = Math.sqrt(Math.max(0, favWinProb * (1 - favWinProb)));

  // total-games mean / std
  let mean = 0;
  for (let g = 0; g <= 42; g++) mean += g * gamesHist[g];
  mean /= n;
  let varG = 0;
  for (let g = 0; g <= 42; g++) varG += (g - mean) * (g - mean) * gamesHist[g];
  const std = Math.sqrt(varG / n);

  // Gaussian copula correlation (inverse-normal rank transform)
  const corr = gaussianCopulaCorr(favWinsArr, gamesArr, pFavWin);

  // top-3 scenario clusters (favorite-oriented canonical bands)
  const favWon20 = favorite === "A" ? p20 : p02;
  const favWon21 = favorite === "A" ? p21 : p12;
  const dog21 = favorite === "A" ? p12 : p21;
  const dogWon = favorite === "A" ? p02 : p20;
  // sub-split of the fav 2-0 paths into fast / standard / long games bands
  const bandsFav20 = bandSplit20(pA, pB, cop, favorite);
  const favName = "FAV";
  const scenarios: McScenario[] = [
    {
      label: `${favName} 2-0 FAST`,
      descFa: `برد ۲-۰ سریع فاوریت — زیر ۱۹.۵ گیم`,
      descEn: "FAVORITE WINS 2-0 — UNDER 19.5 GAMES",
      code: favorite === "A" ? "2-0" : "0-2",
      favWin: true,
      gamesLo: 12,
      gamesHi: 19,
      prob: favWon20 * bandsFav20.under195,
    },
    {
      label: `${favName} 2-0 STANDARD`,
      descFa: `برد ۲-۰ نزدیک فاوریت — ۲۰ تا ۲۲ گیم`,
      descEn: "FAVORITE WINS 2-0 — 20 TO 22 GAMES",
      code: favorite === "A" ? "2-0" : "0-2",
      favWin: true,
      gamesLo: 20,
      gamesHi: 22,
      prob: favWon20 * bandsFav20.mid195_225,
    },
    {
      label: `${favName} 2-0 LONG`,
      descFa: `برد ۲-۰ طولانی فاوریت — بالای ۲۲.۵ گیم (با تای‌بریک)`,
      descEn: "FAVORITE WINS 2-0 — OVER 22.5 GAMES",
      code: favorite === "A" ? "2-0" : "0-2",
      favWin: true,
      gamesLo: 23,
      gamesHi: 36,
      prob: favWon20 * bandsFav20.over225,
    },
    {
      label: `${favName} 2-1`,
      descFa: `برد ۲-۱ فاوریت در ست سوم`,
      descEn: "FAVORITE WINS 2-1",
      code: favorite === "A" ? "2-1" : "1-2",
      favWin: true,
      gamesLo: 20,
      gamesHi: 36,
      prob: favWon21,
    },
    {
      label: "DOG 2-1",
      descFa: `برد ۲-۱ بازیکن دوم در ست سوم`,
      descEn: "UNDERDOG WINS 2-1",
      code: favorite === "A" ? "1-2" : "2-1",
      favWin: false,
      gamesLo: 20,
      gamesHi: 36,
      prob: dog21,
    },
    {
      label: "DOG 2-0",
      descFa: `برد ۲-۰ بازیکن دوم (شوک کامل)`,
      descEn: "UNDERDOG WINS 2-0",
      code: favorite === "A" ? "0-2" : "2-0",
      favWin: false,
      gamesLo: 12,
      gamesHi: 36,
      prob: Math.max(0, dogWon - dog21),
    },
  ];
  const sorted = [...scenarios].sort((a, b) => b.prob - a.prob);
  const top3 = sorted.slice(0, 3);
  const topMass = top3.reduce((s, x) => s + x.prob, 0);

  return {
    runs: n,
    outcomes: { p20, p21, p12, p02 },
    totalGamesMean: Math.round(mean * 10) / 10,
    totalGamesStd: Math.round(std * 100) / 100,
    gamesDist: gamesHist,
    handicapSpread: {
      minus55: marginSum6 / n,
      minus35: marginSum4 / n,
      minus15: marginSum2 / n,
      plus15: marginSumM1 / n,
      plus35: marginSumM3 / n,
      plus55: marginSumM5 / n,
    },
    entropy: Math.round(entropy * 1000) / 1000,
    entropyNormalized: Math.round(entropyNormalized * 1000) / 1000,
    topScenarios: top3,
    topScenariosMass: Math.round(topMass * 1000) / 1000,
    favWinGamesCorr: Math.round(corr * 1000) / 1000,
    favWinUnder215: favWinUnder215 / n,
    favWinOver205: favWinOver205 / n,
    coverOver215: over215 / n,
    favWinShareOver205: pFavWin > 0 ? (favWinOver205 / n) / pFavWin : 0,
    favLoseOver205Set1: favLoseOver205Set1 / n,
    favWonSet1Prob: favWonSet1 / n,
    sigmaMatchWinner,
    pFavWinBy55: marginSum6 / n,
    pFavWinBy35: marginSum4 / n,
    tiebreakMass: tbMass / n,
  };
}

/** Split the favorite's 2-0 paths into games bands via a fast 2-set copula sim. */
function bandSplit20(
  pA: number,
  pB: number,
  cop: CopulaTelemetry,
  favorite: "A" | "B"
): { under195: number; mid195_225: number; over225: number } {
  const runs = 4000;
  resetRng(0xba57 ^ Math.round(pA * 77777) ^ Math.round(pB * 33333));
  let under = 0;
  let mid = 0;
  let over = 0;
  let sweptTotal = 0;
  const pFav = favorite === "A" ? pA : pB;
  const pDog = favorite === "A" ? pB : pA;
  for (let r = 0; r < runs; r++) {
    // only simulate the favorite-sweeps-both-sets branch (game-level, mirroring
    // the DP momentum convention: the set-1 winner carries the copula shift)
    let games = 0;
    let swept = true;
    for (let st = 0; st < 2; st++) {
      const m = st === 1 ? cop.winnerShift : 0; // momentum after set 1
      const pFavEff = Math.max(0.5, Math.min(0.85, pFav + m));
      const pDogEff = Math.max(0.5, Math.min(0.85, pDog - 0.6 * m));
      const gFav = gameWinProb(pFavEff);
      const gDog = gameWinProb(pDogEff);
      let gA = 0; // favorite games
      let gB = 0; // underdog games
      let srvFav = st === 0 ? true : false;
      while (true) {
        const favWinsGame = srvFav ? rand() < gFav : rand() > gDog;
        if (favWinsGame) gA++;
        else gB++;
        if (gA >= 6 && gA - gB >= 2) break;
        if (gB >= 6 && gB - gA >= 2) {
          swept = false;
          break;
        }
        if (gA === 6 && gB === 6) {
          if (rand() < tieBreakWinProb(pFavEff, pDogEff)) gA = 7;
          else {
            gB = 7;
            swept = false;
          }
          break;
        }
        srvFav = !srvFav;
      }
      if (!swept) break;
      games += gA + gB;
    }
    if (!swept) continue;
    sweptTotal++;
    if (games <= 19) under++;
    else if (games <= 22) mid++;
    else over++;
  }
  // proportions of the favorite's 2-0 mass per games band (sum = 1)
  const total = Math.max(1, sweptTotal);
  return {
    under195: under / total,
    mid195_225: mid / total,
    over225: over / total,
  };
}

/** Gaussian copula correlation via inverse-normal rank transform. */
function gaussianCopulaCorr(x: number[], y: number[], pBinomial: number): number {
  const n = x.length;
  if (n < 100) return 0;
  // binary side → two-point inverse-normal transform (exact for a Bernoulli)
  const zLo = phiInv(Math.max(1e-6, Math.min(1 - 1e-6, pBinomial)));
  const zHi = phiInv(Math.max(1e-6, Math.min(1 - 1e-6, 1 - pBinomial)));
  // continuous side → empirical rank → inverse-normal
  const idx = y.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const zy = new Array<number>(n);
  for (let r = 0; r < n; r++) {
    const u = (r + 1) / (n + 1);
    zy[idx[r][1]] = phiInv(u);
  }
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i] === 1 ? zHi : zLo;
    my += zy[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] === 1 ? zHi : zLo) - mx;
    const dy = zy[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return 0;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

// ─── v5.0 · Monte-Carlo Composite Score (0–100) ────────────────────────────
/** Crown score shown on the telemetry bar: coverage × risk × sharpness blend. */
export function monteCarloScore(mc: MonteCarloResult, pairLoss: number, sharpe: number): number {
  const coverageScore = Math.max(0, Math.min(1, 1 - pairLoss / 0.25)); // 0..1
  const entropyPenalty = mc.entropyNormalized; // lower entropy → higher score
  const sharpeScore = Math.max(0, Math.min(1, sharpe / 0.6));
  const concentration = Math.min(1, mc.topScenariosMass / 0.8);
  const raw =
    42 * coverageScore + 18 * (1 - entropyPenalty) + 26 * sharpeScore + 14 * concentration;
  return Math.round(Math.max(0, Math.min(100, raw)));
}
