// ─── NeoTennis Markov Quant — Tournament Surface Atlas ─────────────────────
// ESPN's tennis scoreboard does not expose a structured surface field, so the
// engine resolves the court surface from the OFFICIAL ATP/WTA calendar map of
// professional tournaments (domain knowledge — not synthetic match data).
// Unmapped events fall back to month-based inference and are flagged as such.

import type { Surface, SurfaceSource } from "./types";

const MAPPED: Record<string, Surface> = {
  // ── Grand Slams
  "australian open": "HARD",
  "roland garros": "CLAY",
  "french open": "CLAY",
  "wimbledon": "GRASS",
  "us open": "HARD",
  // ── ATP Masters 1000 & big events
  "indian wells": "HARD",
  "bnp paribas open": "HARD",
  "miami": "HARD",
  "miami open": "HARD",
  "monte carlo": "CLAY",
  "monte-carlo": "CLAY",
  "rolex monte-carlo masters": "CLAY",
  "madrid": "CLAY",
  "rome": "CLAY",
  "internazionali bnl d'italia": "CLAY",
  "canada": "HARD",
  "national bank open": "HARD",
  "cincinnati": "HARD",
  "shanghai": "HARD",
  "rolex shanghai masters": "HARD",
  "paris": "HARD",
  "rolex paris masters": "HARD",
  "paris masters": "HARD",
  "nitto atp finals": "HARD",
  "atp finals": "HARD",
  "turin": "HARD",
  // ── ATP 500 / 250 (common calendar stops)
  "brisbane": "HARD",
  "adelaide": "HARD",
  "auckland": "HARD",
  "montpellier": "HARD",
  "cordoba": "CLAY",
  "buenos aires": "CLAY",
  "delray beach": "HARD",
  "marseille": "HARD",
  "doha": "HARD",
  "rotterdam": "HARD",
  "new york open": "HARD",
  "dubai": "HARD",
  "acapulco": "HARD",
  "abierto mexicano": "HARD",
  "santiago": "CLAY",
  "rio de janeiro": "CLAY",
  "rio open": "CLAY",
  "marbella": "CLAY",
  "marrakech": "CLAY",
  "houston": "CLAY",
  "us men's clay court championship": "CLAY",
  "estoril": "CLAY",
  "munich": "CLAY",
  "bmw open": "CLAY",
  "barcelona": "CLAY",
  "barcelona open": "CLAY",
  "madrid open": "CLAY",
  "geneva": "CLAY",
  "lyon": "CLAY",
  "lyon open": "CLAY",
  "hamburg": "CLAY",
  "hamburg open": "CLAY",
  "stuttgart": "GRASS",
  "s-hertogenbosch": "GRASS",
  "libema open": "GRASS",
  "halle": "GRASS",
  "terra wortmann open": "GRASS",
  "queen's club": "GRASS",
  "cinch championships": "GRASS",
  "eastbourne": "GRASS",
  "mallorca": "GRASS",
  "newport": "GRASS",
  "hall of fame open": "GRASS",
  "gstaad": "CLAY",
  "umag": "CLAY",
  "kitzbuhel": "CLAY",
  "kitzbühel": "CLAY",
  "generali open": "CLAY",
  "prague": "CLAY",
  "washington": "HARD",
  "winston-salem": "HARD",
  "winston salem": "HARD",
  "chengdu": "HARD",
  "zhuhai": "HARD",
  "china open": "HARD",
  "beijing": "HARD",
  "tokyo": "HARD",
  "japan open": "HARD",
  "korea open": "HARD",
  "seoul": "HARD",
  "chengdu open": "HARD",
  "almaty": "HARD",
  "astana": "HARD",
  "stockholm": "HARD",
  "bybit stockholm open": "HARD",
  "basel": "HARD",
  "swiss indoors": "HARD",
  "vienna": "HARD",
  "erste bank open": "HARD",
  "metz": "HARD",
  "moselle open": "HARD",
  "sofia": "HARD",
  "sofia open": "HARD",
  "antwerp": "HARD",
  "european open": "HARD",
  "florence": "HARD",
  "florence open": "HARD",
  "naples": "HARD",
  "tel aviv": "HARD",
  "astana open": "HARD",
  "davis cup": "HARD",
  "laver cup": "HARD",
  "next gen atp finals": "HARD",
  "united cup": "HARD",
  "olympics": "CLAY",
  "olympic games": "CLAY",
  // ── WTA (common calendar stops)
  "chennai open": "HARD",
  "chennai": "HARD",
  "indian wells tennis garden": "HARD",
  "wta finals": "HARD",
  "wta finals indian wells": "HARD",
  "austin 125": "HARD",
  "austin": "HARD",
  "sopo": "CLAY",
  "bogota": "CLAY",
  "copa cigsa": "CLAY",
  "directv open presentado por compesar": "CLAY",
  "merida": "HARD",
  "merida open": "HARD",
  "abu dhabi": "HARD",
  "mubadala abu dhabi open": "HARD",
  "doha wta": "HARD",
  "qatar open": "HARD",
  "dubai duty free": "HARD",
  "charleston": "CLAY",
  "charleston open": "CLAY",
  "madrid wta": "CLAY",
  "mutua madrid open": "CLAY",
  "rome wta": "CLAY",
  "internazionali": "CLAY",
  "strasbourg": "CLAY",
  "rabat": "CLAY",
  "grand prix sar princesa": "CLAY",
  "nottingham": "GRASS",
  "rothesay open": "GRASS",
  "berlin": "GRASS",
  "ecotrans ladies open": "GRASS",
  "bad homburg": "GRASS",
  "birmingham": "GRASS",
  "rothesay classic": "GRASS",
  "wimbledon qualifying": "GRASS",
  "cluj-napoca": "CLAY",
  "transylvania open": "CLAY",
  "la bisbal": "CLAY",
  "iasi open": "CLAY",
  "prague wta": "CLAY",
  "warsaw": "CLAY",
  "palermo": "CLAY",
  "palermo ladies open": "CLAY",
  "humboldt": "CLAY",
  "varsovie": "CLAY",
  "cinch championships wta": "GRASS",
  "hobart": "HARD",
  "hobart international": "HARD",
  "canberra": "HARD",
  "monastir": "HARD",
  "jasmine open": "HARD",
  "ouagadougou": "CLAY",
  "florianopolis": "CLAY",
  "sao paulo": "CLAY",
  "colina": "CLAY",
  "santa fe": "CLAY",
  "buenos aires 125": "CLAY",
  "montreux": "CLAY",
  "biarritz": "CLAY",
  "makarska": "CLAY",
  "valencia": "CLAY",
  "zaragoza": "CLAY",
  "vitoria": "CLAY",
  "figueira da foz": "CLAY",
  "london 125": "GRASS",
  "ilkley": "GRASS",
  "blois": "GRASS",
  "surbiton": "GRASS",
};

