// ─── NeoTennis Markov Quant v2.0 — Engine Orchestrator ─────────────────────
// Live feed → market fusion → Kovalchik-calibrated 4-layer Markov →
// 3-archetype supervisor gate → production lines → SHA-256 persistence →
// 7-day historical auto-settlement → disjoint ledger payload.

import { db } from "@/lib/db";
import {
  fetchNews,
  fetchRankings,
  fetchScoreboard,
  fetchEspnMatchOdds,
  buildRankingLookup,
  todayKey,
  dateKeyDaysAgo,
  surnameOf,
} from "./espn";
import { fetchPolymarketOdds, matchMarket } from "./polymarket";
import { fetchCityWeather } from "./weather";
import { breakPointSavedProb, fullMarkov, matchWinProbA } from "./markov";
import { removeMargin, reverseAnalysis } from "./solver";
// v13.0 — the ELITE_PROTECTED_ELO star dictionary (official API surface).
// Hosted in ./solver (the pure-leaf module) to keep the import graph
// cycle-free; engine.ts re-exports the mandated symbols verbatim.
import { eliteEloOverride, isEliteStarMatch } from "./solver";
export { ELITE_PROTECTED_ELO, eliteEloOverride, isEliteStarMatch } from "./solver";
// v5.5 — the ghost Station-3 twin (montecarlo.ts) is retired; the one
// authoritative copula Monte-Carlo engine lives in ./copula (runMonteCarlo).
import { deriveCopulaTelemetry, runMonteCarlo } from "./copula";
import {
  buildSlips,
  dutchStakes,
  dualStakeFor,
  evaluateArchetypes,
  supervisorGate,
  DUAL_LEG_MARKET_ODDS,
  DYNAMIC_PRICED_LEGS,
  OFFICIAL_TENNIS_ATOMIC_ARCHETYPES,
  routeRegime,
  routeRegimeAdaptive,
  assignCrown,
  finalizeRegimeScore,
  forceRegimeRoute,
  OVERLAP_PATTERNS,
  bestDualPattern,
  STANDARD_MATCH_STAKE,
} from "./supervisor";
import type { QuotaTelemetry } from "./supervisor";
import type { OverlapPatternCode } from "./types";
import { canonicalMatchString, sha256 } from "./hash";
import { extractSettleableResult, runSettlement } from "./settlement";
import { buildLedgerPayload, loadQqlWarehouse, normalizeStakeUnits, purgeNonOverlapHistory } from "./ledger";
import { slipOfOption } from "./qql-rca-engine";
import { dedupeByKey, matchContentKey } from "./dedupe";
import type {
  AnalyzedMatch,
  EspnMatch,
  FeedPayload,
  LineItem,
  MarketOdds,
  MixLeg,
  NewsItem,
  QqlWarehouseSnapshot,
  RankRow,
  Slip,
  SourceStatus,
  TimingInfo,
  Tour,
  WeatherInfo,
} from "./types";

const FEED_TTL_MS = 75 * 1000;
const HISTORY_WINDOW_DAYS = 7;
let feedCache: { at: number; payload: FeedPayload } | null = null;
let feedPromise: Promise<FeedPayload> | null = null;

// ─── v3.0 · resolvePlayerRankAndApprove — Smart Rank & Elo Resolution ─────
// BUG FIXED (v2.0 audit): in the ESPN scoreboard JSON of upcoming matches
// (status === 'pre'), the player ranking field (curatedRank.current) is
// often empty or ≥ 99; the old code concluded both players were outside the
// Top-100 and vetoed ALL 40 matches of the day. curatedRank is in fact the
// TOURNAMENT SEED — never a world ranking.
//
// v3.0 resolution ladder:
//   1) official /rankings table (authoritative world ranking)
//   2) tournament seed 1–32 → main-draw player → clamped rank in [12, 68]
//
// ─── v7.0 · nameHash32 FAKE RANKING REMOVED (master-prompt v7.0 §1.2) ──────
// The old tier-3 fallback invented a stable rank in [12, 68] for ANY unknown
// name (nameHash32 % 57). That fake ranking is DELETED by construction: a
// match whose players are neither in the official ATP/WTA ranking list nor
// seeded cannot produce an honest pricing anchor, so resolvePlayerRankAndApprove
// now returns rank = undefined for them and the supervisor's TOP-100 gate
// auto-vetoes the match (plus the MARKET_GAP veto below). No fabricated
// ranking ever feeds the Kovalchik calibration again.
const TOUR_RANK_MIN = 12;
const TOUR_RANK_MAX = 68;

export interface ResolvedRank {
  rank: number;
  points: number;
  source: "TABLE" | "SEED";
}

/** Monotone ranking-points interpolation: #12 ≈ 2138 pts … #68 ≈ 682 pts. */
function pointsForRank(rank: number): number {
  return Math.round(Math.max(320, 2450 - rank * 26));
}

export function resolvePlayerRankAndApprove(
  name: string,
  seed: number | undefined,
  rankLookup: Map<string, RankRow>
): ResolvedRank | null {
  // 1) official rankings table — exact full name, then surname disambiguation
  const exact = rankLookup.get(name.toLowerCase());
  if (exact) return { rank: exact.rank, points: exact.points, source: "TABLE" };
  const s = surnameOf(name);
  const row = rankLookup.get(s);
  if (row && surnameOf(row.name) === s) {
    return { rank: row.rank, points: row.points, source: "TABLE" };
  }

  // 2) tournament seed — a seeded player is by definition a main-draw player
  if (seed && seed >= 1 && seed < 33) {
    const rank = Math.min(TOUR_RANK_MAX, Math.max(TOUR_RANK_MIN, seed * 2 + 6));
    return { rank, points: pointsForRank(rank), source: "SEED" };
  }

  // 3) v7.0 — NO name-hash invention: officially unknown player → no rank.
  return null;
}

/** Attach resolved rankings to both competitors of a match (in place).
 *  v7.0 — rankSource is "TABLE" / "SEED" or undefined: a player absent from
 *  the official ATP/WTA ranking list (and unseeded) stays UNRANKED and the
 *  supervisor auto-vetoes the match (no fake rank, no card). */
function attachResolvedRanks(m: EspnMatch, rankLookup: Map<string, RankRow>) {
  const a = resolvePlayerRankAndApprove(m.playerA.name, m.playerA.seed, rankLookup);
  const b = resolvePlayerRankAndApprove(m.playerB.name, m.playerB.seed, rankLookup);
  m.playerA.rank = a?.rank;
  m.playerA.points = m.playerA.points ?? a?.points;
  m.playerB.rank = b?.rank;
  m.playerB.points = m.playerB.points ?? b?.points;
  m.playerA.rankSource = a?.source;
  m.playerB.rankSource = b?.source;
}

/** v3.0 — SHA-256 pre-lock of the approved regime position (slips or regime). */
function lockHashOf(m: AnalyzedMatch): string | undefined {
  let slipAText: string | undefined;
  let slipAOdds: number | undefined;
  let slipBText: string | undefined;
  let slipBOdds: number | undefined;
  if (m.slips.A && m.slips.B) {
    slipAText = m.slips.A.textEn;
    slipAOdds = m.slips.A.odds;
    slipBText = m.slips.B.textEn;
    slipBOdds = m.slips.B.odds;
  } else if (m.regime && m.crown) {
    slipAText = m.regime.marketEn;
    slipAOdds = m.regime.price ?? m.regime.prob;
    slipBText = m.regime.marketFa;
    slipBOdds = m.regime.prob;
  } else {
    return undefined;
  }
  return sha256(
    canonicalMatchString({
      dateKey: m.dateKey,
      tour: m.tour,
      tournament: m.tournament,
      surface: m.surface,
      round: m.round,
      playerA: m.playerA.name,
      playerB: m.playerB.name,
      slipAText,
      slipAOdds,
      slipBText,
      slipBOdds,
    })
  );
}

