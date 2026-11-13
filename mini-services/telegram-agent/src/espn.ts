// ─── Telegram Supervisor Agent — ESPN Football News Radar ──────────────────
// Zero-key ESPN public API. Aggregates top stories across the major leagues.
// Posters: English headline/description. Captions: FULL Persian translation
// (LLM) — the channel is bilingual, poster English + caption Persian.

export interface SoccerNewsItem {
  id: string;
  headline: string;
  description: string;
  published?: string;
  link?: string;
  image?: string;
  league: string; // EN league label for the poster tag
  leagueFa: string;
}

interface EspnArticle {
  id?: string;
  headline?: string;
  description?: string;
  published?: string;
  images?: { url?: string }[];
  links?: { web?: { href?: string } };
}

interface EspnNewsResponse {
  articles?: EspnArticle[];
}

const LEAGUES: { slug: string; en: string; fa: string }[] = [
  { slug: "eng.1", en: "PREMIER LEAGUE", fa: "لیگ برتر انگلیس" },
  { slug: "esp.1", en: "LA LIGA", fa: "لالیگا اسپانیا" },
  { slug: "ita.1", en: "SERIE A", fa: "سری آ ایتالیا" },
  { slug: "ger.1", en: "BUNDESLIGA", fa: "بوندسلیگا آلمان" },
  { slug: "uefa.champions", en: "CHAMPIONS LEAGUE", fa: "لیگ قهرمانان اروپا" },
  { slug: "fra.1", en: "LIGUE 1", fa: "لیگ یک فرانسه" },
];

const CACHE = new Map<string, { at: number; items: SoccerNewsItem[] }>();
const CACHE_TTL = 10 * 60_000;

async function leagueNews(slug: string): Promise<EspnArticle[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/news?limit=12`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`ESPN soccer HTTP ${res.status}`);
  const json = (await res.json()) as EspnNewsResponse;
  return json.articles ?? [];
}

/** Top fresh stories across leagues, newest first, deduped by headline hash. */
export async function fetchFootballNews(): Promise<SoccerNewsItem[]> {
  const out: SoccerNewsItem[] = [];
  const seen = new Set<string>();
  let anyOk = false;

  for (const lg of LEAGUES) {
    const hit = CACHE.get(lg.slug);
    let articles: EspnArticle[];
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      articles = hit.items.map((i) => ({
        id: i.id,
        headline: i.headline,
        description: i.description,
        published: i.published,
        images: i.image ? [{ url: i.image }] : [],
        links: i.link ? { web: { href: i.link } } : undefined,
      }));
    } else {
      try {
        articles = await leagueNews(lg.slug);
        anyOk = true;
      } catch (e) {
        console.error(`[espn] ${lg.slug} failed:`, e instanceof Error ? e.message : e);
        continue;
      }
    }

    for (const a of articles) {
      const headline = (a.headline ?? "").trim();
      const description = (a.description ?? "").trim();
      if (!headline || headline.length < 16) continue;
      const key = headline.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 64);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: a.id ?? key,
        headline,
        description: description || headline,
        published: a.published,
        link: a.links?.web?.href,
        image: a.images?.[0]?.url,
        league: lg.en,
        leagueFa: lg.fa,
      });
    }
  }

  out.sort((x, y) => new Date(y.published ?? 0).getTime() - new Date(x.published ?? 0).getTime());
  return out;
}
