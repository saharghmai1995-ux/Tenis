// ─── NeoTennis Markov Quant v5.0 — Station 3 · 10,000 Monte-Carlo Engine ───
// Every match is simulated 10,000 times GAME BY GAME with the Station-2
// copula parameters:
//   · latent AR(1) momentum draws couple consecutive sets (ρ_set) and inject
//     an extra set-3 fatigue tilt (ρ₃ > ρ₂);
//   · each game is a Bernoulli draw on the copula-tilted hold probability;
//   · tie-breaks are solved with the exact 7-point Markov DP (cached).
//
// Outputs (all favorite-oriented):
//   · exact distribution of the 4 scorelines (2-0 / 2-1 / 1-2 / 0-2)
//   · total-games distribution (18 → 36 games windows)
//   · game-handicap spread of the favorite (−5.5 … +5.5)
//   · Shannon entropy of the match (H_Tennis, bits)
//   · position standard deviation σ (favorite game margin across sims)
//   · per-sim outcome tuples for the Station-4 non-linear Sharpe router

import { tieBreakWinProb } from "./markov";
import { phi } from "./copula";
import type { CopulaInfo, McScenario, MonteCarloSummary } from "./types";

export const MC_SIMS = 10_000;

// momentum amplitudes — latent copula draw tilts per-set game-win probs
const MOMENTUM_AMP_SET2 = 0.028;
const MOMENTUM_AMP_SET3 = 0.042; // third-set fatigue swings harder

// ─── Seeded RNG (mulberry32) — deterministic per eventKey for SHA-256 locks ─
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller standard normal from a uniform RNG. */
function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp01 = (x: number) => Math.max(0.02, Math.min(0.98, x));

// exact tie-break DP cache (rounded serve probs → p(A wins TB))
const tbCache = new Map<string, number>();
function tbProb(pA: number, pB: number): number {
  const key = `${Math.round(pA * 500)}|${Math.round(pB * 500)}`;
  const hit = tbCache.get(key);
  if (hit !== undefined) return hit;
  const v = tieBreakWinProb(pA, pB);
  tbCache.set(key, v);
  return v;
}

// ─── per-set game-by-game simulator ────────────────────────────────────────
function simSet(
  pHoldA: number,
  pHoldB: number,
  rng: () => number
): { gamesA: number; gamesB: number } {
  let a = 0;
  let b = 0;
  // game n (0-indexed): A serves when n is even
  while (true) {
    if (a >= 6 && a - b >= 2) return { gamesA: a, gamesB: b };
    if (b >= 6 && b - a >= 2) return { gamesA: a, gamesB: b };
    if (a === 6 && b === 6) {
      const aWinsTb = rng() < tbProb(pHoldA, pHoldB);
      return { gamesA: a + (aWinsTb ? 1 : 0), gamesB: b + (aWinsTb ? 0 : 1) };
    }
    const aServes = (a + b) % 2 === 0;
    const aWinsGame = aServes ? rng() < pHoldA : rng() >= pHoldB;
    if (aWinsGame) a++;
    else b++;
  }
}

// ─── per-sim outcome tuple (favorite-oriented downstream) ──────────────────
export interface McSim {
  /** A-frame scoreline: 0 = 2-0, 1 = 2-1, 2 = 1-2, 3 = 0-2 */
  code: 0 | 1 | 2 | 3;
  games: number; // total games
  margin: number; // gamesA − gamesB
  set1A: boolean;
}

export interface McResult extends MonteCarloSummary {
  /** raw per-sim tuples for the Station-4 Sharpe router (transient) */
  sims: McSim[];
}

/**
 * Station 3 — 10,000 game-by-game Monte Carlo with copula coupling.
 * All probability outputs are PLAYER-A oriented; the favorite orientation is
 * applied by the caller via `fav`.
 */
