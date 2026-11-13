// ─── Telegram Supervisor Agent — Tennis Live Radar (ESPN, zero-key) ─────────
// DIRECTOR UPDATE: football news is CANCELLED. This module is now 100% TENNIS:
//   1) ATP/WTA newswire         → top stories (English poster + Persian caption)
//   2) ATP/WTA live scoreboard  → LIVE matches with set-by-set scoreline
//   3) Fitness radar            → injury / fitness / withdrawal / comeback scan
// Posters: English. Captions: FULL Persian (LLM) — bilingual channel rule.

export interface TennisNewsItem {
  id: string;
  headline: string;
  description: string;
  published?: string;
  link?: string;
  image?: string;
  tour: "ATP" | "WTA";
  tourFa: string;
}

export interface LiveTennisMatch {
  id: string;
  tour: "ATP" | "WTA";
  tournament: string;
  playerA: string;
  playerB: string;
  shortA?: string;
  shortB?: string;
  state: "pre" | "in" | "post";
  /** ESPN status detail: "Set 2 - 4-3" / "Final" / scheduled kickoff */
  detail: string;
  /** set-by-set scoreline, e.g. "6-4 3-6 4-3" */
  scoreLine: string;
  winnerSide?: "A" | "B";
  /** ESPN note line (often the complete result sentence) */
  note?: string;
  venue?: string;
  court?: string;
}

export type FitnessTag = "INJURY" | "FITNESS" | "WITHDRAWAL" | "COMEBACK" | "RECOVERY";

export interface FitnessItem {
  id: string;
  headline: string;
  tour: "ATP" | "WTA";
  tag: FitnessTag;
}

export interface TennisRadar {
  news: TennisNewsItem[];
  live: LiveTennisMatch[];
  fitness: FitnessItem[];
}

// ─── ESPN plumbing ──────────────────────────────────────────────────────────

interface EspnArticle {
  id?: string | number;
  headline?: string;
  description?: string;
  published?: string;
  images?: { url?: string }[];
  links?: { web?: { href?: string } };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

const CACHE = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL = 8 * 60_000;

async function cachedJson<T>(key: string, url: string): Promise<T | null> {
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data as T;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", "user-agent": UA },
    });
    if (!res.ok) throw new Error(`ESPN ${key} HTTP ${res.status}`);
    const json = (await res.json()) as T;
    CACHE.set(key, { at: Date.now(), data: json });
    return json;
  } catch (e) {
    console.error(`[tennis-radar] ${key} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ─── 1) ATP/WTA newswire ────────────────────────────────────────────────────

interface EspnNewsResponse {
  articles?: EspnArticle[];
}

const TOURS: { tour: "ATP" | "WTA"; fa: string }[] = [
  { tour: "ATP", fa: "تور حرفه‌ای مردان اِی‌تی‌پی" },
  { tour: "WTA", fa: "تور حرفه‌ای زنان دبلیو‌تی‌اِی" },
];

export async function fetchTennisNews(): Promise<TennisNewsItem[]> {
  const out: TennisNewsItem[] = [];
  const seen = new Set<string>();

  for (const t of TOURS) {
    const json = await cachedJson<EspnNewsResponse>(
      `news_${t.tour}`,
      `https://site.api.espn.com/apis/site/v2/sports/tennis/${t.tour.toLowerCase()}/news?limit=14`
    );
    for (const a of json?.articles ?? []) {
      const headline = (a.headline ?? "").trim();
      const description = (a.description ?? "").trim();
      if (!headline || headline.length < 16) continue;
      const key = headline.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 64);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: String(a.id ?? key),
        headline,
        description: description || headline,
        published: a.published,
        link: a.links?.web?.href,
        image: a.images?.[0]?.url,
        tour: t.tour,
        tourFa: t.fa,
      });
    }
  }

  out.sort((x, y) => new Date(y.published ?? 0).getTime() - new Date(x.published ?? 0).getTime());
  return out;
}

// ─── 2) ATP/WTA live scoreboard ─────────────────────────────────────────────

interface SbLinescore {
  value?: number;
  winner?: boolean;
}
interface SbCompetitor {
  order?: number;
  winner?: boolean;
  score?: string;
  linescores?: SbLinescore[];
  athlete?: {
    displayName?: string;
    shortName?: string;
    rank?: number;
  };
}
interface SbCompetition {
  id?: string;
  date?: string;
  status?: {
    type?: {
      state?: string;
      detail?: string;
      shortDetail?: string;
      description?: string;
      completed?: boolean;
    };
  };
  venue?: { fullName?: string; court?: string };
  notes?: { text?: string; type?: string }[];
  competitors?: SbCompetitor[];
}
interface SbGrouping {
  grouping?: { slug?: string; displayName?: string };
  competitions?: SbCompetition[];
}
interface SbEvent {
  id?: string;
  name?: string;
  shortName?: string;
  status?: SbCompetition["status"];
  groupings?: SbGrouping[];
}
interface SbResponse {
  events?: SbEvent[];
}

function displayNameOf(c: SbCompetitor | undefined): string {
  return (c?.athlete?.displayName ?? "").trim();
}

function shortOf(c: SbCompetitor | undefined, fallback: string): string {
  return (c?.athlete?.shortName ?? fallback).trim();
}

/** pair per-set linescores into "6-4 3-6 4-3" */
function scoreLineOf(a: SbCompetitor | undefined, b: SbCompetitor | undefined): string {
  const la = a?.linescores ?? [];
  const lb = b?.linescores ?? [];
  const n = Math.max(la.length, lb.length);
  if (n === 0) return (a?.score && b?.score ? `${a.score}-${b.score}` : "").trim();
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const va = la[i]?.value;
    const vb = lb[i]?.value;
    if (va === undefined && vb === undefined) continue;
    parts.push(`${va ?? 0}-${vb ?? 0}`);
  }
  return parts.join(" ");
}

