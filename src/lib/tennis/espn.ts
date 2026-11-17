// ─── NeoTennis Markov Quant — liveTennisService (ESPN Zero-Key Data Hub) ───
// Live ATP/WTA scoreboards (today + 3-day window for auto-settlement),
// official world rankings, and the tennis news radar.
// Docs: https://github.com/pseudo-r/Public-ESPN-API (tennis)

import type {
  EspnMatch,
  NewsItem,
  RankRow,
  SurfaceSource,
  Tour,
} from "./types";
import { resolveSurface } from "./surfaces";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/tennis";

// ─── short-TTL network cache (scoreboard/rankings/news shared across calls) ─
const netCache = new Map<string, { at: number; data: unknown }>();
const NET_TTL: Record<string, number> = {
  scoreboard: 45 * 1000,
  rankings: 10 * 60 * 1000,
  news: 5 * 60 * 1000,
};

async function getJsonCached(
  url: string,
  kind: keyof typeof NET_TTL,
  timeoutMs = 12000
): Promise<unknown> {
  const hit = netCache.get(url);
  if (hit && Date.now() - hit.at < NET_TTL[kind]) return hit.data;
  const data = await getJson(url, timeoutMs);
  netCache.set(url, { at: Date.now(), data });
  return data;
}

async function getJson(url: string, timeoutMs = 12000): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      referer: "https://www.espn.com/tennis/",
    },
  });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

// ─── v7.0 · ESPN Core Tennis Odds (100% automated live-odds pipeline) ──────
// Master-prompt v7.0 §1: the odds feed is Polymarket Gamma + ESPN Core Odds.
// Polymarket only lists a subset of tour matches, so every match WITHOUT a
// Gamma quote gets its live match-winner price from the ESPN CORE odds API
// (sports.core.api.espn.com) — zero manual input, zero fixed constants.

interface EspnCoreOddsRaw {
  provider?: { name?: string };
  moneyLineHome?: number | { value?: number; decimalOdds?: number; americanOdds?: number } | null;
  moneyLineAway?: number | { value?: number; decimalOdds?: number; americanOdds?: number } | null;
  moneylineHome?: number | { value?: number; decimalOdds?: number; americanOdds?: number } | null;
  moneylineAway?: number | { value?: number; decimalOdds?: number; americanOdds?: number } | null;
  details?: string;
}

/** American (-250 / +180) or decimal odds → decimal price. */
function toDecimalOdds(v: number | undefined | null): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return undefined;
  if (v < 0) return Number((1 + 100 / Math.abs(v)).toFixed(3)); // american favorite
  if (v > 100) return Number(v.toFixed(3)); // already decimal
  return Number((1 + v / 100).toFixed(3)); // american underdog
}

function moneylineValue(
  ml: EspnCoreOddsRaw["moneyLineHome"]
): number | undefined {
  if (typeof ml === "number") return ml;
  if (!ml || typeof ml !== "object") return undefined;
  return ml.decimalOdds ?? ml.americanOdds ?? ml.value;
}

/** Live match-winner odds of ONE match from the ESPN Core odds endpoint. */
export async function fetchEspnMatchOdds(
  tour: Tour,
  eventKey: string
): Promise<{ oddsA: number; oddsB: number; provider: string } | null> {
  const league = tour.toLowerCase();
  const url = `https://sports.core.api.espn.com/v2/sports/tennis/leagues/${league}/events/${eventKey}/competitions/${eventKey}/odds`;
  try {
    const raw = (await getJson(url, 7000)) as EspnCoreOddsRaw;
    const home = toDecimalOdds(moneylineValue(raw.moneyLineHome ?? raw.moneylineHome));
    const away = toDecimalOdds(moneylineValue(raw.moneyLineAway ?? raw.moneylineAway));
    if (!home || !away || home <= 1.01 || away <= 1.01) return null;
    return {
      oddsA: home,
      oddsB: away,
      provider: raw.provider?.name ?? "ESPN Core",
    };
  } catch {
    return null; // odds coverage is best-effort — never blocks the pipeline
  }
}

// ─── Scoreboard parsing ────────────────────────────────────────────────────

interface EspnLinescore {
  value?: number;
  tiebreak?: number;
  winner?: boolean;
}

interface EspnAthlete {
  displayName?: string;
  shortName?: string;
  headshot?: { href?: string };
  flag?: { href?: string };
}

interface EspnCompetitorRaw {
  id?: string;
  homeAway?: string;
  order?: number;
  winner?: boolean;
  curatedRank?: { current?: number };
  linescores?: EspnLinescore[];
  athlete?: EspnAthlete;
}

interface EspnCompetitionRaw {
  id?: string;
  date?: string;
  status?: { type?: { state?: string } };
  venue?: { fullName?: string; court?: string };
  round?: { displayName?: string };
  type?: { text?: string; slug?: string };
  notes?: { text?: string }[];
  competitors?: EspnCompetitorRaw[];
}

interface EspnEventRaw {
  id?: string;
  name?: string;
  date?: string;
  venue?: { displayName?: string };
  groupings?: { grouping?: unknown; competitions?: EspnCompetitionRaw[] }[];
}

function isSingles(comp: EspnCompetitionRaw, tour: Tour): boolean {
  const slug = comp.type?.slug ?? "";
  const text = comp.type?.text ?? "";
  if (slug.includes("singles")) return true;
  if (text.toLowerCase().includes("singles")) return true;
  if (slug.includes("doubles") || text.toLowerCase().includes("doubles")) return false;
  // groupings headings are not always replicated per competition; assume singles
  return true;
}

