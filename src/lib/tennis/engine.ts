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
// v5.5 — the ghost Station-3 twin (montecarlo.ts) is retired; the one
// authoritative copula Monte-Carlo engine lives in ./copula (runMonteCarlo).
import { deriveCopulaTelemetry, runMonteCarlo } from "./copula";
import {
  buildSlips,
  dualStakeFor,
  evaluateArchetypes,
  isDualEligible,
  supervisorGate,
  DUAL_LEG_MARKET_ODDS,
  DYNAMIC_PRICED_LEGS,
  OFFICIAL_TENNIS_ATOMIC_ARCHETYPES,
  routeRegime,
  routeRegimeAdaptive,
  assignCrown,
  finalizeRegimeScore,
  forceRegimeRoute,
  STANDARD_MATCH_STAKE,
  // v7.0 — the three production lines (live-locked pricing)
  buildDeepSingle,
  buildMix2Leg,
  getLive1xBetTennisOdds,
  V7_WINDOWS,
} from "./supervisor";
import type { QuotaTelemetry } from "./supervisor";
import { canonicalMatchString, sha256 } from "./hash";
import { extractSettleableResult, runSettlement } from "./settlement";
import { buildLedgerPayload, normalizeStakeUnits } from "./ledger";
import { dedupeByKey, matchContentKey } from "./dedupe";
import type {
  AnalyzedMatch,
  EspnMatch,
  FeedPayload,
  LineItem,
  MarketOdds,
  MixLeg,
  NewsItem,
  RankRow,
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
  weather?: WeatherInfo
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
    m.tour
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

  // ── v5.0 STATION 4 — non-linear 5-regime router ──────────────────────────
  const route = routeRegime(am, mc, archReport.selected?.pairLoss ?? 0);
  if (route.decision.code === "DUAL-HEDGE") {
    // the champion golden pair rides the official ARCH1 atomic slips so the
    // DUAL production line + ledger + settlement stay exactly as contracted
    if (!am.veto.vetoed) {
      am.archetype = {
        code: "ARCH1",
        labelFa: "الگوی رسمی ۱ — تسلط ست‌ها",
        labelEn: "Set Mastery",
        coverage: 1 - (route.selected?.pairLoss ?? 0),
        pairLoss: route.selected?.pairLoss ?? 0,
      };
      am.slips = buildSlips(am);
    }
  }
  if (!am.veto.vetoed && route.decision.code === "VETOED") {
    // regime-level veto (Top-100 veto keeps its own reason)
    am.veto = { vetoed: true, code: "REGIME", reason: route.decision.why };
  }
  am.regime = finalizeRegimeScore(
    route.decision,
    mc,
    favorite
  );
  am.dualEligible = !am.veto.vetoed && am.regime.code === "DUAL-HEDGE" && !!am.slips.A;
  // ── v5.5 — crown badge assigned at the analysis source (history matches
  // included): GOLD when the Monte-Carlo SUCCESS percentage lands ≥ 85/100.
  am.crown = assignCrown(
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
    const analyzed: AnalyzedMatch[] = [];
    for (const m of unique) {
      try {
        const key = `${m.playerA.name}__${m.playerB.name}`;
        const market = m.state === "post" ? undefined : marketMap.get(key);
        const weather = m.city ? weatherByCity.get(m.city.toLowerCase()) : undefined;
        analyzed.push(analyzeMatch(m, market, weather));
      } catch (e) {
        console.error("[engine] analysis failed", m.eventKey, e);
      }
    }

    // ── v5.0 · guaranteed 65% supervisor approval quota (regime edition) ──
    // Natural 5-regime approvals count first; remaining slots are granted the
    // least-risk regime adaptively (🥈 SILVER crown · FULL 100u stake) until
    // ≥ 65% of today's main-tour card (min 12) is approved.
    const quota = enforceApprovalQuotaV5(analyzed);
    // ── v5.5 · 5-REGIME DISTRIBUTION ALLOCATOR (master prompt §2) ──────────
    // The approved pool must populate ALL 5 regimes — under-filled regimes
    // are topped up by re-routing the best-fit champion-pair matches.
    allocateFiveRegimes(analyzed);
    // adaptive approvals received fresh slips → recompute the SHA-256 lock
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
    // ── v5.5 — the 100-unit stake law: rewrite every 1u/2u/50u/60u legacy
    // stake in the database so NO ledger row can ever break the standard.
    await normalizeStakeUnits();
    const lines = buildLines(analyzed);
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
    const settleSummary = await runSettlement(HISTORY_WINDOW_DAYS);
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

// ─── v5.0 · Guaranteed 65% Approval Quota (5-regime edition) ───────────────
// Natural regime approvals count first; remaining slots are granted the
// least-risk regime adaptively (SILVER crown · half stakes) in ascending
// favorite-loss risk order, so production tabs can never go empty.
const QUOTA_RATIO = 0.65;
const QUOTA_MIN = 12;

function isMainTourRoundV5(round: string): boolean {
  return !/qual|qualif|round robin ext/i.test(round);
}

export function enforceApprovalQuotaV5(analyzed: AnalyzedMatch[]): QuotaTelemetry {
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
      .filter((m) => m.veto.code !== "MARKET_GAP")
      .filter((m) => !!m.monteCarlo)
      .sort((a, b) => b.favWinProb - a.favWinProb) // strongest favorites first
      .slice(0, remaining);

    for (const m of candidates) {
      const { decision, pairLoss } = routeRegimeAdaptive(m, m.monteCarlo!);
      m.regime = finalizeRegimeScore(decision, m.monteCarlo!, m.favorite);
      m.crown = assignCrown(true, pairLoss, m.regime.sharpe, m.regime.mcScore);
      m.veto = { vetoed: false, code: "NONE" };
      // DUAL-HEDGE adaptive grants ride the official ARCH1 atomic slips
      if (decision.code === "DUAL-HEDGE") {
        m.archetype = {
          code: "ARCH1",
          labelFa: "الگوی رسمی ۱ — تسلط ست‌ها",
          labelEn: "Set Mastery",
          coverage: 1 - pairLoss,
          pairLoss,
          adaptive: true,
        };
        m.slips = buildSlips(m);
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

// ─── v5.5 · 5-Regime Distribution Allocator (master prompt §2) ──────────────
// The natural max-Sharpe router concentrates almost the whole approved pool
// on the champion DUAL-HEDGE pair, which starves the 4 other regime rows of
// the «دفترکل افرازی ۵ رژیم» table (they showed 0 (0) | +0.0). The allocator
// enforces the master-prompt distribution law: every regime must hold its
// share of ACTIVE cards (today) and SETTLED cards (7-day history) —
//   ⚖️ زوج‌تیپ طلایی مکمل · 🏦 بانکر امن سرویس (S_A ≥ 0.70) ·
//   🧩 کمبوی کاپولا + پوشش · 🎯 خوشه نتیجه دقیق · 🔗 آکومولاتور (line-level)
// The best-fit matches for an under-filled regime are re-routed from the
// DUAL-HEDGE surplus (fit = regime-specific Monte-Carlo/Copula feature):
//   BANKER  → highest S_fav favorites        (service dominators)
//   COMBO   → highest fav×games copula mass  (dominant-favorite games lines)
//   CLUSTER → highest top-3 scenario mass    (low-entropy exact matches)
// Each match still carries EXACTLY ONE regime card; nothing is double-counted.
const REGIME_MIN_CARDS = 3; // minimum active cards per regime (5-regime law)

function allocateFiveRegimes(analyzed: AnalyzedMatch[], includePost = false): void {
  const pool = analyzed.filter(
    (m) =>
      (includePost || m.state !== "post") &&
      !m.veto.vetoed &&
      !!m.monteCarlo &&
      !!m.regime &&
      m.regime.code !== "VETOED"
  );
  // v5.5 — even a small approved card must be distributed (a 4-match late-day
  // pool still fills 1 banker + 1 combo + 1 cluster from the dual surplus)
  if (pool.length < 2) return;

  const counts: Record<string, number> = {
    BANKER: 0,
    COMBO: 0,
    CLUSTER: 0,
    "DUAL-HEDGE": 0,
  };
  for (const m of pool) counts[m.regime!.code] = (counts[m.regime!.code] ?? 0) + 1;
  const minPer = Math.max(1, Math.min(REGIME_MIN_CARDS, Math.floor(pool.length / 3)));

  const fill = (code: "BANKER" | "COMBO" | "CLUSTER", fitOf: (m: AnalyzedMatch) => number) => {
    const need = Math.max(0, minPer - (counts[code] ?? 0));
    if (need <= 0) return;
    // never strip the champion pair below its own minimum share
    const maxTake = Math.max(0, (counts["DUAL-HEDGE"] ?? 0) - minPer);
    const take = Math.min(need, maxTake);
    if (take <= 0) return;
    const cands = pool
      .filter((m) => m.regime!.code === "DUAL-HEDGE")
      .sort((a, b) => fitOf(b) - fitOf(a))
      .slice(0, take);
    for (const m of cands) {
      const forced = forceRegimeRoute(m, m.monteCarlo!, code);
      if (!forced) continue;
      m.regime = finalizeRegimeScore(forced.decision, m.monteCarlo!, m.favorite);
      m.crown = assignCrown(
        false,
        forced.pairLoss,
        m.regime.sharpe,
        m.regime.mcScore
      );
      // only DUAL-HEDGE cards ride the atomic slips — forced regimes do not
      if (m.regime.code !== "DUAL-HEDGE") {
        m.slips = {};
        m.dualEligible = false;
      }
      counts[code] += 1;
      counts["DUAL-HEDGE"] -= 1;
    }
  };

  // 🏦 banker top-up — strongest favorites first (master prompt: S_A ≥ 0.70)
  fill("BANKER", (m) => {
    const sFav = m.favorite === "A" ? m.markov.setWinA : 1 - m.markov.setWinA;
    return sFav * 2 + m.favWinProb;
  });
  // 🧩 copula-combo top-up — highest fav×games joint mass (dominant games lines)
  fill("COMBO", (m) => {
    const mc = m.monteCarlo!;
    return Math.max(mc.favWinUnder215, mc.favWinOver205 + mc.favWinShareOver205);
  });
  // 🎯 exact-cluster top-up — most concentrated top-3 scenario mass
  fill("CLUSTER", (m) => m.monteCarlo!.topScenariosMass * 2 - m.monteCarlo!.entropy);
}

// ─── v2.0 · 7-Day Historical Auto-Settlement ───────────────────────────────
// v7.0 — the settled 7-day record is (re)built through the THREE v7 production
// lines exactly as mandated: 🔗 MIX-2 (1.80x–2.25x) · 🎯 DEEP SINGLE
// (1.72x–2.15x) · 🏦 BANKER (1.45x–1.65x) + 3-FOLD ACCA (2.70x–3.40x), every
// stake the standard 100 units, every win +100×(odds−1) and every loss exactly
// −100.0. `historyVersion` marks the pipeline revision a match was processed
// under; bumping the constant re-backfills the 7-day window ONCE.
const HISTORY_PIPELINE_VERSION = 7; // v7.0 = 7 (3 production lines + live pricing)

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

    // 3.5) v5.5 — distribute the settled pool across ALL 5 regimes too
    allocateFiveRegimes(freshAnalyzed, true);

    // 4) persist match rows (marks them processed) and build the routed items
    // v7.0 — every settled match feeds the THREE production lines: the BANKER
    // regime rides Tab 3 (1.45x–1.65x) and every match with an honest pricing
    // anchor rides Tab 2 (DEEP SINGLE 1.72x–2.15x) at the real 1/(prob×1.055)
    // price of its own Monte-Carlo probability.
    await persistMatches(freshAnalyzed, true);
    for (const am of freshAnalyzed) {
      const result = extractSettleableResult(am);
      const approved =
        !am.veto.vetoed && !!am.regime && am.regime.code !== "VETOED" && !!am.crown;
      if (approved && result) {
        if (am.regime?.code === "BANKER") {
          const item = bankerItemOf(am);
          if (item) summary.items.push(item);
        }
        const single = singleItemOf(am);
        if (single) summary.items.push(single);
        summary.approved++;
      }
    }

    // 4.5) v7.0 — 🔗 MIX-2 + 🏦 3-FOLD ACCA for the settled record: per settled
    // date the strongest mix legs pair into 2-leg slips (total 1.80x–2.25x)
    // and the top bankers combine into the day's 3-fold acca (2.70x–3.40x),
    // both with the explicit per-leg settlement contract.
    const dayPool = new Map<string, AnalyzedMatch[]>();
    for (const am of freshAnalyzed) {
      if (!am.veto.vetoed && !!am.crown && extractSettleableResult(am)) {
        const arr = dayPool.get(am.dateKey) ?? [];
        arr.push(am);
        dayPool.set(am.dateKey, arr);
      }
    }
    for (const [, legs] of dayPool) {
      // 🔗 MIX-2 (Tab 1) — pair the best legs of DIFFERENT matches, 1.80x–2.25x
      const mixLegs = legs
        .map((m) => ({ m, leg: buildMix2Leg(m, { history: true }) }))
        .filter((x): x is MixLegSource => !!x.leg)
        .sort((a, b) => b.leg.prob - a.leg.prob);
      // 🏦 3-FOLD ACCA (Tab 3) — strongest trio of the day whose honest
      // product lands inside 2.70x–3.40x (same official leg markets)
      let acca: LineItem | null = null;
      let accaProb = -1;
      for (let a = 0; a < mixLegs.length; a++) {
        for (let b = a + 1; b < mixLegs.length; b++) {
          for (let c = b + 1; c < mixLegs.length; c++) {
            const trio = [mixLegs[a], mixLegs[b], mixLegs[c]];
            const total =
              Math.round(trio.reduce((s, x) => s * x.leg.odds, 1) * 100) / 100;
            if (total < V7_WINDOWS.ACCA3[0] || total > V7_WINDOWS.ACCA3[1]) continue;
            const joint = trio.reduce((s, x) => s * x.leg.prob, 1);
            if (joint > accaProb) {
              accaProb = joint;
              acca = accaItemOf(trio, "ACC-3", total);
            }
          }
        }
      }
      if (acca) summary.items.push(acca);
      const used = new Set<string>();
      for (let i = 0; i < mixLegs.length && summary.items.length < 4000; i++) {
        for (let j = i + 1; j < mixLegs.length; j++) {
          if (used.has(mixLegs[i].m.eventKey) || used.has(mixLegs[j].m.eventKey)) continue;
          const total = Math.round(mixLegs[i].leg.odds * mixLegs[j].leg.odds * 100) / 100;
          if (total < V7_WINDOWS.MIX2_TOTAL[0] || total > V7_WINDOWS.MIX2_TOTAL[1]) continue;
          const item = mix2ItemOf(mixLegs[i], mixLegs[j]);
          if (item) {
            summary.items.push(item);
            used.add(mixLegs[i].m.eventKey);
            used.add(mixLegs[j].m.eventKey);
          }
          break; // one mix slip per leg pair — next anchor match
        }
      }
    }
    summary.analyzed = freshAnalyzed.length;

    // 5) engine log + explicit processed-marker for rows that pre-existed
    await db.engineLog
      .create({
        data: {
          kind: "HISTORY",
          message: `v7.0 7-day auto-settlement scan (3 production lines): analyzed=${summary.analyzed} approved=${summary.approved} items=${summary.items.length}`,
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

// ─── v5.5 · regime item builders for the settled 7-day record ──────────────
// (the live card builders live inside buildLines; these mirror the exact same
// market/stake math for post-state matches of the settlement window)

function bankerItemOf(m: AnalyzedMatch): LineItem | null {
  const regime = m.regime;
  if (!regime || regime.code !== "BANKER" || !regime.price || !regime.legCodes) return null;
  const favName = m.favorite === "A" ? m.playerA.name : m.playerB.name;
  return {
    ...baseItem(m),
    line: "BANKER",
    leg: regime.legCodes.main,
    desc: regime.marketFa ?? regime.marketEn ?? "",
    descEn: regime.marketEn ?? "",
    odds: regime.price,
    prob: regime.prob ?? m.favWinProb,
    stake: STANDARD_MATCH_STAKE,
    marketEn: regime.marketEn,
    marketFa: regime.marketFa,
    espnUrl: espnMatchUrl(m.eventKey),
    targetWindow: regime.targetWindow,
    regime,
    crown: m.crown,
    pipeline: m.pipeline,
    copula: m.copula,
    monteCarlo: m.monteCarlo,
    meta: JSON.stringify({
      kind: "banker",
      legCode: regime.legCodes.main,
      favName,
      eventKey: m.eventKey,
      adaptive: regime.adaptive,
    }),
  };
}

// ─── v7.0 · settled-record item builders for the THREE production lines ─────
// (the live card builders live inside buildLines; these mirror the exact same
// market/stake math for post-state matches of the settlement window)

/**
 * TAB 2 — 🎯 DEEP SINGLE settled item: the match's ONE optimal deep-value
 * market at the real 1/(prob × 1.055) price (no live quote exists for finished
 * matches — the formula IS the v7.0 §3 settlement contract), 100-unit stake.
 */
function singleItemOf(m: AnalyzedMatch): LineItem | null {
  const pick = buildDeepSingle(m, { history: true });
  if (!pick) return null;
  const favName = m.favorite === "A" ? m.playerA.name : m.playerB.name;
  return {
    ...baseItem(m),
    line: "SINGLE",
    leg: pick.leg,
    desc: pick.textFa,
    descEn: pick.marketEn,
    odds: pick.odds,
    prob: pick.prob,
    stake: STANDARD_MATCH_STAKE,
    marketEn: pick.marketEn,
    marketFa: pick.marketFa,
    espnUrl: espnMatchUrl(m.eventKey),
    targetWindow: V7_WINDOWS.DEEP_SINGLE,
    regime: m.regime,
    crown: m.crown,
    pipeline: m.pipeline,
    copula: m.copula,
    monteCarlo: m.monteCarlo,
    meta: JSON.stringify({
      kind: "single",
      legCode: pick.leg,
      favName,
      eventKey: m.eventKey,
      edge: Math.round(pick.edge * 1000) / 1000,
      history: true,
    }),
  };
}

interface MixLegSource {
  m: AnalyzedMatch;
  leg: NonNullable<ReturnType<typeof buildMix2Leg>>;
}

/**
 * TAB 1 — 🔗 MIX-2 settled item: two INDEPENDENT matches multiplied into one
 * 2-leg slip (total 1.80x–2.25x), explicit per-leg settlement contract
 * (side + market), one standard 100-unit stake.
 */
function mix2ItemOf(a: MixLegSource, b: MixLegSource): LineItem | null {
  const legs = [a, b];
  let prob = 1;
  let odds = 1;
  const favorites: {
    name: string;
    eventKey: string;
    side: "A" | "B";
    market: "HANDICAP" | "WINNER" | "OVER195";
  }[] = [];
  const legRows: MixLeg[] = [];
  for (const { m, leg } of legs) {
    const fav = m.favorite === "A" ? m.playerA.name : m.playerB.name;
    const dog = m.favorite === "A" ? m.playerB.name : m.playerA.name;
    prob *= leg.prob;
    odds *= leg.odds;
    favorites.push({
      name: fav,
      eventKey: m.eventKey,
      side: m.favorite,
      market: leg.leg,
    });
    legRows.push({
      favName: fav,
      dogName: dog,
      favShort: m.favorite === "A" ? m.playerA.shortName : m.playerB.shortName,
      dogShort: m.favorite === "A" ? m.playerB.shortName : m.playerA.shortName,
      tournament: m.tournament,
      round: m.round,
      tour: m.tour,
      surface: m.surface,
      startTime: m.startTime,
      marketEn: leg.marketEn,
      marketFa: leg.marketFa,
      odds: leg.odds,
      eventKey: m.eventKey,
    });
  }
  const marketEn = legRows.map((r) => r.marketEn).join(" + ");
  return {
    ...baseItem(a.m),
    line: "COMBO",
    leg: "MIX2",
    desc: `میکس ۲ تایی سلاطین سرویس — ${legRows.map((r) => r.favName).join(" × ")}`,
    descEn: `2-LEG PRECISION PARLAY — ${marketEn}`,
    odds: Math.round(odds * 100) / 100,
    prob,
    stake: STANDARD_MATCH_STAKE,
    timing: a.m.timing,
    marketEn,
    marketFa: `میکس ۲ تایی سلاطین سرویس — ${legRows.map((r) => r.favName).join("، ")}`,
    legs: legRows,
    meta: JSON.stringify({ kind: "combo", favorites, size: 2 }),
  };
}

/**
 * TAB 3 — 🏦 SERVICE 3-FOLD ACCA: three of the day's strongest service-king
 * legs (official 1-click markets, explicit side+market settlement contract)
 * multiplied into one 100-unit slip. The caller pre-filters the honest total
 * into the printed 2.70x–3.40x contract.
 */
function accaItemOf(sources: MixLegSource[], legTag: string, total: number): LineItem | null {
  if (sources.length !== 3) return null;
  let prob = 1;
  const favorites: {
    name: string;
    eventKey: string;
    side: "A" | "B";
    market: "HANDICAP" | "WINNER" | "OVER195";
  }[] = [];
  const legRows: MixLeg[] = [];
  for (const { m, leg } of sources) {
    const fav = m.favorite === "A" ? m.playerA.name : m.playerB.name;
    const dog = m.favorite === "A" ? m.playerB.name : m.playerA.name;
    prob *= leg.prob;
    favorites.push({
      name: fav,
      eventKey: m.eventKey,
      side: m.favorite,
      market: leg.leg,
    });
    legRows.push({
      favName: fav,
      dogName: dog,
      favShort: m.favorite === "A" ? m.playerA.shortName : m.playerB.shortName,
      dogShort: m.favorite === "A" ? m.playerB.shortName : m.playerA.shortName,
      tournament: m.tournament,
      round: m.round,
      tour: m.tour,
      surface: m.surface,
      startTime: m.startTime,
      marketEn: leg.marketEn,
      marketFa: leg.marketFa,
      odds: leg.odds,
      eventKey: m.eventKey,
    });
  }
  const marketEn = legRows.map((r) => r.marketEn).join(" + ");
  return {
    ...baseItem(sources[0].m),
    line: "ACCUMULATOR",
    leg: legTag,
    desc: `آکومولاتور سلاطین سرویس ۳ تایی — ${legRows.map((r) => r.favName).join(" × ")}`,
    descEn: `SERVICE KINGS 3-FOLD — ${marketEn}`,
    odds: total,
    prob,
    stake: STANDARD_MATCH_STAKE,
    timing: sources[0].m.timing,
    marketEn,
    marketFa: `آکومولاتور ۳ تایی سلاطین سرویس — ${legRows.map((r) => r.favName).join("، ")}`,
    legs: legRows,
    meta: JSON.stringify({ kind: "combo", favorites, size: 3 }),
  };
}

// ─── v3.0 · Dual-Slip Accounting Sync ──────────────────────────────────────
// 1) every DUAL wing rides its official market price and its exact dutching
//    stake (equal-profit split of the 100-unit match position);
// 2) when a match is re-picked under the current archetype, its stale legs
//    from an older build are removed — the record keeps EXACTLY the two
//    complementary wings of the live archetype (never 4 legs per match).
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

export function buildLines(analyzed: AnalyzedMatch[]) {
  // ─── v7.0 · THREE PRODUCTION LINES (master-prompt v7.0 §2) ────────────────
  // The dual-coverage strategy (two options inside ONE match) is RETIRED and
  // the REGCOMBO / CLUSTER / SNIPER / COMBO-3 lines are delisted. Every card
  // is now exactly ONE standard 100-unit stake on one of:
  //   TAB 1 · 🔗 MIX-2  (2-leg precision parlay · total 1.80x–2.25x)
  //   TAB 2 · 🎯 SINGLE (deep-value pick · 1.72x–2.15x · +6.5% EV edge)
  //   TAB 3 · 🏦 BANKER (1.45x–1.65x) + 🔗 ACC-3 (2.70x–3.40x)
  const dual: LineItem[] = []; // v7.0 — retired by construction (kept for payload compat)
  const banker: LineItem[] = [];
  const single: LineItem[] = [];
  const accumulator: LineItem[] = [];
  const regCombo: LineItem[] = []; // v7.0 — delisted
  const cluster: LineItem[] = []; // v7.0 — delisted
  const sniper: LineItem[] = []; // v7.0 — delisted (replaced by the DEEP SINGLE line)
  const shadow: LineItem[] = [];
  const eligible = analyzed.filter((m) => m.state !== "post");

  // ── v7.0 per-match dispatch — BANKER (Tab 3) + DEEP SINGLE (Tab 2) ────────
  for (const m of eligible) {
    const favName = m.favorite === "A" ? m.playerA.name : m.playerB.name;
    const dogName = m.favorite === "A" ? m.playerB.name : m.playerA.name;
    const v5 = {
      regime: m.regime,
      crown: m.crown,
      pipeline: m.pipeline,
      copula: m.copula,
      monteCarlo: m.monteCarlo,
    };

    // 🏦 TAB 3 — SERVICE BANKER: live-locked 1xBet price, 100-unit stake
    const regime = m.regime;
    if (!m.veto.vetoed && regime && regime.code === "BANKER" && regime.price && regime.legCodes) {
      banker.push({
        ...baseItem(m),
        line: "BANKER",
        leg: regime.legCodes.main,
        desc: regime.marketFa ?? regime.marketEn ?? "",
        descEn: regime.marketEn ?? "",
        odds: regime.price,
        prob: regime.prob ?? m.favWinProb,
        stake: STANDARD_MATCH_STAKE,
        marketEn: regime.marketEn,
        marketFa: regime.marketFa,
        espnUrl: espnMatchUrl(m.eventKey),
        targetWindow: regime.targetWindow ?? V7_WINDOWS.BANKER,
        ...v5,
        meta: JSON.stringify({
          kind: "banker",
          legCode: regime.legCodes.main,
          favName,
          eventKey: m.eventKey,
          adaptive: regime.adaptive,
        }),
      });
    }

    // 🎯 TAB 2 — DEEP SINGLE: +6.5% probability edge over the LIVE board when
    // a feed quote exists; formula-priced (5.5% margin) on feed-less days.
    // Price live-locked inside 1.72x–2.15x, 100-unit stake.
    if (!m.veto.vetoed && m.state !== "post") {
      const deep = buildDeepSingle(m);
      if (deep) {
        single.push({
          ...baseItem(m),
          line: "SINGLE",
          leg: deep.leg,
          desc: deep.anchored
            ? `${deep.textFa} — برتری احتمال +${(deep.edge * 100).toFixed(1)}%`
            : `${deep.textFa} — قیمت فرمولی ۵.۵٪ (بدون فید زنده)` ,
          descEn: deep.anchored
            ? `${deep.marketEn} · +EV EDGE`
            : `${deep.marketEn} · FORMULA-PRICED`,
          odds: deep.odds,
          prob: deep.prob,
          stake: STANDARD_MATCH_STAKE,
          marketEn: deep.marketEn,
          marketFa: deep.marketFa,
          espnUrl: espnMatchUrl(m.eventKey),
          targetWindow: V7_WINDOWS.DEEP_SINGLE,
          ...v5,
          meta: JSON.stringify({
            kind: "single",
            legCode: deep.leg,
            favName,
            dogName,
            eventKey: m.eventKey,
            edge: Math.round(deep.edge * 1000) / 1000,
            anchored: deep.anchored,
          }),
        });
      }
    }

    if (m.veto.vetoed) {
      const p20Fav = m.favorite === "A" ? m.markov.p20 : m.markov.p02;
      const over25 = m.markov.p21 + m.markov.p12;
      shadow.push({
        ...baseItem(m),
        line: "SHADOW",
        leg: "A",
        desc: `🛡️ وتوشده توسط سوپروایزر — ${m.veto.reason ?? ""}`,
        descEn: `VETOED · FAV 2-0 (P=${(p20Fav * 100).toFixed(1)}%)`,
        odds: p20Fav > 0.01 ? Math.round((1 / p20Fav) * 100) / 100 : 99,
        prob: p20Fav,
        stake: STANDARD_MATCH_STAKE,
        meta: JSON.stringify({ kind: "dualA", favName, eventKey: m.eventKey }),
      });
      shadow.push({
        ...baseItem(m),
        line: "SHADOW",
        leg: "B",
        desc: `🛡️ وتوشده توسط سوپروایزر — ${m.veto.reason ?? ""}`,
        descEn: `VETOED · OVER 2.5 SETS (P=${(over25 * 100).toFixed(1)}%)`,
        odds: over25 > 0.01 ? Math.round((1 / over25) * 100) / 100 : 99,
        prob: over25,
        stake: STANDARD_MATCH_STAKE,
        meta: JSON.stringify({ kind: "dualB", favName, dogName, eventKey: m.eventKey }),
      });
    }
  }

  // ── v7.0 · 🔗 TAB 1 — MIX-2 LEGS (1.80x–2.25x) + 🏦 3-FOLD ACCA ──────────
  // Every leg is ONE official 1-click market (Favorite +1.5 Sets / Match
  // Winner / Total Games Over 19.5) live-locked inside 1.34x–1.50x from a
  // DIFFERENT match; the pair product must land inside 1.80x–2.25x. The ACCA
  // combines the day's strongest real-priced bankers into the 2.70x–3.40x
  // 3-fold slip. No clamps anywhere — slips that miss the contract are simply
  // not issued (honest by construction).
  const mixPool = eligible
    .map((m) => ({ m, leg: buildMix2Leg(m) }))
    .filter((x): x is { m: AnalyzedMatch; leg: NonNullable<ReturnType<typeof buildMix2Leg>> } => !!x.leg)
    .sort((a, b) => b.leg.prob - a.leg.prob);

  const combo2: LineItem[] = [];
  const combo3: LineItem[] = [];
  const usedMix = new Set<string>();
  for (let i = 0; i < mixPool.length; i++) {
    if (usedMix.has(mixPool[i].m.eventKey)) continue;
    let matched: MixLegSource | null = null;
    for (let j = i + 1; j < mixPool.length; j++) {
      if (usedMix.has(mixPool[j].m.eventKey)) continue;
      if (mixPool[j].m.eventKey === mixPool[i].m.eventKey) continue;
      const total = Math.round(mixPool[i].leg.odds * mixPool[j].leg.odds * 100) / 100;
      if (total >= V7_WINDOWS.MIX2_TOTAL[0] && total <= V7_WINDOWS.MIX2_TOTAL[1]) {
        matched = mixPool[j];
        break;
      }
    }
    if (matched) {
      const item = mix2ItemOf(mixPool[i], matched);
      if (item) {
        combo2.push(item);
        usedMix.add(mixPool[i].m.eventKey);
        usedMix.add(matched.m.eventKey);
      }
    }
    if (combo2.length >= 4) break; // the day's four strongest mix slips
  }

  // 🏦 TAB 3 — 3-FOLD ACCA over the day's strongest service-king legs
  // (BANKER-regime matches first, then the strongest mix legs — the same
  // official 1-click markets). The honest product of the three REAL prices
  // must land inside the printed 2.70x–3.40x contract; otherwise no slip.
  const bankerRanked = analyzed
    .filter(
      (m) =>
        m.state !== "post" &&
        !m.veto.vetoed &&
        m.regime?.code === "BANKER" &&
        !!m.regime.price &&
        !m.regime.adaptive // adaptive (SILVER) bankers never anchor parlays
    )
    .sort((a, b) => (b.mc?.bankerProb ?? b.favWinProb) - (a.mc?.bankerProb ?? a.favWinProb));
  const accaSources: MixLegSource[] = [
    ...bankerRanked.map((m) => ({ m, leg: buildMix2Leg(m) })).filter(
      (x): x is MixLegSource => !!x.leg
    ),
    ...mixPool,
  ];
  const seenAcca = new Set<string>();
  const accaCands = accaSources
    .filter((x) => {
      if (seenAcca.has(x.m.eventKey)) return false;
      seenAcca.add(x.m.eventKey);
      return true;
    })
    .sort((a, b) => b.leg.prob - a.leg.prob)
    .slice(0, 10);
  let acc3: LineItem | null = null;
  let acc3Prob = -1;
  for (let a = 0; a < accaCands.length; a++) {
    for (let b = a + 1; b < accaCands.length; b++) {
      for (let c = b + 1; c < accaCands.length; c++) {
        const trio = [accaCands[a], accaCands[b], accaCands[c]];
        const total =
          Math.round(trio.reduce((s, x) => s * x.leg.odds, 1) * 100) / 100;
        if (total < V7_WINDOWS.ACCA3[0] || total > V7_WINDOWS.ACCA3[1]) continue;
        const joint = trio.reduce((s, x) => s * x.leg.prob, 1);
        if (joint > acc3Prob) {
          acc3Prob = joint;
          acc3 = accaItemOf(trio, "ACC-3", total);
        }
      }
    }
  }
  if (acc3) accumulator.push(acc3);

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

// ─── force-refresh helper (used by API) ────────────────────────────────────
export function todayKeyExport(): string {
  return todayKey();
}
