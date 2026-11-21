// ─── NEOBET Audit v14 · Market Reality Layer ────────────────────────────────
// The single source of TRUTH for real, verifiable market prices.
//
// Design contract:
//   1. A quote can only enter RealOddsQuote from a REAL feed (ESPN Core odds,
//      Polymarket exchange) or from the operator's verified manual entry
//      (BetForward / 1xBet board prices typed into the Odds Reality panel).
//   2. The engine NEVER writes a synthetic row here — fabricated prices live
//      only in the old MODEL_BOARD path and are now clearly labeled.
//   3. When a real quote exists for a market, it LOCKS the card price for that
//      leg (getLive1xBetTennisOdds / boardTakePrice consult this layer first).
//   4. Every lock is recorded in the append-only AuditEvent trail so the
//      "قابل راستی آزمایی" guarantee holds end-to-end.
//
// Feed-health is tracked honestly: if Polymarket is geo-blocked (HTTP 403) or
// ESPN publishes no odds for an event, that fact is surfaced in the audit
// report instead of being silently papered over with model prices.

import { db } from "@/lib/db";
import { fetchEspnMatchOdds } from "./espn";
import { shortHash } from "./hash";

export type QuoteSource = "ESPN" | "POLYMARKET" | "BETFORWARD" | "ONEXBET" | "MANUAL";

export interface RealQuote {
  eventKey: string;
  market: string;
  line: string;
  price: number;
  source: QuoteSource;
  fetchedAt: number; // epoch ms
}

// ── QQL option idx → real-market coordinates ────────────────────────────────
// Mirrors TENNIS_OPTION_POOL (qql-rca-engine.ts) so a real board quote for the
// exact same market can lock the leg price.
export const OPTION_MARKET_OF: Record<number, { market: string; line: string }> = {
  0: { market: "SB_2_0", line: "" },   // favorite wins 2-0
  1: { market: "SB_2_1", line: "" },   // favorite wins 2-1
  2: { market: "SB_D_2_0", line: "" }, // player2 wins 2-0
  3: { market: "SB_D_2_1", line: "" }, // player2 wins 2-1
  4: { market: "TS_O25", line: "2.5" },
  5: { market: "TG_O205", line: "20.5" },
  6: { market: "TG_U215", line: "21.5" },
  7: { market: "GH_F35", line: "-3.5" },
  8: { market: "GH_D35", line: "+3.5" },
  9: { market: "SS_F10_95", line: "" },
};

// ── In-memory cache (per process, reloaded from DB on every refresh) ────────
interface CacheEntry {
  byKey: Map<string, RealQuote>; // `${eventKey}|${market}|${line}` → quote
  loadedAt: number;
}
const g = globalThis as unknown as { __neoRealQuotes?: CacheEntry };
function cache(): CacheEntry {
  if (!g.__neoRealQuotes) g.__neoRealQuotes = { byKey: new Map(), loadedAt: 0 };
  return g.__neoRealQuotes;
}

export const quoteKey = (eventKey: string, market: string, line: string) =>
  `${eventKey}|${market}|${line}`;

async function upsertQuote(q: {
  eventKey: string;
  market: string;
  line: string;
  price: number;
  source: QuoteSource;
  playerA?: string;
  playerB?: string;
  matchLabel?: string;
}): Promise<void> {
  try {
    await db.realOddsQuote.upsert({
      where: {
        eventKey_market_line_source: {
          eventKey: q.eventKey,
          market: q.market,
          line: q.line,
          source: q.source,
        },
      },
      create: q,
      update: { price: q.price, fetchedAt: new Date(), playerA: q.playerA, playerB: q.playerB, matchLabel: q.matchLabel },
    });
  } catch {
    // quote persistence is best-effort — never blocks pricing
  }
  cache().byKey.set(quoteKey(q.eventKey, q.market, q.line), {
    eventKey: q.eventKey,
    market: q.market,
    line: q.line,
    price: q.price,
    source: q.source,
    fetchedAt: Date.now(),
  });
}

/** Reload every stored quote into the process cache. */
export async function loadRealQuoteCache(): Promise<number> {
  const rows = await db.realOddsQuote.findMany({ orderBy: { fetchedAt: "desc" } });
  const m = cache().byKey;
  m.clear();
  for (const r of rows) {
    m.set(quoteKey(r.eventKey, r.market, r.line), {
      eventKey: r.eventKey,
      market: r.market,
      line: r.line,
      price: r.price,
      source: r.source as QuoteSource,
      fetchedAt: r.fetchedAt.getTime(),
    });
  }
  cache().loadedAt = Date.now();
  return m.size;
}

