import { NextResponse } from "next/server";
import { buildFeed } from "@/lib/tennis/engine";
import { TENNIS_OPTION_POOL, QQL_FAMILIES } from "@/lib/tennis/qql-rca-engine";
import type { FeedPayload } from "@/lib/tennis/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * v12 — 💻 the live data of the Tennis Data-Science Query Console
 * (QQL & RCA Explorer): the executed 45-pair ranking of every approved
 * match + the warehouse twin stats + the RCA rule evaluations.
 */
export async function GET() {
  try {
    const feed: FeedPayload = await buildFeed();

    const explored = feed.matches
      .filter((m) => m.regime?.qql?.ok && m.state !== "post")
      .map((m) => ({
        eventKey: m.eventKey,
        label: `${m.playerA.name} × ${m.playerB.name}`,
        tournament: m.tournament,
        surface: m.surface,
        tour: m.tour,
        state: m.state,
        favorite: m.favorite,
        rankA: m.playerA.rank,
        rankB: m.playerB.rank,
        holdA: m.markov.gA,
        holdB: m.markov.gB,
        rho: m.copula?.rhoSetCoupling ?? 0,
        regime: m.regime?.code,
        pairCode: m.regime.qql!.pairCode,
        family: m.regime.qql!.family,
        familyLabelFa: QQL_FAMILIES[m.regime.qql!.family].labelFa,
        oddsA: m.regime.qql!.oddsA,
        oddsB: m.regime.qql!.oddsB,
        stakeA: m.regime.qql!.stakeA,
        stakeB: m.regime.qql!.stakeB,
        unionProb: m.regime.qql!.unionProb,
        doubleWinProb: m.regime.qql!.doubleWinProb,
        verifiedWinRate: m.regime.qql!.verifiedWinRate,
        twinCount: m.regime.qql!.twinCount,
        evaluated: m.regime.qql!.evaluated,
        gatePassedCount: m.regime.qql!.gatePassedCount,
        traceFa: m.regime.qql!.traceFa,
        queryFa: m.regime.qql!.queryFa,
        rca: m.regime.qql!.rca,
        topCandidates: m.regime.qql!.topCandidates,
      }));

    return NextResponse.json({
      ok: true,
      generatedAt: feed.generatedAt,
      options: TENNIS_OPTION_POOL,
      families: Object.entries(QQL_FAMILIES).map(([code, v]) => ({ code, ...v })),
      matches: explored,
      vetoed: feed.matches
        .filter((m) => m.veto.vetoed && m.state !== "post")
        .map((m) => ({
          label: `${m.playerA.name} × ${m.playerB.name}`,
          surface: m.surface,
          code: m.veto.code,
          reason: m.veto.reason,
        })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