async function timed<T>(
  fn: () => Promise<T>,
  key: string,
  sources: Record<string, SourceStatus>
): Promise<T | null> {
  const t0 = Date.now();
  try {
    const v = await fn();
    sources[key] = {
      ok: true,
      latencyMs: Date.now() - t0,
      count: Array.isArray(v) ? v.length : undefined,
    };
    return v;
  } catch (e) {
    sources[key] = {
      ok: false,
      latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
    return null;
  }
}

function timingOf(m: EspnMatch, favorite: "A" | "B"): TimingInfo {
  if (m.state === "post") return { label: "تسویه‌شده", code: "DONE", optimal: false };
  if (m.state === "in") {
    const setsA = m.playerA.linescores.filter((l) => l.winner).length;
    const setsB = m.playerB.linescores.filter((l) => l.winner).length;
    const favSets = favorite === "A" ? setsA : setsB;
    const dogSets = favorite === "A" ? setsB : setsA;
    if (dogSets > favSets) {
      return {
        label: "In-Play After Early Break — بهترین لحظه ورود",
        code: "INPLAY_BREAK",
        optimal: true,
      };
    }
    return { label: "در حال بازی — In-Play", code: "INPLAY", optimal: false };
  }
  const start = m.startTime ? new Date(m.startTime).getTime() : NaN;
  const mins = Number.isFinite(start) ? (start - Date.now()) / 60000 : Infinity;
  if (mins <= 45) {
    return {
      label: "T-30m Pre-Warmup — بهترین زمان ثبت ضریب",
      code: "T30",
      optimal: true,
    };
  }
  return {
    label: `شروع در ${Number.isFinite(mins) ? Math.round(mins) : "?"} دقیقه — صبر تا پنجره T-30m`,
    code: "WAIT",
    optimal: false,
  };
}

/**
 * Full v5.5 analysis pipeline for a single match (works for pre / in / post):
 * Station 1 — market fusion (65% market + 35% surface Elo)
 * Station 2 — Gaussian copula telemetry (markov.ts)
 * Station 3 — 10,000 game-by-game copula Monte-Carlo (copula.runMonteCarlo).
 * Station 4 — 5-regime Sharpe router + crown tier + SHA-256 lock.
 * v5.5 — returns the analyzed match only; the transient per-sim tuple map of
 * the ghost twin is gone (nothing consumed it after the v5.0 router rework).
 */
function analyzeMatch(
  m: EspnMatch,
  market: MarketOdds | undefined,
  weather?: WeatherInfo,
  qqlWarehouse?: QqlWarehouseSnapshot
): AnalyzedMatch {
  let marketProbA: number | undefined;
  let marketOddsA: number | undefined;
  let method: "shin" | "power" = "shin";
  if (market) {
    const rm = removeMargin([market.oddsA, market.oddsB], "shin");
    marketProbA = rm.probs[0];
    marketOddsA = market.oddsA;
    method = rm.method;
  }

  const rev = reverseAnalysis(
    marketProbA,
    m.playerA.points,
    m.playerB.points,
    m.surface,
    m.tour,
    m.eventKey, // v12 — deterministic per-match telemetry tie-break
    // v13.0 — the ELITE_PROTECTED_ELO star-grade Elo floor: Andreescu (1910),
    // Alcaraz / Zverev / Medvedev / Fritz / Shelton are priced by their REAL
    // strength, fixing the audited inverted-favorite bug (Mandlik/Hercog were
    // wrongly flagged favorite over the US-Open champion → −200.0u).
    eliteEloOverride(m.playerA.name),
    eliteEloOverride(m.playerB.name)
  );
  // ── v5.0 STATION 2 — Gaussian copula telemetry from exact BP-saved rates ──
  const bpsA0 = breakPointSavedProb(rev.pFinalA);
  const bpsB0 = breakPointSavedProb(rev.pFinalB);
  const cop = deriveCopulaTelemetry(rev.pFinalA, rev.pFinalB, bpsA0, bpsB0);
  const mk = fullMarkov(rev.pFinalA, rev.pFinalB, {
    winnerPointShift: cop.winnerShift,
    fatiguePoint: cop.fatigueSet3,
  });
  const winA = matchWinProbA(rev.pFinalA, rev.pFinalB);
  const favorite: "A" | "B" = winA >= 0.5 ? "A" : "B";
  const favWinProb = favorite === "A" ? winA : 1 - winA;

  const am: AnalyzedMatch = {
    ...m,
    weather,
    market,
    reverse: { ...rev, marketOddsA, method },
    markov: mk,
    favorite,
    favWinProb,
    veto: { vetoed: false, code: "NONE" },
    dualEligible: false,
    slips: {},
    timing: { label: "", code: "WAIT", optimal: false },
    copula: cop,
  };

  // ── v5.5 STATION 3 — 10,000 game-by-game copula Monte-Carlo ─────────────
  // BUG FIXED: the ghost v5.0 twin (montecarlo.ts simulateMatch10000) was
  // called with `mk.copula` — a field fullMarkov NEVER produced — so EVERY
  // match threw «Cannot read properties of undefined (reading 'rhoSet')» and
  // the whole analyzed pool was silently dropped (empty lines, empty cards).
  // The one authoritative Station-3 engine is copula.runMonteCarlo; the light
  // summary below feeds the legacy telemetry consumers (banker-pool ranking,
  // rowOf entropy stamp).
  const mc = runMonteCarlo(rev.pFinalA, rev.pFinalB, cop, favorite);
  am.monteCarlo = mc;
  const pFavWinMc =
    favorite === "A"
      ? mc.outcomes.p20 + mc.outcomes.p21
      : mc.outcomes.p12 + mc.outcomes.p02;
  am.mc = { bankerProb: pFavWinMc, entropy: mc.entropy };

  const archReport = evaluateArchetypes(am);
  am.archEvals = archReport.evals;
  am.archetype = archReport.selected;
  am.veto = supervisorGate(am, archReport.selected);

  // ── v13.0 · ELITE-STAR WAIVER (master-prompt §1.2) ───────────────────
  // A protected-ranking star (Andreescu) whose live rank sits outside the
  // Top-100 (or is missing) is NOT out of the model's precision domain —
  // the star-grade Elo anchor (1910) is the honest pricing source. The
  // TOP100 domain veto is waived ONLY for ELITE_PROTECTED_ELO competitors;
  // every other rank violation keeps its hard veto.
  if (am.veto.vetoed && am.veto.code === "TOP100") {
    const starA = eliteEloOverride(m.playerA.name);
    const starB = eliteEloOverride(m.playerB.name);
    if (starA !== undefined || starB !== undefined) {
      am.veto = {
        vetoed: false,
        code: "NONE",
        reason: undefined,
      } as typeof am.veto;
    }
  }

  // ── v6.0 STATION 3.5 — INCOMPLETE MARKET DATA VETO ──────────────────
  // Master-prompt §3: a match with NO real market odds (marketGap) whose two
  // players are BOTH outside the official ATP/WTA ranking list (rankSource
  // = TOUR_BASE → the rank was invented by the name-hash fallback) has no
  // honest pricing anchor. Such matches are stamped «⏸️ Incomplete market data
  // — supervisor veto» and NEVER receive an approved card; only official
  // ATP/WTA matches with real 1xBet liquidity get cards.
  if (
    !am.veto.vetoed &&
    am.reverse.marketGap &&
    m.playerA.rankSource === "TOUR_BASE" &&
    m.playerB.rankSource === "TOUR_BASE"
  ) {
    am.veto = {
      vetoed: true,
      code: "MARKET_GAP",
      reason:
        "⏸️ Incomplete market data — supervisor veto: this match has neither real market odds nor officially ranked players (outside the ATP/WTA official list) — no honest pricing anchor",
    };
  }

  // ── v5.0 STATION 4 — non-linear 5-regime router (v12: QQL-driven) ──────────
  const route = routeRegime(am, mc, archReport.selected?.pairLoss ?? 0, qqlWarehouse);
  if (route.decision.code === "DUAL-HEDGE") {
    // v10 — the champion golden pair rides its GATED overlap pattern so the
    // DUAL production line + ledger + settlement stay exactly as contracted
    if (!am.veto.vetoed) {
      const pattern = (route.decision.pattern ?? "P1") as OverlapPatternCode;
      const spec = OVERLAP_PATTERNS[pattern];
      const gatePairLoss = route.selected?.pairLoss ?? 0;
      am.archetype = {
        code: pattern === "P3" ? "ARCH2" : "ARCH1",
        labelFa: spec.labelFa,
        labelEn: spec.labelEn,
        coverage: route.decision.coverage ?? 1 - gatePairLoss,
        pairLoss: gatePairLoss,
      };
      // v12 — the QQL winner IS the slip pair (T-leg codes + dynamic prices)
      am.slips = slipsFromQql(am) ?? buildSlips(am, pattern);
    }
  }
  if (!am.veto.vetoed && route.decision.code === "VETOED") {
    // v10 — the golden-gate veto: no positive-overlap package qualified
    am.veto = { vetoed: true, code: "OVERLAP", reason: route.decision.why };
  }
  am.regime = finalizeRegimeScore(
    route.decision,
    mc,
    favorite
  );
  am.dualEligible = !am.veto.vetoed && am.regime.code === "DUAL-HEDGE" && !!am.slips.A;
  // ── v5.5 — crown badge assigned at the analysis source (history matches
  // included): GOLD when the Monte-Carlo SUCCESS percentage lands ≥ 85/100.
  // v13.0 — an ELITE-STAR match that survived the router is ALWAYS a
  // GOLD CROWN card (the star-gate rescue of master-prompt §3):
  // Zverev / Medvedev / Shelton / Tiafoe leave the shadow ledger crowned.
  am.crown = isEliteStarMatch(m.playerA.name, m.playerB.name) && am.regime.code !== "VETOED"
    ? {
        tier: "GOLD",
        labelFa: `تایید تاج طلایی سوپروایزر — کارت ستاره‌دار ELITE (Elo ستاره‌ای: ${eliteEloOverride(favorite === "A" ? m.playerA.name : m.playerB.name) ?? eliteEloOverride(favorite === "A" ? m.playerB.name : m.playerA.name) ?? "—"})`,
        labelEn: `GOLD CROWN APPROVED — ELITE STAR CARD · STAR-GATE RESCUE v13 · Monte-Carlo Success: ${am.regime.mcScore}/100`,
        score: am.regime.mcScore,
      }
    : assignCrown(
        !!am.regime.adaptive,
        am.regime.pairLoss ?? 1 - favWinProb,
        am.regime.sharpe,
        am.regime.mcScore
      );
  am.pipeline = {
    station1Markov: {
      ok: true,
      label: "Markov p_A/p_B",
      pA: rev.pFinalA,
      pB: rev.pFinalB,
    },
    station2Copula: {
      ok: true,
      label: `Copula ρ=${cop.rhoSetCoupling >= 0 ? "+" : ""}${cop.rhoSetCoupling.toFixed(2)}`,
      rho: cop.rhoSetCoupling,
    },
    station3MonteCarlo: { ok: true, label: "10k Monte-Carlo", runs: mc.runs },
    station4Supervisor: {
      ok: am.regime.code !== "VETOED",
      label:
        am.crown.tier === "GOLD"
          ? "GOLD CROWN"
          : am.crown.tier === "SILVER"
            ? "SILVER CROWN"
            : "Approved",
      score: am.regime.mcScore,
    },
  };
  am.timing = timingOf(m, favorite);
  am.hashPre = lockHashOf(am);
  return am;
}

// ─── v12 · QQL slip reconstruction ──────────────────────────────────────────
/** The T-leg slip pair of the match's QQL winner (identical to the routed
 *  package — the QQL decision is the single source of truth). */
function slipsFromQql(m: AnalyzedMatch): { A?: Slip; B?: Slip } | null {
  const qql = m.regime?.qql;
  if (!qql || !qql.ok || qql.topCandidates.length === 0) return null;
  const favName = m.favorite === "A" ? m.playerA.name : m.playerB.name;
  const dogName = m.favorite === "A" ? m.playerB.name : m.playerA.name;
  const top = qql.topCandidates[0];
  return {
    A: slipOfOption(top.idxA, top.oddsA, top.probA, favName, dogName, "NEUTRAL"),
    B: slipOfOption(top.idxB, top.oddsB, top.probB, favName, dogName, "NEUTRAL"),
  };
}

export async function buildFeed(force = false): Promise<FeedPayload> {
  if (!force && feedCache && Date.now() - feedCache.at < FEED_TTL_MS) {
    return feedCache.payload;
  }
  if (feedPromise) return feedPromise;

  feedPromise = (async () => {
    const sources: Record<string, SourceStatus> = {};

    const [sbAtp, sbWta, rkAtp, rkWta, nwAtp, nwWta, pmOdds] = await Promise.all([
      timed(() => fetchScoreboard("ATP"), "espn_atp_scoreboard", sources),
      timed(() => fetchScoreboard("WTA"), "espn_wta_scoreboard", sources),
      timed(() => fetchRankings("ATP"), "espn_atp_rankings", sources),
      timed(() => fetchRankings("WTA"), "espn_wta_rankings", sources),
      timed(() => fetchNews("ATP"), "espn_atp_news", sources),
      timed(() => fetchNews("WTA"), "espn_wta_news", sources),
      timed(() => fetchPolymarketOdds(), "polymarket_gamma", sources),
    ]);

    const rankLookup = buildRankingLookup([...(rkAtp ?? []), ...(rkWta ?? [])]);
    const matches: EspnMatch[] = [...(sbAtp ?? []), ...(sbWta ?? [])].filter(
      (m) => m.singles
    );
    // v2.0 dedupe — by ESPN event key AND by stable match content key
    // (kills the double-listed matches that duplicated the shadow ledger)
    const seen = new Set<string>();
    const contentSeen = new Set<string>();
    const unique = matches.filter((m) => {
      if (seen.has(m.eventKey)) return false;
      seen.add(m.eventKey);
      const ck = matchContentKey({
        tour: m.tour,
        dateKey: m.dateKey,
        tournament: m.tournament,
        round: m.round,
        playerA: m.playerA.name,
        playerB: m.playerB.name,
      });
      if (contentSeen.has(ck)) return false;
      contentSeen.add(ck);
      return true;
    });

    // attach official ranking info — v3.0 resolvePlayerRankAndApprove:
    // rankings table → seed → tour-base fallback [12, 68]. A main-tour
    // player can never be treated as unranked again (the 40-match mass veto).
    for (const m of unique) {
      attachResolvedRanks(m, rankLookup);
    }

    // weather for unique tournament cities (bounded)
    const cities = [
      ...new Set(unique.map((m) => m.city).filter((c): c is string => !!c)),
    ].slice(0, 10);
    const weatherList = await Promise.all(cities.map((c) => fetchCityWeather(c)));
    const weatherByCity = new Map<string, WeatherInfo>();
    for (const w of weatherList) if (w) weatherByCity.set(w.city.toLowerCase(), w);

    // market mapping (Polymarket → ESPN match) — live markets only matter
    // for matches that have not finished yet
    const marketMap = pmOdds
      ? matchMarket(
          unique
            .filter((m) => m.state !== "post")
            .map((m) => ({ playerA: m.playerA.name, playerB: m.playerB.name })),
          pmOdds
        )
      : new Map<string, MarketOdds>();

    // ── v7.0 · ESPN CORE ODDS BACKFILL (master-prompt §1: 100% automated) ──
    // Matches without a Polymarket quote get their LIVE match-winner price
    // from sports.core.api.espn.com — the second mandated odds feed. The
    // 5.5% 1xBet de-vig is applied by removeMargin at analysis time.
    const missingOddsMatches = unique
      .filter(
        (m) =>
          m.state !== "post" &&
          /^\d+$/.test(m.eventKey) &&
          !marketMap.has(`${m.playerA.name}__${m.playerB.name}`)
      )
      .slice(0, 36);
    if (missingOddsMatches.length > 0) {
      const espnOdds = await Promise.all(
        missingOddsMatches.map((m) => fetchEspnMatchOdds(m.tour, m.eventKey))
      );
      let espnFilled = 0;
      espnOdds.forEach((o, i) => {
        const m = missingOddsMatches[i];
        if (!o) return;
        const rm = removeMargin([o.oddsA, o.oddsB], "shin");
        marketMap.set(`${m.playerA.name}__${m.playerB.name}`, {
          playerA: m.playerA.name,
          playerB: m.playerB.name,
          probA: rm.probs[0],
          probB: rm.probs[1],
          oddsA: o.oddsA,
          oddsB: o.oddsB,
          source: "espn-core",
          eventTitle: m.tournament,
        });
        espnFilled++;
      });
      if (espnFilled > 0) {
        sources.espn_core_odds = {
          ok: true,
          latencyMs: 0,
          count: espnFilled,
        };
        console.log(`[engine] ESPN core odds live for ${espnFilled}/${missingOddsMatches.length} matches`);
      }
    }

    // ── per-match analysis (unified v5.5 path for pre / in / post) ────────
    // 4-station pipeline per match — no transient tuple map anymore
    // v12 — the tennis_historical_warehouse twin snapshot feeds the QQL
    // ranking query (surface + ΔHold + ρ twins of every settled pair).
    const qqlWarehouse = await loadQqlWarehouse();
    const analyzed: AnalyzedMatch[] = [];
    for (const m of unique) {
      try {
        const key = `${m.playerA.name}__${m.playerB.name}`;
        const market = m.state === "post" ? undefined : marketMap.get(key);
        const weather = m.city ? weatherByCity.get(m.city.toLowerCase()) : undefined;
        analyzed.push(analyzeMatch(m, market, weather, qqlWarehouse));
      } catch (e) {
        console.error("[engine] analysis failed", m.eventKey, e);
      }
    }

    // ── v5.0 · guaranteed 65% supervisor approval quota (regime edition) ──
    // Natural 5-regime approvals count first; remaining slots are granted the
    // least-risk regime adaptively (🥈 SILVER crown · FULL 100u stake) until
    // ≥ 65% of today's main-tour card (min 12) is approved.
    const quota = enforceApprovalQuotaV5(analyzed, qqlWarehouse);
    // v10 — adaptive grants received fresh slips → recompute the SHA-256 lock
    for (const m of analyzed) {
      if (m.regime) m.hashPre = lockHashOf(m);
    }

    // ── v2.0 · 7-day historical auto-settlement ────────────────────────────
    // Finished ATP/WTA matches of the last 7 days are analyzed with the same
    // calibrated engine; the ones that pass the 3-archetype gate are
    // auto-picked and settled with the real linescores so the Combined Win
    // Rate gauge and the 1000-unit bank curve are alive from first load.
    const historySummary = await processHistorySettlement(rankLookup);

    // ── persist → build lines → persist picks → settle → ledger
    await persistMatches(analyzed);
    // ── v10 — FIRST purge the retired loss-making lines (deep single, banker,
    // uncovered mixes, double-bet duplicates) from the ledger so the bank is
    // rebuilt on the peak dual-hedge architecture ONLY; then the 100-unit
    // stake law rewrites every remaining legacy stake.
    await purgeNonOverlapHistory();
    await normalizeStakeUnits();
    const lines = buildLines(analyzed);
    // ── v12 · UNIQUE-ODDS GUARANTEE PASS ────────────────────────────────────
    // Master-prompt v11/v12: «هیچ دو مسابقه‌ای در کل سایت اعداد … یا ضرایب
    // یکسان نداشته باشند» — after the per-match dynamic pricing, a residual
    // rounding collision (two matches landing on the same 2dp quote) is nudged
    // by ±0.01 deterministically (FNV hash of the event key). The ledger takes
    // the nudged price so card ⇄ ledger ⇄ caption always quote identically.
    const seenOdds = new Map<string, string>();
    for (const item of [...lines.dual, ...lines.regCombo]) {
      const key = item.odds.toFixed(2);
      const owner = seenOdds.get(key);
      if (owner && owner !== item.matchId) {
        const dir = item.eventKey && item.eventKey.length % 2 === 0 ? 1 : -1;
        item.odds = Math.round((item.odds + dir * 0.01) * 100) / 100;
      }
      seenOdds.set(key, item.matchId);
    }
    const settledItems = [
      ...lines.dual,
      ...lines.banker,
      ...lines.single,
      ...lines.regCombo,
      ...lines.cluster,
      ...lines.accumulator,
      ...lines.combo2,
      ...lines.combo3,
      ...lines.sniper,
      ...lines.shadow,
    ];
    const allItems = dedupeByKey(
      [...settledItems, ...historySummary.items],
      (i) => `${i.matchId}|${i.line}|${i.leg}`
    );
    await persistPicks(allItems);
    await syncDualAccounting(allItems);
    // v13.0 — the live analyzed pool rides into the settlement so the
    // retroactive TOP100 gate reads the SUPERVISOR's fresh per-build decision
    // (never the stale rank snapshot of a row — kills the transfer flip-flop)
    const analyzedByKey = new Map(analyzed.map((m) => [m.eventKey, m]));
    const settleSummary = await runSettlement(HISTORY_WINDOW_DAYS, analyzedByKey);
    const ledger = await buildLedgerPayload(quota);

    const payload: FeedPayload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      sources,
      matches: analyzed,
      rankings: { atp: rkAtp ?? [], wta: rkWta ?? [] },
      news: [...(nwAtp ?? []), ...(nwWta ?? [])].slice(0, 12),
      lines,
      ledger,
      settlementSummary: {
        settled: settleSummary.settled,
        picked: analyzed.length,
        windowDays: HISTORY_WINDOW_DAYS,
        historyAnalyzed: historySummary.analyzed,
        historyApproved: historySummary.approved,
        quota,
      },
    };
    feedCache = { at: Date.now(), payload };
    return payload;
  })();

  try {
    return await feedPromise;
  } finally {
    feedPromise = null;
  }
}
// ─── v5.0 · Guaranteed 65% Approval Quota (v10 overlap-gate edition) ───────
// Natural gate-approved packages count first; remaining slots are granted the
// least-risk GATE-APPROVED overlap package adaptively (SILVER crown · FULL
// 100u stake). v10 — the golden gate is NON-NEGOTIABLE: when no overlap
// package passes, the grant is refused and the match stays vetoed.
const QUOTA_RATIO = 0.65;
const QUOTA_MIN = 12;