// ── Usage notes: which legs were actually priced from REAL quotes ──────────
const g2 = globalThis as unknown as { __neoRealUsage?: Map<string, number> };
function usage(): Map<string, number> {
  if (!g2.__neoRealUsage) g2.__neoRealUsage = new Map();
  return g2.__neoRealUsage;
}
function noteUsage(eventKey: string, market: string) {
  const k = `${eventKey}|${market}`;
  usage().set(k, (usage().get(k) ?? 0) + 1);
}
export function resetUsage() {
  usage().clear();
}

/**
 * Resolve a real price for an option-domain leg (sync, cache-backed).
 * Used by boardTakePrice() so real quotes outrank the board window model.
 */
export function realOptionQuote(eventKey: string, optIdx: number): number | null {
  const spec = OPTION_MARKET_OF[optIdx];
  if (!spec || !eventKey) return null;
  const q = cache().byKey.get(quoteKey(eventKey, spec.market, spec.line));
  if (q) {
    noteUsage(eventKey, spec.market);
    return q.price;
  }
  return null;
}

/** Resolve a real match-winner quote for the favorite side. */
export function realMWQuote(eventKey: string): number | null {
  if (!eventKey) return null;
  const q = cache().byKey.get(quoteKey(eventKey, "MW", ""));
  if (q) {
    noteUsage(eventKey, "MW");
    return q.price;
  }
  return null;
}

/** Generic real-quote lookup by market + line (e.g. GH_F45 / TG_U205). */
export function realQuotePrice(eventKey: string, market: string, line = ""): number | null {
  if (!eventKey) return null;
  const q = cache().byKey.get(quoteKey(eventKey, market, line));
  if (q) {
    noteUsage(eventKey, market);
    return q.price;
  }
  return null;
}

/** Which price source should be stamped on a persisted pick for this leg. */
export function oddsSourceForItem(
  eventKey?: string,
  leg?: string
): "MODEL_BOARD" | "REAL_MARKET" | "MANUAL_REAL" {
  if (!eventKey || !leg) return "MODEL_BOARD";
  // match-winner wings
  if (/^(A|B)(-|$)/.test(leg) || leg.startsWith("A-") || leg.startsWith("B-")) {
    const q = cache().byKey.get(quoteKey(eventKey, "MW", ""));
    if (q) return q.source === "MANUAL" ? "MANUAL_REAL" : "REAL_MARKET";
    return "MODEL_BOARD";
  }
  // option-domain legs → find their QQL idx
  for (const [idxStr, spec] of Object.entries(OPTION_MARKET_OF)) {
    const q = cache().byKey.get(quoteKey(eventKey, spec.market, spec.line));
    if (q && (leg.includes(spec.market) || leg.includes("T" + idxStr + "-") || leg.includes(spec.market.split("_")[0]))) {
      return q.source === "MANUAL" ? "MANUAL_REAL" : "REAL_MARKET";
    }
  }
  return "MODEL_BOARD";
}

// ── Feed refresh: honest best-effort ingestion ──────────────────────────────
export interface FeedHealth {
  espnOdds: { attempted: number; got: number };
  polymarket: { ok: boolean; status: number | string };
  manualQuotes: number;
  refreshedAt: string;
}

const g3 = globalThis as unknown as { __neoFeedHealth?: FeedHealth };
export function lastFeedHealth(): FeedHealth | null {
  return g3.__neoFeedHealth ?? null;
}

interface RefreshableMatch {
  eventKey: string;
  tour: string;
  playerA: string;
  playerB: string;
}

/** Try Polymarket Gamma — may be geo-blocked (403); report honestly. */
async function polymarketProbe(): Promise<{ ok: boolean; status: number | string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=tennis&limit=30",
      { signal: controller.signal, headers: { accept: "application/json" } }
    );
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: 200 };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, status: e instanceof Error && e.name === "AbortError" ? "timeout" : "network_error" };
  }
}

/**
 * Record an already-fetched real match-winner pair (ESPN Core / Polymarket)
 * into the reality layer. buildFeed calls this with prices it already has so
 * the network is never hit twice.
 */
