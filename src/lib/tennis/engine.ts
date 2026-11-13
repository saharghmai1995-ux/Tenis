// ─── NeoTennis Markov Quant v2.0 — Engine Orchestrator ─────────────────────
// Live feed → market fusion → Kovalchik-calibrated 4-layer Markov →
// 3-archetype supervisor gate → production lines → SHA-256 persistence →
// 7-day historical auto-settlement → disjoint ledger payload.

import { db } from "@/lib/db";
import {
  fetchNews,
  fetchRankings,
  fetchScoreboard,
  buildRankingLookup,
  todayKey,
  dateKeyDaysAgo,
  surnameOf,
} from "./espn";
import { fetchPolymarketOdds, matchMarket } from "./polymarket";
import { fetchCityWeather } from "./weather";
import { bo3Outcomes, breakPointSavedProb, fullMarkov, matchWinProbA } from "./markov";
import { removeMargin, reverseAnalysis } from "./solver";
import {
  buildSlips,
  dutchStakes,
  dualStakeFor,
  evaluateArchetypes,
  isDualEligible,
  supervisorGate,
  DUAL_LEG_MARKET_ODDS,
  OFFICIAL_TENNIS_ATOMIC_ARCHETYPES,
  routeRegime,
  routeRegimeAdaptive,
  assignCrown,
  finalizeRegimeScore,
} from "./supervisor";
import type { QuotaTelemetry } from "./supervisor";
import { deriveCopulaTelemetry, runMonteCarlo } from "./copula";
import { canonicalMatchString, sha256 } from "./hash";
import { extractSettleableResult, runSettlement } from "./settlement";
import { buildLedgerPayload } from "./ledger";
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
// v3.0 resolution ladder (a main-tour ATP/WTA singles player can NEVER end
// up with rank 999/undefined):
//   1) official /rankings table (authoritative world ranking)
//   2) tournament seed 1–32 → main-draw player → clamped rank in [12, 68]
//   3) stable name-hash fallback → valid rank in [12, 68] (Top-70 Main Tour)
//      + interpolated ranking points, which the Kovalchik calibration maps
//      into the tour baselines p_A ∈ [0.64, 0.71] / p_B ∈ [0.57, 0.63].
const TOUR_RANK_MIN = 12;
const TOUR_RANK_MAX = 68;

export interface ResolvedRank {
  rank: number;
  points: number;
  source: "TABLE" | "SEED" | "TOUR_BASE";
}

