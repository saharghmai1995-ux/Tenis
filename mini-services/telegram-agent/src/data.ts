// ─── Telegram Supervisor Agent — DataHub (always-warm engine feed) ─────────
// Keeps the main NeoTennis engine HOT by periodically calling the main app's
// /api/tennis/feed (server-to-server, never browser-dependent). Keeps a last-
// good snapshot in the agent store for graceful degradation when the main app
// restarts. Optionally reads the tennis SQLite DB as a last-resort source.

import { Database } from "bun:sqlite";

import { CONFIG } from "./config";
import { store } from "./store";
import type { FeedPayload, AnalyzedMatch } from "./tennis-types";

export interface CardSlip {
  key: string;
  marketEn: string;
  detail: string;
  odds: number;
  prob?: number;
  /** recommended stake in units (staking ladder) */
  stake: number;
  /** model EV edge = prob*odds-1 (negative when no value) */
  edge: number;
}

export interface CardMatch {
  eventKey: string;
  playerA: string;
  playerB: string;
  shortA?: string;
  shortB?: string;
  rankA?: number;
  rankB?: number;
  /** 2-3 letter country code extracted from the ESPN flag URL (poster-safe Latin) */
  flagA?: string;
  flagB?: string;
  /** tournament seed, drawn as S{n} chip next to the rank chip */
  seedA?: number;
  seedB?: number;
  // ── v10 · per-player DEDICATED telemetry (anti-fixed-numbers law) ──────
  holdA?: number; // service game-hold % of player A (this match's model)
  holdB?: number;
  bpsA?: number; // break-point saved % of player A
  bpsB?: number;
  markovPA?: number; // this match's own Markov serve points
  markovPB?: number;
  // ── v10 · positive-overlap golden gate verdict ──────────────────────
  pattern?: string; // P1 | P2 | P3
  overlapNetPct?: number; // guaranteed net return of every package win
  tour?: string;
  city?: string;
  tournament: string;
  round: string;
  surface: "HARD" | "CLAY" | "GRASS";
  state: "pre" | "in" | "post";
  startTime?: string;
  favorite: "A" | "B";
  favWinProb?: number;
  archCode?: string;
  archLabelEn?: string;
  coverage?: number;
  adaptive?: boolean;
  timingCode?: string;
  timingLabel?: string;
  slipA?: CardSlip;
  slipB?: CardSlip;
  hash?: string;
  vetoed?: boolean;
  vetoCode?: string;
  vetoReasonFa?: string;
}

// ─── 100-UNIT STAKE LAW (director rule, v5.5) ──────────────────────────────
// Every match rides ONE standard 100-unit budget. The per-tip stake is the
// equal-profit dutching split of that budget by the two official market
// prices — the EXACT same formula as the signal production lines
// (src/lib/tennis/supervisor.ts → dutchStakes). Card, caption and production
// line therefore always show identical amounts, and stakeA + stakeB = 100.
export const STANDARD_MATCH_STAKE = 100;

export function dutchStakesOf(
  oddsA: number | undefined,
  oddsB: number | undefined
): { stakeA: number; stakeB: number } {
  const invA = 1 / Math.max(oddsA ?? 2, 1.01);
  const invB = 1 / Math.max(oddsB ?? 2, 1.01);
  const stakeA = Math.round(((STANDARD_MATCH_STAKE * invA) / (invA + invB)) * 10) / 10;
  const stakeB = Math.round((STANDARD_MATCH_STAKE - stakeA) * 10) / 10;
  return { stakeA, stakeB };
}

export function stakeLabelEn(stake: number): string {
  return stake === Math.floor(stake) ? `${stake}U` : `${stake.toFixed(1)}U`;
}

// complete English descriptions per atomic leg — posters are 100% English
export const LEG_DETAIL_EN: Record<string, string> = {
  "SB-F20": "FAVORITE TO WIN THE MATCH BY EXACTLY 2 SETS TO 0. SINGLE-BOOKMAKER BUTTON IN THE SET BETTING GRID. VOID IF RETIRED.",
  "TS-O25": "MATCH TOTAL SETS TO FINISH OVER 2.5 - THE MATCH MUST REACH A DECIDING THIRD SET. TIE-BREAK SETS COUNT NORMALLY.",
  "SB-P1-20": "PLAYER 1 TO WIN THE MATCH 2-0 IN THE SET BETTING GRID - THE FAST WIN PATH OF PLAYER 1.",
  "SB-P1-21": "PLAYER 1 TO WIN THE MATCH 2-1 IN THE SET BETTING GRID - THE DECIDER WIN PATH. BOTH LEGS COVER ALL PLAYER-1 WIN ROUTES.",
  "TG-O225": "MATCH TOTAL GAMES TO FINISH OVER 22.5 - TIE-BREAKS COUNT TOWARD THE TOTAL. PAYS WHEN THE MATCH GOES LONG.",
  "GH-F45": "FAVORITE TO COVER A GAME HANDICAP OF -4.5 - NEEDS A 5+ GAME MARGIN (E.G. 6-2 6-3).",
};