function toEspnMatch(
  ev: EspnEventRaw,
  comp: EspnCompetitionRaw,
  tour: Tour,
  dateKey: string
): EspnMatch | null {
  const comps = comp.competitors ?? [];
  if (comps.length !== 2) return null;
  const a =
    comps.find((c) => c.homeAway === "home") ?? comps.find((c) => c.order === 1);
  const b =
    comps.find((c) => c.homeAway === "away") ?? comps.find((c) => c.order === 2);
  if (!a || !b) return null;
  const nameOf = (c: EspnCompetitorRaw) => c.athlete?.displayName?.trim();
  const nameA = nameOf(a);
  const nameB = nameOf(b);
  if (!nameA || !nameB) return null; // TBD placeholders (qualifiers) are skipped
  if (nameA === nameB) return null;
  // placeholder names like "TBD" / "To Be Determined" must not reach the engine
  const isPlaceholder = (n: string) => /^(tbd|to be determined|qualifier ?\d*|winner of.*|loser of.*)$/i.test(n);
  if (isPlaceholder(nameA) || isPlaceholder(nameB)) return null;

  const state = (comp.status?.type?.state ?? "pre") as EspnMatch["state"];
  const month = new Date(comp.date ?? Date.now()).getMonth();
  const tournamentName = ev.name ?? "Unknown Tournament";
  const city = ev.venue?.displayName;
  const { surface, source } = resolveSurface(tournamentName, city, month);

  const player = (c: EspnCompetitorRaw) => ({
    name: nameOf(c)!,
    shortName: c.athlete?.shortName ?? nameOf(c)!,
    flagUrl: c.athlete?.flag?.href,
    headshotUrl: c.athlete?.headshot?.href,
    // curatedRank in the scoreboard is the TOURNAMENT SEED — world ranking
    // comes from the official /rankings table in the engine layer.
    seed: c.curatedRank?.current,
    linescores: (c.linescores ?? []).map((l) => ({
      value: l.value ?? 0,
      tiebreak: l.tiebreak,
      winner: l.winner,
    })),
    winner: c.winner,
    espnAthleteId: c.id,
  });

  return {
    eventKey: comp.id ?? `${tour}-${dateKey}-${nameA}-${nameB}`,
    dateKey,
    tour,
    tournament: tournamentName,
    city,
    venueCourt: comp.venue?.court,
    surface,
    surfaceSrc: source as SurfaceSource,
    round: comp.round?.displayName ?? "Main Draw",
    singles: isSingles(comp, tour),
    state,
    startTime: comp.date ?? ev.date,
    playerA: player(a),
    playerB: player(b),
    resultText: comp.notes?.[0]?.text,
  };
}

export async function fetchScoreboard(
  tour: Tour,
  dates?: string
): Promise<EspnMatch[]> {
  const url = `${ESPN_BASE}/${tour.toLowerCase()}/scoreboard${dates ? `?dates=${dates}` : ""}`;
  const json = (await getJsonCached(url, "scoreboard")) as { events?: EspnEventRaw[] };
  const out: EspnMatch[] = [];
  for (const ev of json.events ?? []) {
    for (const group of ev.groupings ?? []) {
      for (const comp of group.competitions ?? []) {
        const m = toEspnMatch(ev, comp, tour, dates ?? todayKey());
        if (m) out.push(m);
      }
    }
  }
  return out;
}

// ─── Rankings (official world Top-100+ tables) ─────────────────────────────

interface EspnRankEntry {
  current?: number;
  previous?: number;
  points?: number;
  athlete?: { displayName?: string };
}

interface EspnRankingsResponse {
  rankings?: {
    name?: string;
    ranks?: EspnRankEntry[];
  }[];
}

export async function fetchRankings(tour: Tour): Promise<RankRow[]> {
  const url = `${ESPN_BASE}/${tour.toLowerCase()}/rankings`;
  const json = (await getJsonCached(url, "rankings")) as EspnRankingsResponse;
  const r0 = json.rankings?.[0];
  const rows: RankRow[] = [];
  for (const r of r0?.ranks ?? []) {
    if (!r.athlete?.displayName || !r.current) continue;
    rows.push({
      rank: r.current,
      name: r.athlete.displayName,
      points: r.points ?? 0,
      previous: r.previous ?? r.current,
      tour,
    });
  }
  return rows.sort((a, b) => a.rank - b.rank);
}

/** name → {rank, points} lookup map used by the engine */
export function buildRankingLookup(rows: RankRow[]): Map<string, RankRow> {
  const map = new Map<string, RankRow>();
  for (const r of rows) {
    map.set(normalizeName(r.name), r);
    // also index by surname for robustness
    const surname = surnameOf(r.name);
    if (surname && !map.has(surname)) map.set(surname, r);
  }
  return map;
}

// ─── News radar ────────────────────────────────────────────────────────────

interface EspnNewsResponse {
  articles?: {
    id?: string;
    headline?: string;
    description?: string;
    published?: string;
    images?: { url?: string }[];
    links?: { web?: { href?: string } };
  }[];
}

export async function fetchNews(tour: Tour): Promise<NewsItem[]> {
  const url = `${ESPN_BASE}/${tour.toLowerCase()}/news`;
  const json = (await getJsonCached(url, "news")) as EspnNewsResponse;
  return (json.articles ?? []).slice(0, 8).map((a, i) => ({
    id: a.id ?? `${tour}-news-${i}`,
    headline: a.headline ?? "",
    description: a.description,
    published: a.published,
    image: a.images?.[0]?.url,
    link: a.links?.web?.href,
    tour,
  }));
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function dateKeyDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayKey(d);
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function surnameOf(name: string): string {
  const n = normalizeName(name);
  const parts = n.split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : n;
}