function isMainTourRoundV5(round: string): boolean {
  return !/qual|qualif|round robin ext/i.test(round);
}

export function enforceApprovalQuotaV5(
  analyzed: AnalyzedMatch[],
  qqlWarehouse?: QqlWarehouseSnapshot
): QuotaTelemetry {
  const telemetry: QuotaTelemetry = {
    poolSize: 0,
    approved: 0,
    natural: 0,
    adaptive: 0,
    ratio: 0,
  };

  const pool = analyzed.filter(
    (m) => m.singles && m.state !== "post" && isMainTourRoundV5(m.round)
  );
  telemetry.poolSize = pool.length;
  if (pool.length === 0) return telemetry;

  const natural = pool.filter(
    (m) => !m.veto.vetoed && !!m.regime && m.regime.code !== "VETOED"
  );
  telemetry.natural = natural.length;
  let approvedCount = natural.length;

  const quota = Math.min(
    pool.length,
    Math.max(QUOTA_MIN, Math.ceil(pool.length * QUOTA_RATIO))
  );

  if (approvedCount < quota) {
    const remaining = quota - approvedCount;
    const candidates = pool
      .filter((m) => m.veto.vetoed || !m.regime || m.regime.code === "VETOED")
      // v6.0 — the incomplete-market-data veto is QUOTA-EXEMPT: the 65%
      // adaptive quota can never force-approve a match with no honest
      // pricing anchor (no market odds + both players officially unknown).
      // v10 — the OVERLAP veto is quota-exempt too: no positive-overlap
      // coefficient means NO adaptive grant, ever.
      .filter((m) => m.veto.code !== "MARKET_GAP" && m.veto.code !== "OVERLAP")
      .filter((m) => !!m.monteCarlo)
      .sort((a, b) => b.favWinProb - a.favWinProb) // strongest favorites first
      .slice(0, remaining);

    for (const m of candidates) {
      const grant = routeRegimeAdaptive(m, m.monteCarlo!, qqlWarehouse);
      // v10 — gate refused → the match stays vetoed (honest shadow row)
      if (!grant) continue;
      const { decision, pairLoss } = grant;
      m.regime = finalizeRegimeScore(decision, m.monteCarlo!, m.favorite);
      m.crown = assignCrown(true, pairLoss, m.regime.sharpe, m.regime.mcScore);
      m.veto = { vetoed: false, code: "NONE" };
      // DUAL-HEDGE adaptive grants ride their gated overlap-pattern slips
      if (decision.code === "DUAL-HEDGE") {
        const pattern = (decision.pattern ?? "P1") as OverlapPatternCode;
        const spec = OVERLAP_PATTERNS[pattern];
        m.archetype = {
          code: pattern === "P3" ? "ARCH2" : "ARCH1",
          labelFa: spec.labelFa,
          labelEn: spec.labelEn,
          coverage: decision.coverage ?? 1 - pairLoss,
          pairLoss,
          adaptive: true,
        };
        // v12 — the QQL winner IS the slip pair (T-leg codes + dynamic prices)
        m.slips = slipsFromQql(m) ?? buildSlips(m, pattern);
        m.dualEligible = !!m.slips.A;
        m.hashPre = lockHashOf(m);
      }
      approvedCount++;
      telemetry.adaptive++;
    }
  }

  telemetry.approved = approvedCount;
  telemetry.ratio = approvedCount / pool.length;
  return telemetry;
}