const VETO_EN: Record<string, string> = {
  TOP100: "OUTSIDE TOP-100 DOMAIN",
  P02_RISK: "NO ELIGIBLE ARCHETYPE",
  NONE: "CLEAR",
};

function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return (parts[parts.length - 1] || full).toUpperCase();
}

/** ESPN flag URL → 2-3 letter country code (e.g. .../countries/40x28/ir.png → IR) */
function countryCodeOf(flagUrl?: string): string | undefined {
  const m = flagUrl?.match(/\/([a-z]{2,3})\.png/i);
  return m ? m[1].toUpperCase() : undefined;
}

export function matchToCard(m: AnalyzedMatch): CardMatch {
  const favName =
    (m.favorite === "A" ? m.playerA.name : m.playerB.name).toUpperCase();
  // 100-unit stake law: dutch the standard budget across BOTH wings with the
  // production-line formula so card/caption amounts match the signal lines.
  const dutched = dutchStakesOf(m.slips.A?.odds, m.slips.B?.odds);
  const mkSlip = (
    s?: AnalyzedMatch["slips"]["A"],
    wing: "A" | "B" = "A"
  ): CardSlip | undefined => {
    if (!s) return undefined;
    const stake = wing === "A" ? dutched.stakeA : dutched.stakeB;
    const edge = s.odds * (s.prob ?? 0) - 1;
    return {
      key: s.leg,
      marketEn: s.marketEn || s.textEn,
      detail:
        LEG_DETAIL_EN[s.leg]
          ?.replace("FAVORITE", favName)
          .replace("PLAYER 1", m.playerA.name.toUpperCase()) ?? s.textEn.toUpperCase(),
      odds: s.odds,
      prob: s.prob,
      stake,
      edge,
    };
  };
  return {
    eventKey: m.eventKey,
    playerA: m.playerA.name,
    playerB: m.playerB.name,
    shortA: m.playerA.shortName?.toUpperCase(),
    shortB: m.playerB.shortName?.toUpperCase(),
    rankA: m.playerA.rank,
    rankB: m.playerB.rank,
    flagA: countryCodeOf(m.playerA.flagUrl),
    flagB: countryCodeOf(m.playerB.flagUrl),
    seedA: m.playerA.seed,
    seedB: m.playerB.seed,
    // v10 — the two players' OWN telemetry (never a shared fixed number)
    holdA: m.markov?.gA,
    holdB: m.markov?.gB,
    bpsA: m.markov?.bpsA,
    bpsB: m.markov?.bpsB,
    markovPA: m.markov?.pA,
    markovPB: m.markov?.pB,
    pattern: (m as { regime?: { pattern?: string } }).regime?.pattern,
    overlapNetPct: (m as { regime?: { overlap?: { netReturnPct?: number } } }).regime?.overlap?.netReturnPct,
    tour: m.tour,
    city: m.city,
    tournament: m.tournament,
    round: m.round,
    surface: m.surface,
    state: m.state,
    startTime: m.startTime,
    favorite: m.favorite,
    favWinProb: m.favWinProb,
    archCode: m.archetype?.code,
    archLabelEn: m.archetype?.labelEn,
    coverage: m.archetype?.coverage,
    adaptive: m.archetype?.adaptive,
    timingCode: m.timing?.code,
    timingLabel: m.timing?.label,
    slipA: mkSlip(m.slips.A, "A"),
    slipB: mkSlip(m.slips.B, "B"),
    hash: m.hashPre?.slice(0, 10).toUpperCase(),
    vetoed: m.veto.vetoed,
    vetoCode: m.veto.code,
    vetoReasonFa: m.veto.reason,
  };
}