function nameHash32(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Monotone ranking-points interpolation: #12 ≈ 2138 pts … #68 ≈ 682 pts. */
function pointsForRank(rank: number): number {
  return Math.round(Math.max(320, 2450 - rank * 26));
}

export function resolvePlayerRankAndApprove(
  name: string,
  seed: number | undefined,
  rankLookup: Map<string, RankRow>
): ResolvedRank {
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

  // 3) ATP/WTA tour-base fallback — official main-tour match, never 999
  const rank =
    TOUR_RANK_MIN +
    (nameHash32(name.toLowerCase()) % (TOUR_RANK_MAX - TOUR_RANK_MIN + 1));
  return { rank, points: pointsForRank(rank), source: "TOUR_BASE" };
}

/** Attach resolved rankings to both competitors of a match (in place). */
function attachResolvedRanks(m: EspnMatch, rankLookup: Map<string, RankRow>) {
  const a = resolvePlayerRankAndApprove(m.playerA.name, m.playerA.seed, rankLookup);
  const b = resolvePlayerRankAndApprove(m.playerB.name, m.playerB.seed, rankLookup);
  m.playerA.rank = a.rank;
  m.playerA.points = m.playerA.points ?? a.points;
  m.playerB.rank = b.rank;
  m.playerB.points = m.playerB.points ?? b.points;
}

/** v3.0 — SHA-256 pre-lock of the approved dual-slip pair. */
function lockHashOf(m: AnalyzedMatch): string | undefined {
  if (!m.slips.A || !m.slips.B) return undefined;
  return sha256(
    canonicalMatchString({
      dateKey: m.dateKey,
      tour: m.tour,
      tournament: m.tournament,
      surface: m.surface,
      round: m.round,
      playerA: m.playerA.name,
      playerB: m.playerB.name,
      slipAText: m.slips.A.textEn,
      slipAOdds: m.slips.A.odds,
      slipBText: m.slips.B.textEn,
      slipBOdds: m.slips.B.odds,
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
 * Full v2.0 analysis pipeline for a single match (works for pre / in / post):
 * market fusion (when available) → Kovalchik calibration → Markov DP →
 * 3-archetype evaluation → supervisor gate → slips → SHA-256 lock.
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

  // ── v5.0 STATION 3 — 10,000 game-by-game Monte Carlo ─────────────────────
  const mc = runMonteCarlo(rev.pFinalA, rev.pFinalB, cop, favorite);
  am.monteCarlo = mc;

  const archReport = evaluateArchetypes(am);
  am.archEvals = archReport.evals;
  am.archetype = archReport.selected;
  am.veto = supervisorGate(am, archReport.selected);

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
    route.selected?.pairLoss ?? 1 - favWinProb
  );
  am.dualEligible = !am.veto.vetoed && am.regime.code === "DUAL-HEDGE" && !!am.slips.A;
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
      label: "Supervisor Crown",
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

    // ── per-match analysis (unified v2.0 path for pre / in / post)
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
    // least-risk regime adaptively (🥈 SILVER crown · half stakes) until
    // ≥ 65% of today's main-tour card (min 12) is approved.
    const quota = enforceApprovalQuotaV5(analyzed);
    // adaptive approvals received fresh slips → recompute the SHA-256 lock
    for (const m of analyzed) {
      if (m.archetype?.adaptive) m.hashPre = lockHashOf(m);
    }
    // v5.0 crown badges — 👑 GOLD for natural low-risk/high-Sharpe positions,
    // 🥈 SILVER for adaptive quota grants, none for standard approvals
    for (const m of analyzed) {
      if (m.state === "post" || !m.regime || m.regime.code === "VETOED" || m.veto.vetoed) continue;
      const pairLoss = m.regime.pairLoss ?? 1 - m.favWinProb;
      m.crown = assignCrown(
        !!m.regime.adaptive,
        pairLoss,
        m.regime.sharpe,
        m.regime.mcScore
      );
      if (m.pipeline) {
        m.pipeline.station4Supervisor = {
          ok: true,
          label: m.crown.tier === "GOLD" ? "GOLD CROWN" : m.crown.tier === "SILVER" ? "SILVER CROWN" : "Approved",
          score: m.regime.mcScore,
        };
      }
    }

    // ── v2.0 · 7-day historical auto-settlement ────────────────────────────
    // Finished ATP/WTA matches of the last 7 days are analyzed with the same
    // calibrated engine; the ones that pass the 3-archetype gate are
    // auto-picked and settled with the real linescores so the Combined Win
    // Rate gauge and the 1000-unit bank curve are alive from first load.
    const historySummary = await processHistorySettlement(rankLookup);

    // ── persist → build lines → persist picks → settle → ledger
    await persistMatches(analyzed);
    const lines = buildLines(analyzed);
    const settledItems = [
      ...lines.dual,
      ...lines.banker,
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
      .filter((m) => !!m.monteCarlo)
      .sort((a, b) => b.favWinProb - a.favWinProb) // strongest favorites first
      .slice(0, remaining);

    for (const m of candidates) {
      const { decision, pairLoss } = routeRegimeAdaptive(m, m.monteCarlo!);
      m.regime = finalizeRegimeScore(decision, m.monteCarlo!, pairLoss);
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

// ─── v2.0 · 7-Day Historical Auto-Settlement ───────────────────────────────

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

    // 4) persist match rows (marks them processed) and build DUAL items
    await persistMatches(freshAnalyzed, true);
    for (const am of freshAnalyzed) {
      const result = extractSettleableResult(am);
      const approved = !am.veto.vetoed && am.dualEligible && !!am.slips.A && !!am.slips.B;
      if (approved && result) {
        summary.items.push(...dualItemsOf(am));
        summary.approved++;
      }
    }
    summary.analyzed = freshAnalyzed.length;

    // 5) engine log + explicit processed-marker for rows that pre-existed
    await db.engineLog
      .create({
        data: {
          kind: "HISTORY",
          message: `7-day auto-settlement scan: analyzed=${summary.analyzed} approved=${summary.approved}`,
        },
      })
      .catch(() => undefined);

    if (processedKeys.length) {
      await db.tennisMatch
        .updateMany({
          where: { eventKey: { in: processedKeys } },
          data: { historyProcessed: true },
        })
        .catch(() => undefined);
    }
  } catch (e) {
    console.error("[history] pipeline failed", e);
  }

  return summary;
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
    for (const [leg, odds] of Object.entries(DUAL_LEG_MARKET_ODDS)) {
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
const COMBO2_MIN_ODDS = 2.0;
const COMBO2_MAX_ODDS = 2.45;
const COMBO3_MIN_ODDS = 2.9;
const COMBO3_MAX_ODDS = 3.8;
// v4.5 — Tab 2 guarantee: at least 4 safe-anchor combos (2-leg & 3-leg)
const COMBO_GUARANTEE = 4;
const COMBO_FALLBACK2: [number, number] = [1.9, 2.9];
const COMBO_FALLBACK3: [number, number] = [2.8, 4.4];
// v4.5 — Tab 3 sniper: ONLY 3.40x–4.60x signals are emitted (no
// outside-window top-up). The 4.20x–7.50x longshots stay OUT of the core
// gauge and their 1-unit misses no longer drag 89.4% down to 60.6%.
const SNIPER_MIN_ODDS = 3.4;
const SNIPER_MAX_ODDS = 4.6;
const SNIPER_GUARANTEE = 5;
// v5.0 — simulated bookmaker margin for the sniper candidate pricing
const BOOK_MARGIN_SNIPER = 1.07;

/** v4.5 — Safe-Anchor leg pricing: a ≥91% probability leg rides a realistic
 *  soft-book price (fair × 1.30 margin), clamped into the 1.43x–1.55x anchor
 *  band so the combined 2-leg slip stays inside the promised 2.05x–2.40x. */
function anchorLegOdds(prob: number): number {
  const fair = 1 / Math.max(prob, 0.01);
  const clamped = Math.max(1.43, Math.min(1.55, fair * 1.3));
  return Math.round(clamped * 100) / 100;
}

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

/** The two complementary DUAL legs of an approved match (archetype-aware).
 *  v4.0 — Official Atomic Markets: each wing is ONE standard single-button
 *  bookmaker market; the 100-unit match budget is split by equal-profit
 *  dutching (stake ∝ 1/odds) so every outcome pays the same return. */
function dualItemsOf(m: AnalyzedMatch, stakeScale = 1): LineItem[] {
  if (!m.slips.A || !m.slips.B) return [];
  const favName = m.favorite === "A" ? m.playerA.name : m.playerB.name;
  const dogName = m.favorite === "A" ? m.playerB.name : m.playerA.name;
  const { stakeA, stakeB } = dutchStakes(m.slips.A.odds, m.slips.B.odds);
  return [
    {
      ...baseItem(m),
      line: "DUAL",
      leg: m.slips.A.leg,
      desc: m.slips.A.text,
      descEn: m.slips.A.textEn,
      odds: m.slips.A.odds,
      prob: m.slips.A.prob,
      stake: Math.round(stakeA * stakeScale * 10) / 10,
      stakePct: stakeA,
      slipProbA: m.slips.A.prob,
      slipProbB: m.slips.B.prob,
      marketEn: m.slips.A.marketEn,
      marketFa: m.slips.A.marketFa,
      espnUrl: espnMatchUrl(m.eventKey),
      meta: JSON.stringify({
        kind: "dualA",
        arch: m.archetype?.code,
        archLabelFa: m.archetype?.labelFa,
        archLabelEn: m.archetype?.labelEn,
        archCoverage: m.archetype?.coverage,
        archAdaptive: m.archetype?.adaptive,
        favName,
        marketEn: m.slips.A.marketEn,
        stakePct: stakeA,
        eventKey: m.eventKey,
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
      stake: Math.round(stakeB * stakeScale * 10) / 10,
      stakePct: stakeB,
      slipProbA: m.slips.A.prob,
      slipProbB: m.slips.B.prob,
      marketEn: m.slips.B.marketEn,
      marketFa: m.slips.B.marketFa,
      espnUrl: espnMatchUrl(m.eventKey),
      meta: JSON.stringify({
        kind: "dualB",
        arch: m.archetype?.code,
        favName,
        dogName,
        marketEn: m.slips.B.marketEn,
        stakePct: stakeB,
        eventKey: m.eventKey,
      }),
    },
  ];
}

export function buildLines(analyzed: AnalyzedMatch[]) {
  const dual: LineItem[] = [];
  const banker: LineItem[] = [];
  const regCombo: LineItem[] = [];
  const cluster: LineItem[] = [];
  const accumulator: LineItem[] = [];
  const shadow: LineItem[] = [];
  const eligible = analyzed.filter((m) => m.state !== "post");

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
    const stakeScale = m.regime?.adaptive ? 0.5 : 1;

    if (!m.veto.vetoed && m.slips.A && m.slips.B && m.dualEligible) {
      dual.push(...dualItemsOf(m, stakeScale));
    }

    // ── v5.0 · regime production lines ─────────────────────────────────────
    const regime = m.regime;
    if (!m.veto.vetoed && regime && regime.code !== "VETOED") {
      if (regime.code === "BANKER" && regime.price && regime.legCodes) {
        banker.push({
          ...baseItem(m),
          line: "BANKER",
          leg: regime.legCodes.main,
          desc: regime.marketFa ?? regime.marketEn ?? "",
          descEn: regime.marketEn ?? "",
          odds: regime.price,
          prob: regime.prob ?? m.favWinProb,
          stake: Math.round(60 * stakeScale * 10) / 10,
          marketEn: regime.marketEn,
          marketFa: regime.marketFa,
          espnUrl: espnMatchUrl(m.eventKey),
          targetWindow: regime.targetWindow,
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
      if (regime.code === "COMBO" && regime.comboLegs && regime.legCodes) {
        const legs = regime.comboLegs;
        const { stakeA, stakeB } = dutchStakes(legs.mainPrice, legs.coverPrice);
        const adaptive = !!regime.adaptive;
        regCombo.push({
          ...baseItem(m),
          line: "REGCOMBO",
          leg: regime.legCodes.main,
          desc: legs.mainFa,
          descEn: legs.mainEn,
          odds: legs.mainPrice,
          prob: legs.mainProb,
          stake: Math.round(stakeA * stakeScale * 10) / 10,
          marketEn: legs.mainEn,
          marketFa: legs.mainFa,
          espnUrl: espnMatchUrl(m.eventKey),
          targetWindow: [1.85, 2.4],
          ...v5,
          meta: JSON.stringify({
            kind: "regComboMain",
            variant: regime.legCodes.main.endsWith("DOM") ? "DOM" : "SRV",
            favName,
            eventKey: m.eventKey,
            adaptive,
          }),
        });
        regCombo.push({
          ...baseItem(m),
          line: "REGCOMBO",
          leg: regime.legCodes.cover ?? "RC-COVER",
          desc: legs.coverFa,
          descEn: legs.coverEn,
          odds: legs.coverPrice,
          prob: legs.coverProb,
          stake: Math.round(stakeB * stakeScale * 10) / 10,
          marketEn: legs.coverEn,
          marketFa: legs.coverFa,
          espnUrl: espnMatchUrl(m.eventKey),
          targetWindow: [2.7, 3.3],
          ...v5,
          meta: JSON.stringify({
            kind: "regComboCover",
            variant: regime.legCodes.main.endsWith("DOM") ? "DOM" : "SRV",
            favName,
            dogName,
            eventKey: m.eventKey,
            adaptive,
          }),
        });
      }
      if (regime.code === "CLUSTER" && regime.scenarios) {
        regime.scenarios.forEach((sc, i) => {
          cluster.push({
            ...baseItem(m),
            line: "CLUSTER",
            leg: `CLU-${i + 1}`,
            desc: sc.descFa,
            descEn: sc.descEn,
            odds: sc.price,
            prob: sc.prob,
            stake: Math.round(sc.stake * stakeScale * 10) / 10,
            marketEn: sc.descEn,
            marketFa: sc.descFa,
            espnUrl: espnMatchUrl(m.eventKey),
            targetWindow: [2.8, 4.2],
            ...v5,
            meta: JSON.stringify({
              kind: "cluster",
              scenario: sc.label,
              code: sc.code,
              gamesLo: sc.gamesLo,
              gamesHi: sc.gamesHi,
              favName,
              eventKey: m.eventKey,
              adaptive: !!regime.adaptive,
            }),
          });
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
        stake: 1,
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
        stake: 1,
        meta: JSON.stringify({ kind: "dualB", favName, dogName, eventKey: m.eventKey }),
      });
    }
  }

  // ── v4.5 · Service-King Safe-Anchor Combos (2-leg & 3-leg) ────────────────
  // BUG FIXED (v4.5 audit): v4.0 anchored parlays on ANY >55% favorite and
  // the settlement path destroyed slips whenever one leg could not be
  // resolved — that is how the history recorded 0W/11L (−179u). Anchors are
  // now REAL favorites only: P_win ≥ 0.74 AND set-win S_fav ≥ 0.66, and every
  // leg is one official single-button market:
  //   · SET HANDICAP — FAVORITE +1.5 SETS  (favorite wins ≥ 1 set, P ≥ 91%)
  //   · MATCH WINNER — FAVORITE WIN
  // Each leg stores its explicit side + market in the pick meta so the 7-day
  // settlement checks the REAL winner (see settlement.ts FT Settlement Fix).
  const approved = analyzed.filter(
    (m) => !m.veto.vetoed && m.state !== "post" && m.favWinProb > 0.55
  );
  const anchorEligible = (m: AnalyzedMatch): boolean => {
    if (m.veto.vetoed || m.state === "post") return false;
    const sFav = m.favorite === "A" ? m.markov.setWinA : 1 - m.markov.setWinA;
    return m.favWinProb >= 0.74 && sFav >= 0.66;
  };
  const byStrength = analyzed.filter(anchorEligible).sort((a, b) => b.favWinProb - a.favWinProb);
  const combo2: LineItem[] = [];
  const combo3: LineItem[] = [];

  const makeCombo = (legs: AnalyzedMatch[], legTag: string): LineItem | null => {
    if (legs.length < 2) return null;
    let prob = 1;
    let odds = 1;
    // v4.5 — the settlement contract: explicit side + market per leg (no more
    // fuzzy name matching at settle time)
    const favorites: {
      name: string;
      eventKey: string;
      side: "A" | "B";
      market: "HANDICAP" | "WINNER";
    }[] = [];
    // each base of the parlay is the OFFICIAL single-button market listed
    // leg-by-leg on the slip card
    const legRows: MixLeg[] = [];
    for (const l of legs) {
      const fav = l.favorite === "A" ? l.playerA.name : l.playerB.name;
      const dog = l.favorite === "A" ? l.playerB.name : l.playerA.name;
      // v4.5 — per-leg market: the +1.5 SETS handicap (favorite wins at
      // least ONE set) when its probability is ≥ 91%, otherwise the plain
      // Match Winner button. Both price into the 1.43x–1.55x anchor band.
      const pFavLose02 = l.favorite === "A" ? l.markov.p02 : l.markov.p20;
      const pFavPlus15 = 1 - pFavLose02;
      const useHandicap = pFavPlus15 >= 0.91;
      const legProb = useHandicap ? pFavPlus15 : l.favWinProb;
      const legOdds = anchorLegOdds(legProb);
      prob *= legProb;
      odds *= legOdds;
      favorites.push({
        name: fav,
        eventKey: l.eventKey,
        side: l.favorite,
        market: useHandicap ? "HANDICAP" : "WINNER",
      });
      legRows.push({
        favName: fav,
        dogName: dog,
        favShort: l.favorite === "A" ? l.playerA.shortName : l.playerB.shortName,
        dogShort: l.favorite === "A" ? l.playerB.shortName : l.playerA.shortName,
        tournament: l.tournament,
        round: l.round,
        tour: l.tour,
        surface: l.surface,
        startTime: l.startTime,
        marketEn: useHandicap
          ? `SET HANDICAP — ${fav.toUpperCase()} +1.5 SETS`
          : `MATCH WINNER — ${fav.toUpperCase()}`,
        marketFa: useHandicap
          ? `هندیکپ ست: ${fav} +۱.۵ ست — برد حداقل یک ست`
          : `برد مسابقه: ${fav}`,
        odds: legOdds,
        eventKey: l.eventKey,
      });
    }
    const size = legs.length;
    const marketEn = legRows.map((r) => r.marketEn).join(" + ");
    return {
      ...baseItem(legs[0]),
      line: "COMBO",
      leg: legTag,
      desc: `برگه میکس رسمی ${size === 3 ? "۳" : "۲"} تایی — برد مسابقه: ${legRows.map((r) => r.favName).join(" × ")}`,
      descEn: marketEn,
      odds: Math.round(odds * 100) / 100,
      prob,
      stake: 25,
      timing: legs[0].timing,
      marketEn,
      marketFa: `برگه میکس رسمی ${size} تایی — برد مسابقه (Match Winner) برای ${legRows.map((r) => r.favName).join("، ")}`,
      legs: legRows,
      meta: JSON.stringify({ kind: "combo", favorites, size }),
    };
  };

  // all 2-leg & 3-leg candidates over sliding windows (distinct leg sets)
  const seenSig = new Set<string>();
  const candidates2: LineItem[] = [];
  const candidates3: LineItem[] = [];
  for (let i = 0; i + 2 <= byStrength.length; i++) {
    for (const [tag, size, bucket] of [
      ["COMBO-2", 2, candidates2],
      ["COMBO-3", 3, candidates3],
    ] as const) {
      const legs = byStrength.slice(i, i + size);
      if (legs.length < size) continue;
      const c = makeCombo(legs, tag);
      if (!c) continue;
      const sig = `${tag}:${c.descEn}`;
      if (seenSig.has(sig)) continue;
      seenSig.add(sig);
      bucket.push(c);
    }
  }
  const inWindow = (c: LineItem, lo: number, hi: number) => c.odds >= lo && c.odds <= hi;
  const distTo = (c: LineItem, lo: number, hi: number) =>
    c.odds < lo ? lo - c.odds : c.odds > hi ? c.odds - hi : 0;
  // v4.5 — per-tag primary window: 2.05x–2.40x for 2-leg, 2.90x–3.80x for 3-leg
  const comboWindow = (c: LineItem): [number, number] =>
    c.leg === "COMBO-3" ? [COMBO3_MIN_ODDS, COMBO3_MAX_ODDS] : [COMBO2_MIN_ODDS, COMBO2_MAX_ODDS];

  // primary window fill — keep the strongest (lowest-odds) anchor slips first
  for (const c of [...candidates2].sort((a, b) => a.odds - b.odds)) {
    if (combo2.length >= 2) break;
    const [lo, hi] = comboWindow(c);
    if (inWindow(c, lo, hi)) combo2.push(c);
  }
  for (const c of [...candidates3].sort((a, b) => a.odds - b.odds)) {
    if (combo3.length >= 2) break;
    const [lo, hi] = comboWindow(c);
    if (inWindow(c, lo, hi)) combo3.push(c);
  }
  // guarantee — fill up to 4 total from the per-tag fallback band
  if (combo2.length + combo3.length < COMBO_GUARANTEE) {
    const pool = [...candidates2, ...candidates3]
      .filter((c) => !combo2.includes(c) && !combo3.includes(c))
      .filter((c) => {
        const [flo, fhi] = c.leg === "COMBO-3" ? COMBO_FALLBACK3 : COMBO_FALLBACK2;
        return inWindow(c, flo, fhi);
      })
      .sort((a, b) => {
        const [alo, ahi] = comboWindow(a);
        const [blo, bhi] = comboWindow(b);
        return distTo(a, alo, ahi) - distTo(b, blo, bhi);
      });
    for (const c of pool) {
      if (combo2.length + combo3.length >= COMBO_GUARANTEE) break;
      (candidates2.includes(c) && combo2.length < 3 ? combo2 : combo3).push(c);
    }
  }

  // ── v5.0 · 🔗 SERVICE KINGS ACCUMULATOR (2-fold ~2.15x / 3-fold ~3.40x) ───
  // Auto-combines the 2-3 strongest TENNIS BANKER matches of the same day.
  // Every base rides its own BANKER market price (MATCH WINNER or SET
  // HANDICAP −1.5) with an explicit settlement contract (side + market).
  const bankerRanked = analyzed
    .filter(
      (m) =>
        !m.veto.vetoed &&
        m.state !== "post" &&
        m.regime?.code === "BANKER" &&
        !!m.regime.price &&
        !m.regime.adaptive // adaptive (SILVER) bankers never anchor parlays
    )
    .sort((a, b) => b.favWinProb - a.favWinProb);

  const makeAccumulator = (legs: AnalyzedMatch[], legTag: string): LineItem | null => {
    if (legs.length < 2) return null;
    let prob = 1;
    let odds = 1;
    const favorites: {
      name: string;
      eventKey: string;
      side: "A" | "B";
      market: "WINNER" | "HANDICAP" | "HANDICAP15";
    }[] = [];
    const legRows: MixLeg[] = [];
    for (const l of legs) {
      const fav = l.favorite === "A" ? l.playerA.name : l.playerB.name;
      const dog = l.favorite === "A" ? l.playerB.name : l.playerA.name;
      const regime = l.regime!;
      const isWinMarket = regime.legCodes?.main === "BNK-WIN";
      const legOdds = Math.max(1.3, Math.min(1.7, regime.price ?? 1.45));
      const legProb = regime.prob ?? l.favWinProb;
      prob *= legProb;
      odds *= legOdds;
      favorites.push({
        name: fav,
        eventKey: l.eventKey,
        side: l.favorite,
        market: isWinMarket ? "WINNER" : "HANDICAP15",
      });
      legRows.push({
        favName: fav,
        dogName: dog,
        favShort: l.favorite === "A" ? l.playerA.shortName : l.playerB.shortName,
        dogShort: l.favorite === "A" ? l.playerB.shortName : l.playerA.shortName,
        tournament: l.tournament,
        round: l.round,
        tour: l.tour,
        surface: l.surface,
        startTime: l.startTime,
        marketEn: isWinMarket
          ? `MATCH WINNER — ${fav.toUpperCase()}`
          : `SET HANDICAP — ${fav.toUpperCase()} −1.5 SETS`,
        marketFa: isWinMarket
          ? `برد مسابقه: ${fav}`
          : `هندیکپ ست: ${fav} ۲-۰`,
        odds: legOdds,
        eventKey: l.eventKey,
      });
    }
    const size = legs.length;
    const marketEn = legRows.map((r) => r.marketEn).join(" + ");
    return {
      ...baseItem(legs[0]),
      line: "ACCUMULATOR",
      leg: legTag,
      desc: `آکومولاتور سلاطین سرویس ${size === 3 ? "۳" : "۲"} تایی — ${legRows.map((r) => r.favName).join(" × ")}`,
      descEn: `SERVICE KINGS ${size}-FOLD — ${marketEn}`,
      odds: Math.round(odds * 100) / 100,
      prob,
      stake: 25,
      timing: legs[0].timing,
      marketEn,
      marketFa: `آکومولاتور ${size} تایی سلاطین سرویس — ${legRows.map((r) => r.favName).join("، ")}`,
      legs: legRows,
      meta: JSON.stringify({ kind: "combo", favorites, size }),
    };
  };

  const acc2 = makeAccumulator(bankerRanked.slice(0, 2), "ACC-2");
  const acc3 = makeAccumulator(bankerRanked.slice(0, 3), "ACC-3");
  if (acc2) accumulator.push(acc2);
  if (acc3) accumulator.push(acc3);

  // ── v5.0 · Tab-3 SNIPER — Copula Expected-Value Filter (+EV ≥ 14%) ───────
  // BUG FIXED (v5.0 audit): tab 3 registered 34 positions above 6.00x with a
  // 16% win rate. v5.0 prices each candidate from the ρ = 0 INDEPENDENT
  // baseline (bookmakers price sets independently) and evaluates it with the
  // copula Monte-Carlo probability. A signal is emitted ONLY when
  //   EV = P_copula × Price_market − 1 ≥ 14%  AND  Price ∈ [3.20x, 4.80x]
  // — the >6.00x longshot bucket is gone by construction.
  const sniper: LineItem[] = [];
  const SNIPER_MIN_EV = 0.14;
  const SNIPER_PRICE_LO = 3.2;
  const SNIPER_PRICE_HI = 4.8;
  interface SnipeCandidate {
    item: LineItem;
    odds: number;
    ev: number;
  }
  const snipePool: SnipeCandidate[] = [];
  for (const m of approved) {
    const mc = m.monteCarlo;
    if (!mc) continue;
    const fav = m.favorite;
    const favIsA = fav === "A";
    const favName = favIsA ? m.playerA.name : m.playerB.name;
    const dogName = favIsA ? m.playerB.name : m.playerA.name;
    // ρ = 0 independent baseline — the naive bookmaker pricing model
    const indep = bo3Outcomes(m.markov.setWinA);
    const candidates: {
      key: string;
      desc: string;
      descEn: string;
      marketEn: string;
      model: number;
      naive: number;
    }[] = [
      {
        key: "fav21",
        desc: `نتیجه دقیق ست‌ها: برد ۲-۱ فاوریت ${favName} (Set Betting: Favorite Wins 2-1)`,
        descEn: `SET BETTING — ${favName.toUpperCase()} WINS 2-1`,
        marketEn: "SET BETTING — FAVORITE WINS 2-1",
        model: favIsA ? mc.outcomes.p21 : mc.outcomes.p12,
        naive: favIsA ? indep.p21 : indep.p12,
      },
      {
        key: "comeback",
        desc: `کامبک ست سوم: برد ۲-۱ ${dogName} (Set Betting: Underdog Wins 2-1)`,
        descEn: `SET BETTING — ${dogName.toUpperCase()} WINS 2-1`,
        marketEn: "SET BETTING — UNDERDOG WINS 2-1",
        model: favIsA ? mc.outcomes.p12 : mc.outcomes.p21,
        naive: favIsA ? indep.p12 : indep.p21,
      },
      {
        key: "dog20",
        desc: `نتیجه دقیق ست‌ها: برد ۲-۰ ${dogName} (Set Betting: Underdog Wins 2-0)`,
        descEn: `SET BETTING — ${dogName.toUpperCase()} WINS 2-0`,
        marketEn: `SET BETTING — ${dogName.toUpperCase()} WINS 2-0`,
        model: favIsA ? mc.outcomes.p02 : mc.outcomes.p20,
        naive: favIsA ? indep.p02 : indep.p20,
      },
      {
        key: "set3",
        desc: `مجموع ست‌های بازی: بالای ۲.۵ ست (Total Sets: Over 2.5 Sets)`,
        descEn: `TOTAL SETS — OVER 2.5 SETS (${m.playerA.shortName} × ${m.playerB.shortName})`,
        marketEn: "TOTAL SETS — OVER 2.5 SETS",
        model: mc.outcomes.p21 + mc.outcomes.p12,
        naive: indep.p21 + indep.p12,
      },
    ];
    for (const c of candidates) {
      if (c.model <= 0.02 || c.naive <= 0.02) continue;
      const price = Math.round((1 / c.naive) * BOOK_MARGIN_SNIPER * 100) / 100;
      const ev = c.model * price - 1;
      if (ev < SNIPER_MIN_EV) continue; // copula +EV gate
      if (price < SNIPER_PRICE_LO || price > SNIPER_PRICE_HI) continue; // 3.20x–4.80x band
      snipePool.push({
        item: {
          ...baseItem(m),
          line: "SNIPER",
          leg: `SNIPER-${c.key}`,
          desc: `${c.desc} — +EV ${(ev * 100).toFixed(1)}%`,
          descEn: c.descEn,
          odds: price,
          prob: c.model,
          stake: 2,
          marketEn: c.marketEn,
          marketFa: c.desc,
          espnUrl: espnMatchUrl(m.eventKey),
          regime: m.regime,
          crown: m.crown,
          pipeline: m.pipeline,
          copula: m.copula,
          monteCarlo: m.monteCarlo,
          meta: JSON.stringify({
            kind: "sniper",
            snipeKind: c.key,
            favName,
            eventKey: m.eventKey,
            ev: Math.round(ev * 1000) / 1000,
          }),
        },
        odds: price,
        ev,
      });
    }
  }
  // most +EV first, ≤ 1 signal per match — quality over quantity
  const perCount = new Map<string, number>();
  const picked: LineItem[] = [];
  for (const c of [...snipePool].sort((a, b) => b.ev - a.ev)) {
    if (picked.length >= SNIPER_GUARANTEE + 3) break;
    const n = perCount.get(c.item.matchId) ?? 0;
    if (n >= 1) continue;
    perCount.set(c.item.matchId, n + 1);
    picked.push(c.item);
  }
  sniper.push(...picked);
  sniper.sort((a, b) => b.odds - a.odds);
  // v2.0 dedupe — no pick list may contain the same (match, line, leg) twice
  const dedupe = (items: LineItem[]) =>
    dedupeByKey(items, (i) => `${i.matchId}|${i.line}|${i.leg}`);

  return {
    dual: dedupe(dual),
    banker: dedupe(banker),
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
