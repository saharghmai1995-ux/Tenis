// ─── NeoTennis Markov Quant v2.0 — Deduplication Guard ─────────────────────
// Bug fix from the v1.0 audit: matches appearing twice in the shadow ledger
// and pick lists. Every list is unified by identity key with the canonical
// Map-based dedupe (latest-wins not needed — first-wins keeps order stable).

/**
 * Canonical dedupe used on every stored/rendered list:
 * Array.from(new Map(items.map(item => [item.id, item])).values())
 */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

/** Keyed variant for entities whose identity lives in another field. */
export function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  return Array.from(new Map(items.map((item) => [keyOf(item), item])).values());
}

/** Stable match content key — kills ESPN double-listings with different comp ids. */
export function matchContentKey(parts: {
  tour: string;
  dateKey: string;
  tournament: string;
  round: string;
  playerA: string;
  playerB: string;
}): string {
  return [parts.tour, parts.dateKey, parts.tournament, parts.round, parts.playerA, parts.playerB]
    .join("~")
    .toLowerCase();
}