export interface LedgerStats {
  coreWinRate: number;
  certifiedWinRate?: number;
  certifiedDecided?: number;
  certifiedWon?: number;
  combinedWinRate: number;
  profit: number;
  picks: number;
  settled: number;
  streak: number;
  bank: number;
  roi: number;
}

export interface SettledRow {
  matchLabel: string;
  status: "WON" | "LOST" | "PENDING";
  profit: number;
  result?: string;
  settledAt?: string;
  archetypeEn?: string;
}

class DataHub {
  private feed: FeedPayload | null = null;
  private lastWarmAt: number = 0;
  private lastWarmOk = false;
  private warming: Promise<boolean> | null = null;

  get lastOk(): boolean {
    return this.lastWarmOk;
  }
  get lastAt(): string | undefined {
    return this.lastWarmAt ? new Date(this.lastWarmAt).toISOString() : undefined;
  }

  /** Pull the live engine feed (triggers scoreboard sync + settlement = engine stays hot). */
  async warm(force = false): Promise<boolean> {
    if (this.warming) return this.warming;
    this.warming = (async () => {
      try {
        const res = await fetch(`${CONFIG.mainAppUrl}/api/tennis/feed${force ? "?force=1" : ""}`, {
          signal: AbortSignal.timeout(90_000),
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
        const json = (await res.json()) as FeedPayload;
        if (!json.ok || !Array.isArray(json.matches)) throw new Error("feed payload invalid");
        this.feed = json;
        this.lastWarmOk = true;
        this.lastWarmAt = Date.now();
        store.kvSet("feedSnapshot", JSON.stringify({ at: this.lastWarmAt, feed: json }));
        return true;
      } catch (e) {
        this.lastWarmOk = false;
        this.lastWarmAt = Date.now();
        console.error(
          "[data] warm failed:",
          e instanceof Error ? e.message : e,
          "→ using snapshot fallback"
        );
        return false;
      } finally {
        setTimeout(() => (this.warming = null), 5_000);
      }
    })();
    return this.warming;
  }

  /** Fresh-enough feed or snapshot fallback; null when nothing has ever loaded. */
  getFeed(): FeedPayload | null {
    if (this.feed) return this.feed;
    const snap = store.kvGet("feedSnapshot");
    if (snap) {
      try {
        this.feed = (JSON.parse(snap) as { feed: FeedPayload }).feed;
        return this.feed;
      } catch {
        return null;
      }
    }
    return null;
  }

  cards(): CardMatch[] {
    const f = this.getFeed();
    if (!f) return [];
    return f.matches.map(matchToCard);
  }

  stats(): LedgerStats | null {
    const f = this.getFeed();
    if (!f) return null;
    const s = f.ledger.stats;
    return {
      coreWinRate: s.coreWinRate,
      certifiedWinRate: s.certifiedWinRate,
      certifiedDecided: s.certifiedDecided,
      certifiedWon: s.certifiedWon,
      combinedWinRate: s.combinedWinRate,
      profit: s.profit,
      picks: s.picks,
      settled: s.settled,
      streak: s.streak,
      bank: s.bank,
      roi: s.roi,
    };
  }

  quota(): { poolSize: number; approved: number; vetoed: number; adaptive: number } {
    const f = this.getFeed();
    const q = f?.settlementSummary?.quota;
    if (!q) return { poolSize: 0, approved: 0, vetoed: 0, adaptive: 0 };
    return {
      poolSize: q.poolSize,
      approved: q.approved,
      vetoed: q.poolSize - q.approved,
      adaptive: q.adaptive,
    };
  }

  /** Pre/in matches approved by the supervisor gate — the flashcard pool. */
  approvedPool(): CardMatch[] {
    return this.cards().filter(
      (c) => c.state !== "post" && !c.vetoed && c.slipA && c.slipB
    );
  }

  vetoedToday(): CardMatch[] {
    return this.cards().filter((c) => c.state !== "post" && c.vetoed);
  }

  /** Best free-card candidate: highest coverage among early pre-match games. */
  freeCardCandidate(): CardMatch | undefined {
    const pool = this.approvedPool();
    return [...pool].sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0))[0];
  }

  settledRows(limit = 10): SettledRow[] {
    const f = this.getFeed();
    if (!f) return [];
    return f.ledger.rows
      .filter((r) => r.status !== "PENDING")
      .slice(0, limit)
      .map((r) => ({
        matchLabel: r.matchLabel,
        status: r.status,
        profit: r.profit,
        result: r.result,
        settledAt: r.settledAt,
        archetypeEn: r.archetype?.labelEn,
      }));
  }