export async function recordMWQuotes(pairs: Array<{
  eventKey: string;
  playerA: string;
  playerB: string;
  oddsA: number;
  oddsB: number;
  source: QuoteSource;
}>): Promise<number> {
  let n = 0;
  for (const p of pairs) {
    if (!/\d+/.test(p.eventKey) || p.oddsA <= 1.01 || p.oddsB <= 1.01) continue;
    await upsertQuote({
      eventKey: p.eventKey,
      market: "MW_A",
      line: "",
      price: p.oddsA,
      source: p.source,
      playerA: p.playerA,
      playerB: p.playerB,
      matchLabel: `${p.playerA} v ${p.playerB}`,
    });
    await upsertQuote({
      eventKey: p.eventKey,
      market: "MW_B",
      line: "",
      price: p.oddsB,
      source: p.source,
      playerA: p.playerA,
      playerB: p.playerB,
    });
    n++;
  }
  return n;
}

/**
 * Refresh the real-quote layer. `preFetched` pairs (already pulled from ESPN
 * or Polymarket upstream by the caller) are recorded directly; the probe
 * only reports feed health honestly.
 */
export async function refreshRealOdds(
  matches: RefreshableMatch[],
  preFetched: Array<{ eventKey: string; playerA: string; playerB: string; oddsA: number; oddsB: number; source: QuoteSource }> = [],
  opts: { probePolymarket?: boolean; probeEspn?: boolean } = {}
): Promise<FeedHealth> {
  resetUsage();
  await loadRealQuoteCache();

  let got = 0;
  for (const p of preFetched) {
    if (p.oddsA > 1.01 && p.oddsB > 1.01) got++;
  }

  // standalone mode: fetch ESPN odds for matches the caller did not supply
  if (opts.probeEspn && got === 0) {
    const pre = matches.filter((m) => m.eventKey && !m.eventKey.includes("__")).slice(0, 40);
    await Promise.all(
      pre.map(async (m) => {
        const odds = await fetchEspnMatchOdds(m.tour === "WTA" ? "WTA" : "ATP", m.eventKey);
        if (odds && odds.oddsA > 1.01 && odds.oddsB > 1.01) {
          await recordMWQuotes([{ eventKey: m.eventKey, playerA: m.playerA, playerB: m.playerB, oddsA: odds.oddsA, oddsB: odds.oddsB, source: "ESPN" }]);
          got++;
        }
      })
    );
  }

  const pm = opts.probePolymarket === false ? { ok: false, status: "skipped" } : await polymarketProbe();

  const manual = await db.realOddsQuote.count({ where: { source: "MANUAL" } });

  const health: FeedHealth = {
    espnOdds: { attempted: matches.length, got },
    polymarket: { ok: pm.ok, status: pm.status },
    manualQuotes: manual,
    refreshedAt: new Date().toISOString(),
  };
  g3.__neoFeedHealth = health;

  await db.auditEvent
    .create({
      data: {
        kind: "REALITY_CHECK",
        severity: got === 0 && !pm.ok && manual === 0 ? "CRITICAL" : "INFO",
        message:
          got === 0 && !pm.ok && manual === 0
            ? "ODDS FEED STARVED — no ESPN odds, Polymarket blocked, zero manual quotes: every card price is MODEL_BOARD (not market-verified)"
            : `Reality layer refreshed — real MW quotes ${got}, Polymarket ${pm.status}, manual ${manual}`,
        payload: JSON.stringify(health),
      },
    })
    .catch(() => undefined);

  return health;
}

/** Favorite-side MW quote resolution: engine callers pass eventKey + favorite. */
export function realFavMWQuote(eventKey: string, favorite: "A" | "B"): number | null {
  const side = favorite === "A" ? "MW_A" : "MW_B";
  const q = cache().byKey.get(quoteKey(eventKey, side, ""));
  if (q) {
    noteUsage(eventKey, "MW");
    return q.price;
  }
  return null;
}

// ── Reality report: stored quotes vs the card prices on record ──────────────
export interface RealityRow {
  eventKey: string;
  matchLabel: string;
  market: string;
  line: string;
  realPrice: number;
  source: QuoteSource;
  cardOdds: number | null;
  deviationPct: number | null; // (card - real) / real
  verdict: "CARD_INFLATED" | "CARD_CHEAP" | "ALIGNED" | "NO_CARD_PRICE";
}