function mapCompetition(
  ev: SbEvent,
  comp: SbCompetition,
  tour: "ATP" | "WTA"
): LiveTennisMatch | null {
  const comps = (comp.competitors ?? []).slice().sort((x, y) => (x.order ?? 1) - (y.order ?? 1));
  const a = comps[0];
  const b = comps[1];
  const nameA = displayNameOf(a);
  const nameB = displayNameOf(b);
  if (!nameA || !nameB) return null;
  const stateRaw = (comp.status?.type?.state ?? ev.status?.type?.state ?? "pre").toLowerCase();
  const state: LiveTennisMatch["state"] =
    stateRaw === "in" ? "in" : stateRaw === "post" ? "post" : "pre";
  const detail =
    (comp.status?.type?.shortDetail ?? comp.status?.type?.detail ?? comp.status?.type?.description ?? "").trim() ||
    (state === "pre" && comp.date ? "SCHEDULED" : state === "in" ? "LIVE NOW" : "FINAL");
  const winner = comps.find((c) => c.winner);
  const winnerSide = winner ? (winner.order === 1 ? "A" : winner.order === 2 ? "B" : undefined) : undefined;
  return {
    id: comp.id ?? `${ev.id}-${nameA}`,
    tour,
    tournament: (ev.name ?? ev.shortName ?? "TOURNAMENT").toUpperCase(),
    playerA: nameA,
    playerB: nameB,
    shortA: shortOf(a, nameA).toUpperCase(),
    shortB: shortOf(b, nameB).toUpperCase(),
    state,
    detail: detail.toUpperCase(),
    scoreLine: scoreLineOf(a, b),
    winnerSide,
    note: comp.notes?.[0]?.text,
    venue: comp.venue?.fullName,
    court: comp.venue?.court,
  };
}

export async function fetchLiveTennis(): Promise<LiveTennisMatch[]> {
  const out: LiveTennisMatch[] = [];
  const seen = new Set<string>();
  for (const t of TOURS) {
    const json = await cachedJson<SbResponse>(
      `sb_${t.tour}`,
      `https://site.api.espn.com/apis/site/v2/sports/tennis/${t.tour.toLowerCase()}/scoreboard`
    );
    for (const ev of json?.events ?? []) {
      for (const g of ev.groupings ?? []) {
        for (const comp of g.competitions ?? []) {
          const m = mapCompetition(ev, comp, t.tour);
          if (!m) continue;
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          out.push(m);
        }
      }
    }
  }
  // live first, then upcoming, then recent finals (newest date last step)
  const rank = { in: 0, pre: 1, post: 2 } as const;
  out.sort((x, y) => rank[x.state] - rank[y.state]);
  return out;
}

// ─── 3) Fitness radar (وضعیت جسمانی) ────────────────────────────────────────

const FITNESS_PATTERNS: [RegExp, FitnessTag][] = [
  [/\b(injur|injured|injury|surgery|operated|fracture|strain|sprain|tear|hernia)\b/i, "INJURY"],
  [/\b(withdrew|withdrawal|pull(s)? out|pulled out|ruled out|out of the (tournament|event)|sidelined|out for|won't play|will not play|non partant)\b/i, "WITHDRAWAL"],
  [/\b(fitness|fit enough|physical (condition|shape|form)|match fit|training block|conditioning)\b/i, "FITNESS"],
  [/\b(comeback|come back|returns? (to|from|after)|returned (to|from|after)|makes? his return|makes? her return)\b/i, "COMEBACK"],
  [/\b(recovery|recovering|rehab|rehabilitation|back in training|resumed training|cleared to play|medical timeout)\b/i, "RECOVERY"],
];

const FATIGUE_PATTERNS: [RegExp, FitnessTag][] = [
  [/\b(exhaust|fatigue|fatigued|cramp|heat|illness|sick|covid|flu|virus|dizzy|retired (mid|during|in the)|medical stop)\b/i, "FITNESS"],
];

function tagOf(text: string): FitnessTag | null {
  for (const [re, tag] of [...FITNESS_PATTERNS, ...FATIGUE_PATTERNS]) {
    if (re.test(text)) return tag;
  }
  return null;
}

export function extractFitnessItems(news: TennisNewsItem[], limit = 6): FitnessItem[] {
  const out: FitnessItem[] = [];
  const seen = new Set<string>();
  for (const n of news) {
    const tag = tagOf(n.headline) ?? tagOf(n.description);
    if (!tag) continue;
    const key = n.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, headline: n.headline, tour: n.tour, tag });
    if (out.length >= limit) break;
  }
  return out;
}

// ─── aggregate radar (single warm entry point) ──────────────────────────────

let lastRadar: { at: number; radar: TennisRadar } | null = null;

/** synchronous access to the last cached radar (for /status) */
export function peekRadar(): TennisRadar | null {
  return lastRadar?.radar ?? null;
}

/** News + live matches + fitness in one call (short-lived cache). */
export async function fetchTennisRadar(force = false): Promise<TennisRadar> {
  if (!force && lastRadar && Date.now() - lastRadar.at < 4 * 60_000) return lastRadar.radar;
  const [news, live] = await Promise.all([fetchTennisNews(), fetchLiveTennis()]);
  const radar: TennisRadar = {
    news,
    live,
    fitness: extractFitnessItems(news),
  };
  lastRadar = { at: Date.now(), radar };
  return radar;
}