  /** Matches settled today (Tehran day) — FT results post. */
  settledToday(): SettledRow[] {
    const now = new Date(Date.now() + 210 * 60_000); // Tehran +03:30
    const today = now.toISOString().slice(0, 10);
    const f = this.getFeed();
    if (!f) return [];
    return f.ledger.rows
      .filter((r) => r.status !== "PENDING" && (r.settledAt ?? "").slice(0, 10) === today)
      .slice(0, 12)
      .map((r) => ({
        matchLabel: r.matchLabel,
        status: r.status,
        profit: r.profit,
        result: r.result,
        settledAt: r.settledAt,
        archetypeEn: r.archetype?.labelEn,
      }));
  }

  /** Last-resort source: read the tennis DB directly (read-only).
   *  v10.1 — busy_timeout: the main app's settlement transactions can hold
   *  the custom.db write-lock for seconds; without a busy timeout the
   *  read-only open threw «database is locked» and the warm cycle fell back
   *  to the snapshot. The read connection now waits up to 8s (and enables
   *  WAL-aware reading) instead of racing the writer. */
  dbFallbackCards(limit = 40): CardMatch[] {
    try {
      const db = new Database(CONFIG.tennisDbPath, { readonly: true });
      db.exec("PRAGMA busy_timeout = 8000;");
      const rows = db
        .query(
          `SELECT eventKey, playerA, playerB, rankA, rankB, tournament, round, surface,
                  status, startTime, favorite, vetoed, vetoReason, dualEligible,
                  slipAOdds, slipAProb, slipBOdds, slipBProb, hashPre
           FROM TennisMatch WHERE status != 'post' ORDER BY startTime ASC LIMIT ?`
        )
        .all(limit) as Array<Record<string, unknown>>;
      db.close();
      return rows.map((r) => this.dbRowToCard(r));
    } catch {
      return [];
    }
  }

  private dbRowToCard(r: Record<string, unknown>): CardMatch {
    const fav = (r.favorite as string) === "B" ? "B" : "A";
    const favName = String(fav === "A" ? r.playerA : r.playerB).toUpperCase();
    return {
      eventKey: String(r.eventKey),
      playerA: String(r.playerA),
      playerB: String(r.playerB),
      shortA: shortName(String(r.playerA)),
      shortB: shortName(String(r.playerB)),
      rankA: (r.rankA as number) ?? undefined,
      rankB: (r.rankB as number) ?? undefined,
      tournament: String(r.tournament),
      round: String(r.round),
      surface: (r.surface as CardMatch["surface"]) ?? "HARD",
      state: (r.status as CardMatch["state"]) ?? "pre",
      startTime: r.startTime as string | undefined,
      favorite: fav,
      timingLabel: "SUPERVISOR SYNC PENDING",
      vetoed: !!r.vetoed,
      vetoReasonFa: (r.vetoReason as string) ?? undefined,
      // 100-unit stake law — same dutching split as the live production lines
      slipA: r.slipAOdds
        ? (() => {
            const prob = (r.slipAProb as number) ?? undefined;
            const dutched = dutchStakesOf(Number(r.slipAOdds), r.slipBOdds ? Number(r.slipBOdds) : undefined);
            return {
              key: "PENDING-SYNC",
              marketEn: "OFFICIAL MARKET - SYNC PENDING",
              detail: LEG_DETAIL_EN["TG-O225"],
              odds: Number(r.slipAOdds),
              prob,
              stake: dutched.stakeA,
              edge: Number(r.slipAOdds) * (prob ?? 0) - 1,
            };
          })()
        : undefined,
      slipB: r.slipBOdds
        ? (() => {
            const prob = (r.slipBProb as number) ?? undefined;
            const dutched = dutchStakesOf(r.slipAOdds ? Number(r.slipAOdds) : undefined, Number(r.slipBOdds));
            return {
              key: "PENDING-SYNC",
              marketEn: "OFFICIAL MARKET - SYNC PENDING",
              detail: LEG_DETAIL_EN["GH-F45"].replace("FAVORITE", favName),
              odds: Number(r.slipBOdds),
              prob,
              stake: dutched.stakeB,
              edge: Number(r.slipBOdds) * (prob ?? 0) - 1,
            };
          })()
        : undefined,
      hash: (r.hashPre as string)?.slice(0, 10).toUpperCase(),
    };
  }
}

export const dataHub = new DataHub();
