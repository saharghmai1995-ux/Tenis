// ─── NeoTennis Markov Quant — Polymarket Gamma Free-Market Odds Feed ───────
// Fee-free tennis market prices (prediction exchange) used as the 65% market
// leg of the fusion formula. Binary player-vs-player markets are detected and
// mapped to ESPN matches by surname + first-initial matching.

import type { MarketOdds } from "./types";
import { normalizeName, surnameOf } from "./espn";

const GAMMA_URL =
  "https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=tennis&limit=30";

// 60s cache to survive rapid successive feed builds
let pmCache: { at: number; odds: MarketOdds[] } | null = null;
const PM_TTL = 60 * 1000;

interface GammaMarket {
  question?: string;
  outcomes?: string; // JSON-encoded string array
  outcomePrices?: string; // JSON-encoded string array
  volumeNum?: number;
  closed?: boolean;
  active?: boolean;
  acceptingOrders?: boolean;
}

interface GammaEvent {
  id?: string;
  title?: string;
  startDate?: string;
  closed?: boolean;
  active?: boolean;
  markets?: GammaMarket[];
  volumeNum?: number;
}

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return Array.isArray(raw) ? (raw as unknown as string[]) : [];
  }
}

function splitVersus(title: string): [string, string] | null {
  const m = title.split(/\s+vs\.?\s+/i);
  if (m.length !== 2) return null;
  // strip a leading "Tournament:" prefix from the first side
  let a = m[0];
  const colon = a.lastIndexOf(":");
  if (colon >= 0 && colon < a.length - 2) a = a.slice(colon + 1);
  const b = m[1];
  const clean = (s: string) =>
    s
      .replace(/[:\-–].*$/, "")
      .replace(/\(.*?\)/g, "")
      .trim();
  return [clean(a), clean(b)].map((s) => s.trim()) as [string, string];
}

/** Surname + first-initial compatibility check. */
export function playerNameMatch(liveName: string, marketName: string): boolean {
  const a = normalizeName(liveName);
  const b = normalizeName(marketName);
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = surnameOf(a);
  const sb = surnameOf(b);
  if (sa && sa === sb) {
    const ia = a[0];
    const ib = b[0];
    // accept when initials match or one side has a single-word name
    return !ia || !ib || ia === ib;
  }
  return false;
}

export async function fetchPolymarketOdds(): Promise<MarketOdds[]> {
  if (pmCache && Date.now() - pmCache.at < PM_TTL) return pmCache.odds;
  const res = await fetch(GAMMA_URL, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Gamma HTTP ${res.status}`);
  const events = (await res.json()) as GammaEvent[];

  const odds: MarketOdds[] = [];
  for (const ev of events) {
    if (!ev.title) continue;
    const sides = splitVersus(ev.title);
    if (!sides) continue; // futures / props are not match markets
    const [sideA, sideB] = sides;

    // pick the main moneyline market: outcomes = the two player names
    let best: { probA: number; probB: number; oddsA: number; oddsB: number; volume: number } | null = null;
    for (const mk of ev.markets ?? []) {
      if (mk.closed === true) continue;
      const outcomes = parseJsonArray(mk.outcomes);
      const prices = parseJsonArray(mk.outcomePrices);
      if (outcomes.length !== 2 || prices.length !== 2) continue;
      const [o0, o1] = outcomes;
      if (/^yes$/i.test(o0) || /^no$/i.test(o0)) continue; // Yes/No props skipped
      const p0 = parseFloat(prices[0]);
      const p1 = parseFloat(prices[1]);
      if (!Number.isFinite(p0) || !Number.isFinite(p1)) continue;
      // confirm the market outcomes correspond to the event's two players
      const a0 = playerNameMatch(sideA, o0) && playerNameMatch(sideB, o1);
      const a1 = playerNameMatch(sideA, o1) && playerNameMatch(sideB, o0);
      if (!a0 && !a1) continue;
      const probA = a0 ? p0 : p1;
      const probB = a0 ? p1 : p0;
      const sum = probA + probB;
      const normA = sum > 0 ? probA / sum : probA;
      const volume = mk.volumeNum ?? 0;
      if (!best || volume > best.volume) {
        best = {
          probA: normA,
          probB: sum > 0 ? probB / sum : probB,
          oddsA: normA > 0 ? 1 / normA : 999,
          oddsB: probB > 0 ? 1 / (sum > 0 ? probB / sum : probB) : 999,
          volume,
        };
      }
    }
    if (best && best.probA > 0.01 && best.probA < 0.99) {
      odds.push({
        playerA: sideA,
        playerB: sideB,
        probA: best.probA,
        probB: best.probB,
        oddsA: best.oddsA,
        oddsB: best.oddsB,
        source: "polymarket",
        eventTitle: ev.title,
        volume: best.volume,
      });
    }
  }
  pmCache = { at: Date.now(), odds };
  return odds;
}

/** Attach a market to an ESPN match by player-name matching. */
export function matchMarket(
  matches: { playerA: string; playerB: string }[],
  odds: MarketOdds[]
): Map<string, MarketOdds> {
  const result = new Map<string, MarketOdds>();
  for (const oddsItem of odds) {
    for (const m of matches) {
      const direct =
        playerNameMatch(m.playerA, oddsItem.playerA) &&
        playerNameMatch(m.playerB, oddsItem.playerB);
      const flipped =
        playerNameMatch(m.playerA, oddsItem.playerB) &&
        playerNameMatch(m.playerB, oddsItem.playerA);
      if (direct || flipped) {
        const key = `${m.playerA}__${m.playerB}`;
        if (!result.has(key)) {
          result.set(key, direct ? oddsItem : flippedOdds(oddsItem));
        }
      }
    }
  }
  return result;
}

function flippedOdds(o: MarketOdds): MarketOdds {
  return {
    ...o,
    playerA: o.playerB,
    playerB: o.playerA,
    probA: o.probB,
    probB: o.probA,
    oddsA: o.oddsB,
    oddsB: o.oddsA,
  };
}
