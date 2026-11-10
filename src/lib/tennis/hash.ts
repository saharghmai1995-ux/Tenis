// ─── NeoTennis Markov Quant — SHA-256 Ledger Hash ──────────────────────────
import { createHash } from "crypto";

/**
 * Canonical pre-match lock hash. Computed once when slips are generated,
 * stored in the ledger, and re-verified at settlement time.
 */
export function canonicalMatchString(parts: {
  dateKey: string;
  tour: string;
  tournament: string;
  surface: string;
  round: string;
  playerA: string;
  playerB: string;
  slipAText?: string;
  slipAOdds?: number;
  slipBText?: string;
  slipBOdds?: number;
}): string {
  return [
    parts.dateKey,
    parts.tour,
    parts.tournament,
    parts.surface,
    parts.round,
    parts.playerA,
    parts.playerB,
    parts.slipAText ?? "-",
    parts.slipAOdds?.toFixed(3) ?? "-",
    parts.slipBText ?? "-",
    parts.slipBOdds?.toFixed(3) ?? "-",
  ].join("|");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function shortHash(input: string, len = 10): string {
  return sha256(input).slice(0, len).toUpperCase();
}