export function simulateMatch10000(
  gA: number,
  gB: number,
  cop: CopulaInfo,
  seed: number
): McResult {
  const rng = mulberry32(seed);
  const sims: McSim[] = [];
  const s2sd = Math.sqrt(Math.max(0, 1 - cop.rhoSet * cop.rhoSet));
  const s3sd = Math.sqrt(Math.max(0, 1 - cop.fatigueSet3 * cop.fatigueSet3));

  const counts = [0, 0, 0, 0]; // 2-0, 2-1, 1-2, 0-2 (A frame)
  const gamesHist = new Map<number, number>();
  let marginSum = 0;
  let marginSqSum = 0;

  for (let s = 0; s < MC_SIMS; s++) {
    // correlated latent momentum draws (AR(1) copula structure)
    const e1 = randn(rng);
    const e2 = randn(rng);
    const e3 = randn(rng);
    const c2 = cop.rhoSet * e1 + s2sd * e2;
    const c3 = cop.fatigueSet3 * e2 + s3sd * e3;
    const u2 = phi(c2);
    const u3 = phi(c3);

    // symmetric momentum tilt: u > 0.5 favors player A, u < 0.5 favors B
    const bias2 = MOMENTUM_AMP_SET2 * (u2 - 0.5) * (0.5 + cop.rhoSet);
    const bias3 = MOMENTUM_AMP_SET3 * (u3 - 0.5) * (0.5 + cop.fatigueSet3);

    const s1 = simSet(gA, gB, rng);
    const w1A = s1.gamesA > s1.gamesB;
    const sa1 = w1A ? 1 : 0;

    let sa2 = sa1;
    let gamesTotal = s1.gamesA + s1.gamesB;
    let margin = s1.gamesA - s1.gamesB;

    if (sa1 === 1) {
      const s2 = simSet(clamp01(gA + bias2), clamp01(gB - bias2), rng);
      gamesTotal += s2.gamesA + s2.gamesB;
      margin += s2.gamesA - s2.gamesB;
      if (s2.gamesA > s2.gamesB) {
        sa2 = 2;
      } else {
        const s3 = simSet(clamp01(gA + bias3), clamp01(gB - bias3), rng);
        gamesTotal += s3.gamesA + s3.gamesB;
        margin += s3.gamesA - s3.gamesB;
        sa2 = s3.gamesA > s3.gamesB ? 2 : 1;
      }
    } else {
      const s2 = simSet(clamp01(gA + bias2), clamp01(gB - bias2), rng);
      gamesTotal += s2.gamesA + s2.gamesB;
      margin += s2.gamesA - s2.gamesB;
      if (s2.gamesA > s2.gamesB) {
        const s3 = simSet(clamp01(gA + bias3), clamp01(gB - bias3), rng);
        gamesTotal += s3.gamesA + s3.gamesB;
        margin += s3.gamesA - s3.gamesB;
        sa2 = s3.gamesA > s3.gamesB ? 2 : 1;
      } else {
        sa2 = 0;
      }
    }

    const code: McSim["code"] = sa2 === 2 ? (w1A ? 0 : 3) : w1A ? 1 : 2;
    counts[code]++;
    gamesHist.set(gamesTotal, (gamesHist.get(gamesTotal) ?? 0) + 1);
    marginSum += margin;
    marginSqSum += margin * margin;
    sims.push({ code, games: gamesTotal, margin, set1A: w1A });
  }

  const n = MC_SIMS;
  const p = counts.map((c) => c / n);
  const meanMargin = marginSum / n;
  const sigmaMargin = Math.sqrt(Math.max(0, marginSqSum / n - meanMargin * meanMargin));

  // Shannon entropy of the match (bits) over the 4 scorelines
  const entropy = -p.reduce((acc, pi) => (pi > 0 ? acc + pi * Math.log2(pi) : acc), 0);

  let gamesGe20 = 0;
  let gamesGe22 = 0;
  let gamesLe20 = 0;
  for (const [g, c] of gamesHist) {
    if (g >= 20) gamesGe20 += c;
    if (g >= 22) gamesGe22 += c;
    if (g <= 20) gamesLe20 += c;
  }

  return {
    sims,
    seed,
    p20: p[0],
    p21: p[1],
    p12: p[2],
    p02: p[3],
    ou195: gamesGe20 / n,
    ou215: gamesGe22 / n,
    u205: gamesLe20 / n,
    entropy,
    sigmaMargin,
    bankerProb: 0, // favorite-oriented — filled by orientSummary
    comboCorrUnder: 0,
    comboCorrOver: 0,
    favWinUnder215: 0,
    favWinOver205: 0,
    topScenarios: [],
    top3Share: 0,
  };
}

// ─── favorite-orientation + derived regime metrics ─────────────────────────
/**
 * Re-orients the A-frame MC output toward the favorite and computes every
 * derived quantity the 5-regime router needs (combo correlations, scenario
 * clusters, banker probability).
 */
