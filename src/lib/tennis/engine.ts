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
import { fullMarkov, matchWinProbA, solveSet } from "./markov";
import { removeMargin, reverseAnalysis } from "./solver";
import { buildSlips, evaluateArchetypes, isDualEligible, supervisorGate } from "./supervisor";
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
  const mk = fullMarkov(rev.pFinalA, rev.pFinalB);
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
  };

  const archReport = evaluateArchetypes(am);
  am.archEvals = archReport.evals;
  am.archetype = archReport.selected;
  am.veto = supervisorGate(am, archReport.selected);
  am.dualEligible = isDualEligible(am);
  am.slips = buildSlips(am);
  am.timing = timingOf(m, favorite);

  if (am.slips.A && am.slips.B) {
    am.hashPre = sha256(
      canonicalMatchString({
        dateKey: m.dateKey,
        tour: m.tour,
        tournament: m.tournament,
        surface: m.surface,
        round: m.round,
        playerA: m.playerA.name,
        playerB: m.playerB.name,
        slipAText: am.slips.A.textEn,
        slipAOdds: am.slips.A.odds,
        slipBText: am.slips.B.textEn,
        slipBOdds: am.slips.B.odds,
      })
    );
  }
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

    // attach official ranking info (rankings table is authoritative;
    // scoreboard curatedRank is only the tournament seed)
    for (const m of unique) {
      const resolve = (name: string) => {
        const exact = rankLookup.get(name.toLowerCase());
        if (exact) return exact;
        const s = surnameOf(name);
        const row = rankLookup.get(s);
        return row && surnameOf(row.name) === s ? row : undefined;
      };
      const rowA = resolve(m.playerA.name);
      const rowB = resolve(m.playerB.name);
      if (rowA) {
        m.playerA.points = m.playerA.points ?? rowA.points;
        m.playerA.rank = rowA.rank;
      }
      if (rowB) {
        m.playerB.points = m.playerB.points ?? rowB.points;
        m.playerB.rank = rowB.rank;
      }
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

    // ── v2.0 · 7-day historical auto-settlement ────────────────────────────
    // Finished ATP/WTA matches of the last 7 days are analyzed with the same
    // calibrated engine; the ones that pass the 3-archetype gate are
    // auto-picked and settled with the real linescores so the Combined Win
    // Rate gauge and the 1000-unit bank curve are alive from first load.
    const historySummary = await processHistorySettlement(rankLookup);

    // ── persist → build lines → persist picks → settle → ledger
    await persistMatches(analyzed);
    const lines = buildLines(analyzed);
    const settledItems = [...lines.dual, ...lines.combo2, ...lines.combo3, ...lines.sniper, ...lines.shadow];
    const allItems = dedupeByKey(
      [...settledItems, ...historySummary.items],
      (i) => `${i.matchId}|${i.line}|${i.leg}`
    );
    await persistPicks(allItems);
    const settleSummary = await runSettlement(HISTORY_WINDOW_DAYS);
    const ledger = await buildLedgerPayload();

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

    // 3) attach official ranking points + analyze
    const processedKeys: string[] = [];
    const freshAnalyzed: AnalyzedMatch[] = [];
    for (const m of fresh) {
      try {
        const resolve = (name: string) => {
          const exact = rankLookup.get(name.toLowerCase());
          if (exact) return exact;
          const s = surnameOf(name);
          const row = rankLookup.get(s);
          return row && surnameOf(row.name) === s ? row : undefined;
        };
        const rowA = resolve(m.playerA.name);
        const rowB = resolve(m.playerB.name);
        if (rowA) {
          m.playerA.points = m.playerA.points ?? rowA.points;
          m.playerA.rank = rowA.rank;
        }
        if (rowB) {
          m.playerB.points = m.playerB.points ?? rowB.points;
          m.playerB.rank = rowB.rank;
        }
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

const COMBO_MIN_ODDS = 2.8;
const COMBO_MAX_ODDS = 5.8;
const SNIPER_MIN_ODDS = 4.2;
const SNIPER_MAX_ODDS = 8.5;

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
  };
}

/** The two complementary DUAL legs of an approved match (archetype-aware). */
function dualItemsOf(m: AnalyzedMatch): LineItem[] {
  if (!m.slips.A || !m.slips.B) return [];
  const favName = m.favorite === "A" ? m.playerA.name : m.playerB.name;
  const dogName = m.favorite === "A" ? m.playerB.name : m.playerA.name;
  return [
    {
      ...baseItem(m),
      line: "DUAL",
      leg: m.slips.A.leg,
      desc: m.slips.A.text,
      descEn: m.slips.A.textEn,
      odds: m.slips.A.odds,
      prob: m.slips.A.prob,
      stake: 1,
      slipProbA: m.slips.A.prob,
      slipProbB: m.slips.B.prob,
      meta: JSON.stringify({
        kind: "dualA",
        arch: m.archetype?.code,
        favName,
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
      stake: 1,
      slipProbA: m.slips.A.prob,
      slipProbB: m.slips.B.prob,
      meta: JSON.stringify({
        kind: "dualB",
        arch: m.archetype?.code,
        favName,
        dogName,
        eventKey: m.eventKey,
      }),
    },
  ];
}

export function buildLines(analyzed: AnalyzedMatch[]) {
  const dual: LineItem[] = [];
  const shadow: LineItem[] = [];
  const eligible = analyzed.filter((m) => m.state !== "post");

  for (const m of eligible) {
    const favName = m.favorite === "A" ? m.playerA.name : m.playerB.name;
    const dogName = m.favorite === "A" ? m.playerB.name : m.playerA.name;

    if (!m.veto.vetoed && m.slips.A && m.slips.B && m.dualEligible) {
      dual.push(...dualItemsOf(m));
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

  // ── Serve-Hold Combos (2-leg & 3-leg) from strongest approved favorites
  const approved = analyzed.filter(
    (m) => !m.veto.vetoed && m.state !== "post" && m.favWinProb > 0.55
  );
  const byStrength = [...approved].sort((a, b) => b.favWinProb - a.favWinProb);
  const combo2: LineItem[] = [];
  const combo3: LineItem[] = [];

  const makeCombo = (legs: AnalyzedMatch[], legTag: string): LineItem | null => {
    if (legs.length < 2) return null;
    let prob = 1;
    let odds = 1;
    const names: string[] = [];
    const favorites: { name: string; eventKey: string }[] = [];
    for (const l of legs) {
      const fav = l.favorite === "A" ? l.playerA.name : l.playerB.name;
      prob *= l.favWinProb;
      odds *= 1 / l.favWinProb;
      names.push(`${fav} WIN`);
      favorites.push({ name: fav, eventKey: l.eventKey });
    }
    return {
      ...baseItem(legs[0]),
      line: "COMBO",
      leg: legTag,
      desc: `${legTag.startsWith("COMBO-3") ? "میکس ۳ تایی" : "میکس ۲ تایی"} سلاطین سرویس: ${names.join(" × ")}`,
      descEn: names.join(" × "),
      odds: Math.round(odds * 100) / 100,
      prob,
      stake: 1,
      timing: legs[0].timing,
      meta: JSON.stringify({ kind: "combo", favorites, size: legs.length }),
    };
  };

  const primaryC2 = makeCombo(byStrength.slice(0, 2), "COMBO-2");
  if (primaryC2 && primaryC2.odds >= COMBO_MIN_ODDS && primaryC2.odds <= COMBO_MAX_ODDS)
    combo2.push(primaryC2);
  const primaryC3 = makeCombo(byStrength.slice(0, 3), "COMBO-3");
  if (primaryC3 && primaryC3.odds >= COMBO_MIN_ODDS && primaryC3.odds <= COMBO_MAX_ODDS)
    combo3.push(primaryC3);

  for (let i = 0; i + 2 <= byStrength.length && combo2.length < 2; i++) {
    const alt = makeCombo(byStrength.slice(i, i + 2), "COMBO-2");
    if (alt && alt.odds >= COMBO_MIN_ODDS && alt.odds <= COMBO_MAX_ODDS) combo2.push(alt);
  }
  for (let i = 0; i + 3 <= byStrength.length && combo3.length < 2; i++) {
    const alt = makeCombo(byStrength.slice(i, i + 3), "COMBO-3");
    if (alt && alt.odds >= COMBO_MIN_ODDS && alt.odds <= COMBO_MAX_ODDS) combo3.push(alt);
  }

  // ── High-Odds Sniper 4.20x–8.50x
  const sniper: LineItem[] = [];
  for (const m of approved) {
    const fav = m.favorite;
    const favName = fav === "A" ? m.playerA.name : m.playerB.name;
    const s1A = solveSet(m.markov.gA, m.markov.gB, "A").winA;
    const sFavSet1 = fav === "A" ? s1A : 1 - s1A;
    const sFavSet = Math.sqrt(Math.max(m.favWinProb, 0.01));
    const candidates: { key: string; desc: string; descEn: string; prob: number }[] = [
      {
        key: "comeback",
        desc: `${favName} ست اول را می‌بازد و ۲-۱ کامبک می‌کند`,
        descEn: `${favName} LOSES SET 1 & WINS 2-1 COMEBACK`,
        prob: (1 - sFavSet1) * sFavSet * sFavSet,
      },
      {
        key: "tiebreak",
        desc: `تای‌بریک در ست اول (${m.playerA.shortName} × ${m.playerB.shortName})`,
        descEn: `TIEBREAK IN SET 1 (${m.playerA.shortName} × ${m.playerB.shortName})`,
        prob: m.markov.tb1,
      },
      {
        key: "over105",
        desc: `بیش از 10.5 گیم در ست اول (${m.playerA.shortName} × ${m.playerB.shortName})`,
        descEn: `OVER 10.5 GAMES 1ST SET (${m.playerA.shortName} × ${m.playerB.shortName})`,
        prob: m.markov.over105Set1,
      },
    ];
    for (const c of candidates) {
      if (c.prob <= 0.01) continue;
      const odds = Math.round((1 / c.prob) * 100) / 100;
      if (odds < SNIPER_MIN_ODDS || odds > SNIPER_MAX_ODDS) continue;
      sniper.push({
        ...baseItem(m),
        line: "SNIPER",
        leg: `SNIPER-${c.key}`,
        desc: c.desc,
        descEn: c.descEn,
        odds,
        prob: c.prob,
        stake: 1,
        meta: JSON.stringify({
          kind: "sniper",
          snipeKind: c.key,
          favName,
          eventKey: m.eventKey,
        }),
      });
      break;
    }
  }
  sniper.sort((a, b) => b.odds - a.odds);

  // v2.0 dedupe — no pick list may contain the same (match, line, leg) twice
  const dedupe = (items: LineItem[]) =>
    dedupeByKey(items, (i) => `${i.matchId}|${i.line}|${i.leg}`);

  return {
    dual: dedupe(dual),
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