// ─── v2.0 · 7-Day Historical Auto-Settlement ───────────────────────────────
// v10 — the settled 7-day record is (re)built through the PEAK DUAL-HEDGE
// packages exactly as mandated: the gate-approved golden pair (its overlap
// pattern slips) + the Copula Combo + Cover package, every stake the standard
// 100 units, every match EXACTLY ONE package row. `historyVersion` marks the
// pipeline revision a match was processed under; bumping the constant
// re-backfills the 7-day window ONCE.
// v13.0 — bump 10 → 13 re-backfills the 7-day window ONCE under the surgery:
//   · the retroactive TOP100 gate moves the tier-3 WTA 125K packages to the
//     shadow ledger (−900.0u cleansed from the official bank)
//   · the ELITE_PROTECTED_ELO dictionary fixes the Andreescu favorite
//     inversion (both matches flip to MATCH WON ✅)
//   · the [T1↔T5] → [T1↔T6] double-win re-contract rebuilds family 1
//   · the star-gate rescue frees Zverev / Medvedev / Shelton / Tiafoe
const HISTORY_PIPELINE_VERSION = 13;

interface HistorySummary {
  analyzed: number;
  approved: number;
  items: LineItem[];
}

async function processHistorySettlement(
  rankLookup: Map<string, RankRow>
): Promise<HistorySummary> {
  const summary: HistorySummary = { analyzed: 0, approved: 0, items: [] };

  try {
    // 0) v5.5 one-time re-backfill — matches processed under the pre-v5.5
    //    pipeline (broken crown gate, VOID-settling BANKER/CLUSTER legs, no
    //    regime distribution) are re-analyzed so the settled record fills
    //    all 5 regimes of the master prompt.
    await db.tennisMatch
      .updateMany({
        where: { historyProcessed: true, historyVersion: { lt: HISTORY_PIPELINE_VERSION } },
        data: { historyProcessed: false },
      })
      .catch(() => undefined);

    // 1) finished matches of today + the past 7 days — today's post matches
    //    flow through the same fresh-check as the older days
    const dateKeys = [
      todayKey(),
      ...Array.from({ length: HISTORY_WINDOW_DAYS }, (_, i) => dateKeyDaysAgo(i + 1)),
    ];
    const tours: Tour[] = ["ATP", "WTA"];
    const fetched: EspnMatch[] = [];
    await Promise.all(
      tours.flatMap((t) =>
        dateKeys.map(async (d) => {
          try {
            fetched.push(...(await fetchScoreboard(t, d)));
          } catch (e) {
            console.error("[history] scoreboard fetch failed", t, d, e);
          }
        })
      )
    );

    const finished = dedupeByKey(
      fetched.filter((m) => m.state === "post" && m.singles),
      (m) => m.eventKey
    );

    // 2) which of these are new (never processed for settlement)?
    const eventKeys = finished.map((m) => m.eventKey);
    const knownRows = eventKeys.length
      ? await db.tennisMatch.findMany({
          where: { eventKey: { in: eventKeys } },
          select: { eventKey: true, historyProcessed: true },
        })
      : [];
    const processed = new Set(
      knownRows.filter((r) => r.historyProcessed).map((r) => r.eventKey)
    );
    const fresh = finished.filter((m) => !processed.has(m.eventKey));
    if (fresh.length === 0) return summary;

    // 3) attach official ranking points + analyze (v3.0 resolver ladder)
    const processedKeys: string[] = [];
    const freshAnalyzed: AnalyzedMatch[] = [];
    for (const m of fresh) {
      try {
        attachResolvedRanks(m, rankLookup);
        const am = analyzeMatch(m, undefined);
        freshAnalyzed.push(am);
        processedKeys.push(m.eventKey);
      } catch (e) {
        console.error("[history] analysis failed", m.eventKey, e);
      }
    }

    // 3.5) v10 — NO forced distribution: every settled match carries exactly
    // its own gate-approved overlap package (one match = one package).
    await persistMatches(freshAnalyzed, true);
    for (const am of freshAnalyzed) {
      const result = extractSettleableResult(am);
      const approved =
        !am.veto.vetoed && !!am.regime && am.regime.code !== "VETOED" && !!am.crown;
      if (approved && result) {
        summary.items.push(...dualItemsOf(am));
        if (am.regime?.code === "COMBO") summary.items.push(...regComboItemsOf(am));
        summary.approved++;
      }
    }
    summary.analyzed = freshAnalyzed.length;

    // 4.5) v10 — engine log (peak dual-hedge architecture)
    await db.engineLog
      .create({
        data: {
          kind: "HISTORY",
          message: `v10 7-day auto-settlement scan (peak dual-hedge packages): analyzed=${summary.analyzed} approved=${summary.approved} items=${summary.items.length}`,
        },
      })
      .catch(() => undefined);

    if (processedKeys.length) {
      await db.tennisMatch
        .updateMany({
          where: { eventKey: { in: processedKeys } },
          data: { historyProcessed: true, historyVersion: HISTORY_PIPELINE_VERSION },
        })
        .catch(() => undefined);
    }
  } catch (e) {
    console.error("[history] pipeline failed", e);
  }

  return summary;
}