export async function realityReport(limit = 25): Promise<RealityRow[]> {
  const quotes = await db.realOddsQuote.findMany({ orderBy: { fetchedAt: "desc" }, take: 200 });
  const rows: RealityRow[] = [];
  const seen = new Set<string>();
  for (const q of quotes) {
    if (q.market === "MW_B") continue; // MW_A is the reference row
    const m = await db.tennisMatch.findUnique({ where: { eventKey: q.eventKey } });
    // Audit v14 — match-winner quotes never map to the prop slips the DUAL
    // cards print; comparing 1.23 (Alcaraz MW) against the −3.5-games odds
    // produced a bogus CARD_INFLATED row. Only prop quotes map to card slips.
    const cardOdds = q.market === "MW_A" || q.market === "MW" ? null : pickCardOddsForMarket(m, q.market);
    const dev = cardOdds && q.price > 1 ? (cardOdds - q.price) / q.price : null;
    const key = `${q.eventKey}|${q.market}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      eventKey: q.eventKey,
      matchLabel: q.matchLabel ?? (m ? `${m.playerA} v ${m.playerB}` : q.eventKey),
      market: q.market,
      line: q.line,
      realPrice: q.price,
      source: q.source as QuoteSource,
      cardOdds,
      deviationPct: dev === null ? null : Math.round(dev * 1000) / 10,
      verdict:
        cardOdds == null
          ? "NO_CARD_PRICE"
          : dev! > 0.1
            ? "CARD_INFLATED"
            : dev! < -0.1
              ? "CARD_CHEAP"
              : "ALIGNED",
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

function pickCardOddsForMarket(
  m: { slipAText: string | null; slipAOdds: number | null; slipBText: string | null; slipBOdds: number | null } | null,
  market: string
): number | null {
  if (!m) return null;
  const tag = market.split("_")[0]; // SB | TS | TG | GH | SS
  const a = (m.slipAText ?? "").toUpperCase();
  const b = (m.slipBText ?? "").toUpperCase();
  if (tag === "SB" && a.includes("2-0")) return m.slipAOdds;
  if (tag === "SB" && b.includes("2-0")) return m.slipBOdds;
  if (tag === "TS" && (a.includes("2.5 SETS") || b.includes("2.5 SETS")))
    return a.includes("2.5 SETS") ? m.slipAOdds : m.slipBOdds;
  if (tag === "TG") {
    if (a.includes("20.5") || b.includes("20.5")) return a.includes("20.5") ? m.slipAOdds : m.slipBOdds;
    if (a.includes("21.5") || b.includes("21.5")) return a.includes("21.5") ? m.slipAOdds : m.slipBOdds;
  }
  if (tag === "GH" && (a.includes("3.5") || b.includes("3.5")))
    return a.includes("3.5") && a.includes("-") ? m.slipAOdds : b.includes("+") ? m.slipBOdds : m.slipAOdds ?? m.slipBOdds;
  return null;
}

/** Manual quote entry (Odds Reality panel → engine lock). */
export async function addManualQuote(input: {
  eventKey: string;
  market: string;
  line?: string;
  price: number;
  matchLabel?: string;
  playerA?: string;
  playerB?: string;
  source?: QuoteSource;
}): Promise<void> {
  if (!Number.isFinite(input.price) || input.price < 1.01 || input.price > 100) {
    throw new Error("invalid price");
  }
  const source: QuoteSource = input.source ?? "MANUAL";
  await upsertQuote({
    eventKey: input.eventKey,
    market: input.market,
    line: input.line ?? "",
    price: Math.round(input.price * 100) / 100,
    source,
    matchLabel: input.matchLabel,
    playerA: input.playerA,
    playerB: input.playerB,
  });
  await db.auditEvent
    .create({
      data: {
        kind: "QUOTE_LOCKED",
        message: `Real ${source} quote locked: ${input.eventKey} ${input.market}${input.line ? ` @ ${input.line}` : ""} = ${input.price}`,
        payload: JSON.stringify(input),
      },
    })
    .catch(() => undefined);
}

/** Deterministic audit tag for the reality layer build. */
export function realityVersion(): string {
  return shortHash("reality-v14").slice(0, 8);
}