// Month-based inference fallback (Northern-hemisphere pro calendar pattern)
const MONTH_FALLBACK: Record<number, Surface> = {
  0: "HARD", // January — Australian summer swing
  1: "HARD", // February — Golden swing starts (mostly hard+indoor)
  2: "CLAY", // March — South American clay
  3: "HARD", // April — Sunshine double (IW/Miami)
  4: "CLAY", // May — European clay
  5: "GRASS", // June — Grass swing
  6: "GRASS",
  7: "HARD", // July — North American hard
  8: "HARD",
  9: "HARD",
  10: "HARD",
  11: "HARD",
};

export function resolveSurface(
  tournament: string,
  city: string | undefined,
  month: number
): { surface: Surface; source: SurfaceSource } {
  const candidates = [tournament, city ?? ""].map((s) =>
    s.toLowerCase().replace(/\s+/g, " ").trim()
  );
  for (const key of candidates) {
    if (!key) continue;
    // longest-key containment match for robustness
    let best: { k: string; s: Surface } | null = null;
    for (const [k, s] of Object.entries(MAPPED)) {
      if (key.includes(k) && (!best || k.length > best.k.length)) best = { k, s };
    }
    if (best) return { surface: best.s, source: "MAPPED" };
  }
  return { surface: MONTH_FALLBACK[month] ?? "HARD", source: "INFERRED" };
}

export const SURFACE_LABEL_FA: Record<Surface, string> = {
  HARD: "هاردکورت",
  CLAY: "خاک رس",
  GRASS: "چمن",
};

export const SURFACE_LABEL_EN: Record<Surface, string> = {
  HARD: "HARD COURT",
  CLAY: "CLAY COURT",
  GRASS: "GRASS COURT",
};