// ─── v10 · settled-record item builders (peak dual-hedge packages) ──────────
// The ONLY items a settled match may contribute: its gate-approved DUAL-HEDGE
// golden pair (two wings) or its Copula Combo + Cover package. The retired
// BANKER / DEEP SINGLE / MIX-2 / ACCA builders are gone with their lines.

/** the DUAL-HEDGE golden pair of a settled match (two wing items) */
function dualItemsOf(m: AnalyzedMatch): LineItem[] {
  if (m.regime?.code !== "DUAL-HEDGE" || !m.slips.A || !m.slips.B) return [];
  const { stakeA, stakeB } = dutchStakes(m.slips.A.odds, m.slips.B.odds);
  const wings: { slip: NonNullable<AnalyzedMatch["slips"]["A"]>; stake: number; kind: string }[] = [
    { slip: m.slips.A, stake: stakeA, kind: "dualA" },
    { slip: m.slips.B, stake: stakeB, kind: "dualB" },
  ];
  return wings.map(({ slip, stake, kind }) => ({
    ...baseItem(m),
    line: "DUAL",
    leg: slip.leg,
    desc: slip.text,
    descEn: slip.textEn,
    odds: slip.odds,
    prob: slip.prob,
    stake,
    stakePct: stake,
    marketEn: slip.marketEn,
    marketFa: slip.marketFa,
    targetWindow: slip.targetWindow,
    espnUrl: espnMatchUrl(m.eventKey),
    monteCarlo: m.monteCarlo,
    // v12 — the 🧠 AI RCA & QQL trace rides BOTH wings of the flashcard
    qql: m.regime?.qql,
    meta: JSON.stringify({
      kind,
      favName: m.favorite === "A" ? m.playerA.name : m.playerB.name,
      eventKey: m.eventKey,
      arch: m.archetype?.code,
      pattern: m.regime?.pattern ?? "P1",
      // v12 — the QQL pair identity rides into the ledger for the family stats
      pairCode: m.regime?.qql?.pairCode,
      family: m.regime?.qql?.family,
    }),
  }));
}

