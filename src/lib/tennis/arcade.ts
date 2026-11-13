// ─── NeoTennis — 16-Bit Arcade poster request builder (client-safe) ────────
// Maps an AnalyzedMatch to the mini-service PosterRequest contract. The PNG
// itself is rendered server-side by the telegram-agent (browser-independent).

import type { AnalyzedMatch } from "./types";

export type ArcadePosterKind =
  | "FLASHCARD"
  | "FREECARD"
  | "BRIEFING"
  | "AGGREGATE"
  | "WEEKLY"
  | "NEWS"
  | "ACADEMY"
  | "BANNER"
  | "FTRESULTS";

export interface ArcadePosterRequest {
  kind: ArcadePosterKind;
  title: string;
  subtitle?: string;
  theme:
    | "HARD"
    | "CLAY"
    | "GRASS"
    | "FOOTBALL"
    | "ACADEMY"
    | "MARKETING"
    | "RESULTS";
  players?: {
    a: string;
    b: string;
    shortA?: string;
    shortB?: string;
    rankA?: number;
    rankB?: number;
  };
  tournament?: string;
  round?: string;
  surfaceLabel?: string;
  slips?: {
    key: string;
    label: string;
    marketEn: string;
    detail: string;
    odds: number;
    prob?: number;
    locked?: boolean;
  }[];
  stats?: { label: string; value: string; accent?: boolean }[];
  rows?: { label: string; value: string; status?: "WIN" | "LOSS" | "PENDING" | "VETO" | "INFO" }[];
  bullets?: string[];
  hash?: string;
  timeLabel?: string;
  footerNote?: string;
  stage?: string;
}

// complete English descriptions per atomic leg (mirrors the agent data module)
export const LEG_DETAIL_EN: Record<string, string> = {
  "SB-F20": "FAVORITE TO WIN THE MATCH BY EXACTLY 2 SETS TO 0. SINGLE-BOOKMAKER BUTTON IN THE SET BETTING GRID. VOID IF RETIRED.",
  "TS-O25": "MATCH TOTAL SETS TO FINISH OVER 2.5 - THE MATCH MUST REACH A DECIDING THIRD SET. TIE-BREAK SETS COUNT NORMALLY.",
  "SB-P1-20": "PLAYER 1 TO WIN THE MATCH 2-0 IN THE SET BETTING GRID - THE FAST WIN PATH OF PLAYER 1.",
  "SB-P1-21": "PLAYER 1 TO WIN THE MATCH 2-1 IN THE SET BETTING GRID - THE DECIDER WIN PATH. BOTH LEGS COVER ALL PLAYER-1 WIN ROUTES.",
  "TG-O225": "MATCH TOTAL GAMES TO FINISH OVER 22.5 - TIE-BREAKS COUNT TOWARD THE TOTAL. PAYS WHEN THE MATCH GOES LONG.",
  "GH-F45": "FAVORITE TO COVER A GAME HANDICAP OF -4.5 - NEEDS A 5+ GAME MARGIN (E.G. 6-2 6-3).",
};

const TIMING_EN: Record<string, string> = {
  T30: "T-30M PRE-WARMUP",
  INPLAY_BREAK: "IN-PLAY AFTER EARLY BREAK",
  INPLAY: "IN-PLAY LIVE",
  WAIT: "AWAITING T-30M WINDOW",
  DONE: "SETTLED",
};

/** Build the render request for the agent's 16-Bit engine. */
export function buildArcadeRequest(
  match: AnalyzedMatch,
  opts: { freeCard?: boolean } = {}
): ArcadePosterRequest {
  const favName = (match.favorite === "A" ? match.playerA.name : match.playerB.name).toUpperCase();
  const mkSlip = (
    slip: NonNullable<AnalyzedMatch["slips"]["A"]>,
    label: string,
    locked = false
  ): ArcadePosterRequest["slips"] extends (infer S)[] | undefined ? S : never => ({
    key: slip.leg,
    label,
    marketEn: locked ? "FULL MARKET HIDDEN" : slip.marketEn || slip.textEn,
    detail: locked
      ? "UNLOCK THE SECOND WING INSIDE THE VIP ARENA. FULL DUTCHING PLAN POSTED DAILY."
      : LEG_DETAIL_EN[slip.leg]?.replace("FAVORITE", favName).replace(
          "PLAYER 1",
          match.playerA.name.toUpperCase()
        ) ?? slip.textEn.toUpperCase(),
    odds: locked ? 0 : slip.odds,
    prob: slip.prob,
    locked,
  });

  return {
    kind: opts.freeCard ? "FREECARD" : "FLASHCARD",
    title: opts.freeCard ? "FREE CARD" : "MATCH OF THE DAY",
    subtitle: match.tournament,
    theme: match.surface,
    players: {
      a: match.playerA.name,
      b: match.playerB.name,
      shortA: match.playerA.shortName?.toUpperCase(),
      shortB: match.playerB.shortName?.toUpperCase(),
      rankA: match.playerA.rank,
      rankB: match.playerB.rank,
    },
    tournament: match.tournament,
    round: match.round,
    surfaceLabel: `${match.surface} COURT - ${match.favorite === "A" ? "FAV A" : "FAV B"}`,
    slips: [
      ...(match.slips.A ? [mkSlip(match.slips.A, "TYPE A")] : []),
      ...(match.slips.B ? [mkSlip(match.slips.B, "TYPE B", opts.freeCard)] : []),
    ],
    hash: match.hashPre?.slice(0, 10).toUpperCase(),
    timeLabel: TIMING_EN[match.timing?.code] ?? undefined,
    stage: `ST ${new Date().getUTCMonth() + 1}-${new Date().getUTCDate()}`,
    footerNote: opts.freeCard ? "FULL CARD IN VIP" : "VIP ONLY - NOT FOR RESHARE - 18+",
  };
}

/** Proxy the render to the always-warm agent service (same-origin relay). */
export async function renderArcadePoster(
  req: ArcadePosterRequest,
  signal?: AbortSignal
): Promise<{ pngBase64: string; width: number; height: number }> {
  const res = await fetch("/api/agent/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw new Error(`render failed (HTTP ${res.status})`);
  const body = (await res.json()) as {
    ok: boolean;
    pngBase64?: string;
    width?: number;
    height?: number;
    error?: string;
  };
  if (!body.ok || !body.pngBase64) throw new Error(body.error ?? "render failed");
  return {
    pngBase64: body.pngBase64,
    width: body.width ?? 1080,
    height: body.height ?? 1440,
  };
}