export function orientMonteCarlo(
  mc: McResult,
  fav: "A" | "B",
  cop: CopulaInfo
): McResult {
  const flip = fav === "B";
  const pf20 = flip ? mc.p02 : mc.p20;
  const pf21 = flip ? mc.p12 : mc.p21;
  const pf12 = flip ? mc.p21 : mc.p12;
  const pf02 = flip ? mc.p20 : mc.p02;
  const bankerProb = pf20 + pf21;

  let favWinUnder215 = 0;
  let favWinOver205 = 0;
  let gamesLe20 = 0;
  let gamesGe22 = 0;
  let sc1 = 0; // fav 2-0 fast (≤ 19 games)
  let sc2 = 0; // fav 2-0 close (20–22 games)
  let sc3 = 0; // fav 2-1
  let sc4 = 0; // dog 2-1
  let sc5 = 0; // dog 2-0

  for (const s of mc.sims) {
    const favWon = flip ? s.code === 2 || s.code === 3 : s.code === 0 || s.code === 1;
    const favWon20 = flip ? s.code === 3 : s.code === 0;
    const favWon21 = flip ? s.code === 2 : s.code === 1;
    const dogWon21 = flip ? s.code === 1 : s.code === 2;
    const dogWon20 = flip ? s.code === 0 : s.code === 3;
    if (favWon && s.games <= 21) favWinUnder215++;
    if (favWon && s.games >= 21) favWinOver205++;
    if (s.games <= 20) gamesLe20++;
    if (s.games >= 22) gamesGe22++;
    if (favWon20 && s.games <= 19) sc1++;
    if (favWon20 && s.games >= 20 && s.games <= 22) sc2++;
    if (favWon21) sc3++;
    if (dogWon21) sc4++;
    if (dogWon20) sc5++;
  }

  const r = (x: number) => x / MC_SIMS;
  const favWin = bankerProb;
  const fair = (x: number) => (x > 0.005 ? Math.round((1 / x) * 100) / 100 : 99);

  const topScenarios: McScenario[] = [
    {
      key: "fav20fast",
      labelFa: "برد سریع ۲-۰ فاوریت (زیر ۱۹.۵ گیم)",
      labelEn: "FAVORITE FAST 2-0 · UNDER 19.5 GAMES",
      prob: r(sc1),
      odds: fair(r(sc1)),
    },
    {
      key: "fav20close",
      labelFa: "برد نزدیک ۲-۰ فاوریت (۲۰ تا ۲۲ گیم / تای‌بریک)",
      labelEn: "FAVORITE CLOSE 2-0 · 20-22 GAMES / TIE-BREAK",
      prob: r(sc2),
      odds: fair(r(sc2)),
    },
    {
      key: "fav21",
      labelFa: "برد ۲-۱ فاوریت در ست سوم",
      labelEn: "FAVORITE WINS 2-1",
      prob: r(sc3),
      odds: fair(r(sc3)),
    },
    {
      key: "dog21",
      labelFa: "کامبک ۲-۱ آندراگ",
      labelEn: "UNDERDOG COMEBACK 2-1",
      prob: r(sc4),
      odds: fair(r(sc4)),
    },
    {
      key: "dog20",
      labelFa: "شوک ۲-۰ آندراگ",
      labelEn: "UNDERDOG UPSET 2-0",
      prob: r(sc5),
      odds: fair(r(sc5)),
    },
  ];
  const top3Share = r(sc1 + sc2 + sc3);

  return {
    sims: mc.sims, // kept in A-frame — the Sharpe router flips per regime
    seed: mc.seed,
    p20: pf20,
    p21: pf21,
    p12: pf12,
    p02: pf02,
    ou195: mc.ou195,
    ou215: mc.ou215,
    u205: gamesLe20 / MC_SIMS,
    entropy: mc.entropy,
    sigmaMargin: mc.sigmaMargin,
    bankerProb,
    comboCorrUnder: favWin > 0.01 ? favWinUnder215 / MC_SIMS / favWin : 0,
    comboCorrOver: favWin > 0.01 ? favWinOver205 / MC_SIMS / favWin : 0,
    favWinUnder215: favWinUnder215 / MC_SIMS,
    favWinOver205: favWinOver205 / MC_SIMS,
    topScenarios,
    top3Share,
  };
}

// ─── game-handicap spread of the favorite (−5.5 … +5.5) ────────────────────
export function handicapSpreadDist(sims: McSim[], fav: "A" | "B"): Map<number, number> {
  const dist = new Map<number, number>();
  for (const s of sims) {
    const favMargin = fav === "A" ? s.margin : -s.margin;
    const bucket = Math.max(-6, Math.min(6, favMargin));
    dist.set(bucket, (dist.get(bucket) ?? 0) + 1);
  }
  for (const [k, v] of dist) dist.set(k, v / sims.length);
  return dist;
}