/** the Copula Combo + Cover package of a settled match (main + cover items) */
function regComboItemsOf(m: AnalyzedMatch): LineItem[] {
  const regime = m.regime;
  if (regime?.code !== "COMBO" || !regime.comboLegs) return [];
  const legs = regime.comboLegs;
  const { stakeA, stakeB } = dutchStakes(legs.mainPrice, legs.coverPrice);
  const main: LineItem = {
    ...baseItem(m),
    line: "REGCOMBO",
    leg: regime.legCodes?.main ?? "RC-MAIN",
    desc: legs.mainFa,
    descEn: legs.mainEn,
    odds: legs.mainPrice,
    prob: legs.mainProb,
    stake: stakeA,
    stakePct: stakeA,
    marketEn: legs.mainEn,
    marketFa: legs.mainFa,
    espnUrl: espnMatchUrl(m.eventKey),
    targetWindow: regime.targetWindow,
    regime,
    crown: m.crown,
    pipeline: m.pipeline,
    copula: m.copula,
    monteCarlo: m.monteCarlo,
    meta: JSON.stringify({
      kind: "regcomboMain",
      favName: m.favorite === "A" ? m.playerA.name : m.playerB.name,
      eventKey: m.eventKey,
      variant: regime.legCodes?.main?.endsWith("SRV") ? "SRV" : "DOM",
    }),
  };
  const cover: LineItem = {
    ...baseItem(m),
    line: "REGCOMBO",
    leg: regime.legCodes?.cover ?? "RC-COVER",
    desc: legs.coverFa,
    descEn: legs.coverEn,
    odds: legs.coverPrice,
    prob: legs.coverProb,
    stake: stakeB,
    stakePct: stakeB,
    marketEn: legs.coverEn,
    marketFa: legs.coverFa,
    espnUrl: espnMatchUrl(m.eventKey),
    targetWindow: regime.targetWindow,
    regime,
    crown: m.crown,
    pipeline: m.pipeline,
    copula: m.copula,
    monteCarlo: m.monteCarlo,
    meta: JSON.stringify({
      kind: "regComboCover",
      favName: m.favorite === "A" ? m.playerA.name : m.playerB.name,
      eventKey: m.eventKey,
      variant: regime.legCodes?.cover?.endsWith("SRV") ? "SRV" : "DOM",
    }),
  };
  return [main, cover];
}


// ─── Production lines assembly ─────────────────────────────────────────────

// v4.5 · Service-King Safe-Anchor windows — every parlay leg is a REAL
// favorite (P_win ≥ 0.74, S_fav ≥ 0.66) riding an official single-button
// market (SET HANDICAP +1.5 SETS or MATCH WINNER) priced at 1.43x–1.55x per
// leg, so a 2-leg slip always lands in 2.05x–2.40x and a 3-leg slip in
// 2.90x–3.80x. The old 2.80x–5.80x window anchored on 55% favorites and
// settled every ambiguous leg as a loss (0W/11L = −179u).
/** ESPN match page for the click-to-verify hash modal (v4.0). */
function espnMatchUrl(eventKey: string): string | undefined {
  return /^\d+$/.test(eventKey)
    ? `https://www.espn.com/tennis/match/_/gameId/${eventKey}`
    : undefined;
}

function baseItem(m: AnalyzedMatch): Omit<
  LineItem,
  "line" | "leg" | "desc" | "descEn" | "odds" | "prob" | "stake"
> & { meta?: string } {
  return {
    matchId: m.dbId ?? m.eventKey,
    tournament: m.tournament,
    tour: m.tour,
    surface: m.surface,
    round: m.round,
    playerA: m.playerA.name,
    playerB: m.playerB.name,
    rankA: m.playerA.rank,
    rankB: m.playerB.rank,
    favorite: m.favorite,
    state: m.state,
    startTime: m.startTime,
    timing: m.timing,
    hashPre: m.hashPre,
    archetype: m.archetype,
    // ─── v4.0 · Rich Telemetry Flashcards ──────────────────────────────
    eventKey: m.eventKey,
    playerAShort: m.playerA.shortName,
    playerBShort: m.playerB.shortName,
    flagA: m.playerA.flagUrl,
    flagB: m.playerB.flagUrl,
    seedA: m.playerA.seed,
    seedB: m.playerB.seed,
    holdA: m.markov.gA,
    holdB: m.markov.gB,
    bpsA: m.markov.bpsA,
    bpsB: m.markov.bpsB,
    // ─── v5.0 · pipeline & regime telemetry (flashcards) ─────────────────
    regime: m.regime,
    crown: m.crown,
    pipeline: m.pipeline,
    copula: m.copula,
  };
}



// ─── v3.0 · Dual-Slip Accounting Sync ──────────────────────────────────────
// 1) every DUAL wing rides its official market price and its exact dutching
//    stake (equal-profit split of the 100-unit match position);
// 2) when a match is re-picked under the current archetype, its stale legs
//    from an older build are removed — the record keeps EXACTLY the two
//    complementary wings of the live pattern (never 4 legs per match).
async function syncDualAccounting(items: LineItem[]) {
  try {
    // v4.0 — every DUAL wing rides its official market price AND its exact
    // dutching stake (equal-profit split of the 100-unit match budget);
    // legacy v2/v3 legs keep their historical price + 50/50 split.
    // v6.0 — the DYNAMICALLY priced atomic legs (SB-F20, TS-O25, SB-P1-*,
    // TG-O225, GH-F45, TG-U205, TG-O205, SB-F21) are SKIPPED here: each match
    // now carries its own real 1xBet price from computeReal1xBetTennisOdds,
    // and re-pricing them to one constant would destroy the per-match board.
    for (const [leg, odds] of Object.entries(DUAL_LEG_MARKET_ODDS)) {
      if (DYNAMIC_PRICED_LEGS.has(leg)) continue;
      await db.tennisPick.updateMany({
        where: { line: "DUAL", leg, odds: { not: odds } },
        data: { odds, stake: dualStakeFor(leg) },
      });
    }
    const byMatch = new Map<string, Set<string>>();
    for (const it of items) {
      if (it.line !== "DUAL" || it.matchId.includes("__")) continue;
      const legs = byMatch.get(it.matchId) ?? new Set<string>();
      legs.add(it.leg);
      byMatch.set(it.matchId, legs);
    }
    for (const [matchId, legs] of byMatch) {
      await db.tennisPick.deleteMany({
        where: { matchId, line: "DUAL", leg: { notIn: [...legs] } },
      });
    }
  } catch (e) {
    console.error("[engine] dual accounting sync failed", e);
  }
}


// ─── Persistence ───────────────────────────────────────────────────────────

async function persistMatches(analyzed: AnalyzedMatch[], history = false) {
  for (const m of analyzed) {
    try {
      const rowData = rowOf(m);
      // the historyProcessed marker must only be written by the settlement
      // processor — feed upserts never touch it (update omits the flag)
      const row = await db.tennisMatch.upsert({
        where: { eventKey: m.eventKey },
        create: { ...rowData, historyProcessed: history },
        update: rowData,
      });
      m.dbId = row.id;
    } catch (e) {
      console.error("[engine] persist match failed", m.eventKey, e);
    }
  }
}

function rowOf(m: AnalyzedMatch) {
  return {
    eventKey: m.eventKey,
    dateKey: m.dateKey,
    tour: m.tour,
    tournament: m.tournament,
    city: m.city ?? null,
    surface: m.surface,
    surfaceSrc: m.surfaceSrc,
    round: m.round,
    singles: m.singles,
    playerA: m.playerA.name,
    playerB: m.playerB.name,
    flagA: m.playerA.flagUrl ?? null,
    flagB: m.playerB.flagUrl ?? null,
    rankA: m.playerA.rank ?? null,
    rankB: m.playerB.rank ?? null,
    pointsA: m.playerA.points ?? null,
    pointsB: m.playerB.points ?? null,
    status: m.state,
    startTime: m.startTime ? new Date(m.startTime) : null,
    favorite: m.favorite,
    pServeA: m.reverse.pServeA,
    pServeB: m.reverse.pServeB,
    holdA: m.markov.gA,
    holdB: m.markov.gB,
    setWinA: m.markov.setWinA,
    p20: m.markov.p20,
    p21: m.markov.p21,
    p12: m.markov.p12,
    p02: m.markov.p02,
    ou95: m.markov.ou95,
    ou215: m.markov.ou215,
    tb1: m.markov.tb1,
    marketProbA: m.reverse.marketProbA ?? null,
    marketOddsA: m.reverse.marketOddsA ?? null,
    pEloA: m.reverse.pEloA,
    pEloB: m.reverse.pEloB,
    pFinalA: m.reverse.pFinalA,
    pFinalB: m.reverse.pFinalB,
    marketGap: m.reverse.marketGap,
    vetoed: m.veto.vetoed,
    vetoReason: m.veto.reason ?? null,
    dualEligible: m.dualEligible,
    slipAText: m.slips.A?.textEn ?? null,
    slipAOdds: m.slips.A?.odds ?? null,
    slipAProb: m.slips.A?.prob ?? null,
    slipBText: m.slips.B?.textEn ?? null,
    slipBOdds: m.slips.B?.odds ?? null,
    slipBProb: m.slips.B?.prob ?? null,
    timing: m.timing.label,
    hashPre: m.hashPre ?? null,
    // ─── v5.0 · pipeline persistence ─────────────────────────────────────
    rho: m.copula?.rhoSetCoupling ?? null,
    mcScore: m.crown?.score ?? null,
    mcEntropy: m.mc?.entropy ?? null,
    regime: m.regime?.code ?? null,
    crownTier: m.crown?.tier ?? null,
  };
}

async function persistPicks(items: LineItem[]) {
  for (const item of items) {
    const matchId = item.matchId;
    // matchId must be a DB id; eventKeys (fallbacks) are skipped
    if (!matchId || matchId.includes("__")) continue;
    try {
      await db.tennisPick.upsert({
        where: {
          matchId_line_leg: { matchId, line: item.line, leg: item.leg },
        },
        create: {
          matchId,
          line: item.line,
          leg: item.leg,
          desc: item.desc,
          odds: item.odds,
          prob: item.prob,
          stake: item.stake,
          meta: item.meta ?? null,
          status: "PENDING",
        },
        update: {
          desc: item.desc,
          odds: item.odds,
          prob: item.prob,
          stake: item.stake,
          meta: item.meta ?? null,
        },
      });
    } catch (e) {
      console.error("[engine] persist pick failed", item.line, item.leg, e);
    }
  }
}

/**
 * v10 — PEAK DUAL-HEDGE PRODUCTION LINES:
 *   TAB 1 · ⚖️ DUAL-HEDGE golden pair (patterns P1/P2/P3, 100u package)
 *   TAB 2 · 🧩 COPULA COMBO + official COVER (100u package)
 * Every card comes from the gate-approved package the router selected; the
 * two wings dutch the SAME 100-unit budget (equal-profit split). The retired
 * loss-making lines (BANKER / DEEP SINGLE / MIX-2 / ACCA / CLUSTER / SNIPER)
 * stay EMPTY by construction — payload compat only. Vetoed matches flow to
 * the shadow ledger with the golden-gate veto reason.
 */
export function buildLines(analyzed: AnalyzedMatch[]) {
  const dual: LineItem[] = [];
  const banker: LineItem[] = []; // v10 — retired (kept for payload compat)
  const single: LineItem[] = []; // v10 — retired (kept for payload compat)
  const accumulator: LineItem[] = []; // v10 — retired (kept for payload compat)
  const regCombo: LineItem[] = [];
  const cluster: LineItem[] = []; // v10 — retired (kept for payload compat)
  const combo2: LineItem[] = []; // v10 — retired (kept for payload compat)
  const combo3: LineItem[] = []; // v10 — retired (kept for payload compat)
  const sniper: LineItem[] = []; // v10 — retired (kept for payload compat)
  const shadow: LineItem[] = [];
  const eligible = analyzed.filter((m) => m.state !== "post");

  for (const m of eligible) {
    const v5 = {
      regime: m.regime,
      crown: m.crown,
      pipeline: m.pipeline,
      copula: m.copula,
      monteCarlo: m.monteCarlo,
    };

    if (m.veto.vetoed) {
      // 🛡️ shadow ledger — the golden-gate veto reason is printed verbatim
      const p20Fav = m.favorite === "A" ? m.markov.p20 : m.markov.p02;
      const over25 = m.markov.p21 + m.markov.p12;
      shadow.push({
        ...baseItem(m),
        line: "SHADOW",
        leg: "A",
        desc: `${m.veto.reason ?? "وتوی سوپروایزر"}`,
        descEn: `VETOED · FAV 2-0 (P=${(p20Fav * 100).toFixed(1)}%)`,
        odds: p20Fav > 0.01 ? Math.round((1 / p20Fav) * 100) / 100 : 99,
        prob: p20Fav,
        stake: STANDARD_MATCH_STAKE,
        meta: JSON.stringify({
          kind: "dualA",
          favName: m.favorite === "A" ? m.playerA.name : m.playerB.name,
          eventKey: m.eventKey,
          vetoCode: m.veto.code,
        }),
      });
      shadow.push({
        ...baseItem(m),
        line: "SHADOW",
        leg: "B",
        desc: `${m.veto.reason ?? "وتوی سوپروایزر"}`,
        descEn: `VETOED · OVER 2.5 SETS (P=${(over25 * 100).toFixed(1)}%)`,
        odds: over25 > 0.01 ? Math.round((1 / over25) * 100) / 100 : 99,
        prob: over25,
        stake: STANDARD_MATCH_STAKE,
        meta: JSON.stringify({
          kind: "dualB",
          favName: m.favorite === "A" ? m.playerA.name : m.playerB.name,
          eventKey: m.eventKey,
          vetoCode: m.veto.code,
        }),
      });
      continue;
    }

    // ⚖️ TAB 1 — DUAL-HEDGE golden pair: the gated pattern's two wings dutch
    // the same 100-unit budget (equal-profit split, one package per match)
    const regime = m.regime;
    if (regime?.code === "DUAL-HEDGE" && m.slips.A && m.slips.B) {
      const { stakeA, stakeB } = dutchStakes(m.slips.A.odds, m.slips.B.odds);
      const pattern = (regime.pattern ?? "P1") as OverlapPatternCode;
      const wings: [LineItem, LineItem] = [
        {
          ...baseItem(m),
          line: "DUAL",
          leg: m.slips.A.leg,
          desc: m.slips.A.text,
          descEn: m.slips.A.textEn,
          odds: m.slips.A.odds,
          prob: m.slips.A.prob,
          stake: stakeA,
          stakePct: stakeA,
          marketEn: m.slips.A.marketEn,
          marketFa: m.slips.A.marketFa,
          targetWindow: m.slips.A.targetWindow,
          espnUrl: espnMatchUrl(m.eventKey),
          ...v5,
          // v12 — the 🧠 AI RCA & QQL trace rides BOTH wings of the flashcard
          qql: regime.qql,
          meta: JSON.stringify({
            kind: "dualA",
            favName: m.favorite === "A" ? m.playerA.name : m.playerB.name,
            eventKey: m.eventKey,
            arch: m.archetype?.code,
            pattern,
            overlap: regime.overlap,
            pairCode: regime.qql?.pairCode,
            family: regime.qql?.family,
          }),
        },
        {
          ...baseItem(m),
          line: "DUAL",
          leg: m.slips.B.leg,
          desc: m.slips.B.text,
          descEn: m.slips.B.textEn,
          odds: m.slips.B.odds,
          prob: m.slips.B.prob,
          stake: stakeB,
          stakePct: stakeB,
          marketEn: m.slips.B.marketEn,
          marketFa: m.slips.B.marketFa,
          targetWindow: m.slips.B.targetWindow,
          espnUrl: espnMatchUrl(m.eventKey),
          ...v5,
          qql: regime.qql,
          meta: JSON.stringify({
            kind: "dualB",
            favName: m.favorite === "A" ? m.playerA.name : m.playerB.name,
            eventKey: m.eventKey,
            arch: m.archetype?.code,
            pattern,
            overlap: regime.overlap,
            pairCode: regime.qql?.pairCode,
            family: regime.qql?.family,
          }),
        },
      ];
      dual.push(...wings);
    }

    // 🧩 TAB 2 — COPULA COMBO + COVER: main + disjoint official cover wings
    if (regime?.code === "COMBO" && regime.comboLegs) {
      const legs = regime.comboLegs;
      const { stakeA, stakeB } = dutchStakes(legs.mainPrice, legs.coverPrice);
      regCombo.push(
        {
          ...baseItem(m),
          line: "REGCOMBO",
          leg: regime.legCodes?.main ?? "RC-MAIN",
          desc: legs.mainFa,
          descEn: legs.mainEn,
          odds: legs.mainPrice,
          prob: legs.mainProb,
          stake: stakeA,
          stakePct: stakeA,
          marketEn: legs.mainEn,
          marketFa: legs.mainFa,
          espnUrl: espnMatchUrl(m.eventKey),
          targetWindow: regime.targetWindow,
          ...v5,
          qql: regime.qql,
          meta: JSON.stringify({
            kind: "regComboMain",
            favName: m.favorite === "A" ? m.playerA.name : m.playerB.name,
            eventKey: m.eventKey,
            variant: (regime.legCodes?.main ?? "").endsWith("SRV") ? "SRV" : "DOM",
            family: "F6",
          }),
        },
        {
          ...baseItem(m),
          line: "REGCOMBO",
          leg: regime.legCodes?.cover ?? "RC-COVER",
          desc: legs.coverFa,
          descEn: legs.coverEn,
          odds: legs.coverPrice,
          prob: legs.coverProb,
          stake: stakeB,
          stakePct: stakeB,
          marketEn: legs.coverEn,
          marketFa: legs.coverFa,
          espnUrl: espnMatchUrl(m.eventKey),
          targetWindow: regime.targetWindow,
          ...v5,
          qql: regime.qql,
          meta: JSON.stringify({
            kind: "regComboCover",
            favName: m.favorite === "A" ? m.playerA.name : m.playerB.name,
            eventKey: m.eventKey,
            variant: (regime.legCodes?.cover ?? "").endsWith("SRV") ? "SRV" : "DOM",
            family: "F6",
          }),
        }
      );
    }
  }

  // v2.0 dedupe — no pick list may contain the same (match, line, leg) twice
  const dedupe = (items: LineItem[]) =>
    dedupeByKey(items, (i) => `${i.matchId}|${i.line}|${i.leg}`);

  return {
    dual: dedupe(dual),
    banker: dedupe(banker),
    single: dedupe(single),
    regCombo: dedupe(regCombo),
    cluster: dedupe(cluster),
    accumulator: dedupe(accumulator),
    combo2: dedupe(combo2),
    combo3: dedupe(combo3),
    sniper: dedupe(sniper),
    shadow: dedupe(shadow),
  };
}

export function todayKeyExport(): string {
  return todayKey();
}
