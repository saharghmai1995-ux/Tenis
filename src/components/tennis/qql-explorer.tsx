"use client";

// ─── v12 · 💻 کنسول پرس‌وجوی علوم داده تنیس (QQL & RCA Explorer) ──────────────
// The interactive analytics console of the In-Memory QQL Query Core:
//   · the 10-option ATP/WTA pool + the 45-pair ranking of every approved match
//   · the executed QQL pipeline + the AI causal RCA rule evaluations
//   · the vetoed matches of the shadow ledger
// Data source: /api/tennis/qql (single source: the live buildFeed payload).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Braces, ChevronDown, Database, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { QqlPairCandidate, QqlOptionSpec, RcaRuleHit } from "@/lib/tennis/types";

interface ExploredMatch {
  eventKey: string;
  label: string;
  tournament: string;
  surface: string;
  tour: string;
  state: string;
  favorite: "A" | "B";
  rankA?: number;
  rankB?: number;
  holdA: number;
  holdB: number;
  rho: number;
  regime?: string;
  pairCode: string;
  family: string;
  familyLabelFa: string;
  oddsA: number;
  oddsB: number;
  stakeA: number;
  stakeB: number;
  unionProb: number;
  doubleWinProb: number;
  verifiedWinRate: number;
  twinCount: number;
  evaluated: number;
  gatePassedCount: number;
  traceFa: string;
  queryFa: string;
  rca: RcaRuleHit[];
  topCandidates: QqlPairCandidate[];
}

interface ExplorerPayload {
  ok: boolean;
  generatedAt: string;
  options: QqlOptionSpec[];
  families: { code: string; labelFa: string; labelEn: string }[];
  matches: ExploredMatch[];
  vetoed: { label: string; surface: string; code?: string; reason?: string }[];
}

const FAMILY_TONE: Record<string, string> = {
  F1: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  F2: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  F3: "border-orange-400/40 bg-orange-400/10 text-orange-200",
  F4: "border-violet-400/40 bg-violet-400/10 text-violet-200",
  F5: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
  F6: "border-lime-400/40 bg-lime-400/10 text-lime-200",
};

export function QqlExplorer() {
  const [data, setData] = useState<ExplorerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/tennis/qql", { cache: "no-store" });
      const json = (await res.json()) as ExplorerPayload;
      if (!json.ok) throw new Error("qql api not ok");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "qql unreachable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  const match = useMemo(
    () => data?.matches.find((m) => m.eventKey === selected) ?? data?.matches[0],
    [data, selected]
  );

  return (
    <Card className="spatial-card rise-in rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Braces className="h-4 w-4 text-cyan-300" />
            کنسول پرس‌وجوی علوم داده تنیس (QQL &amp; RCA Explorer)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-white/15 text-[10px]" dir="ltr">
              <Database className="me-1 inline h-3 w-3 text-cyan-300" />
              In-Memory QQL · 45 pairs
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-white/15 bg-white/[0.04] text-xs hover:bg-white/10"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              اجرای مجدد کوئری
            </Button>
          </div>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          موتور زبان پرس‌وجوی تحلیلی درون‌حافظه‌ای روی انبار داده پیشینه مسابقات
          (tennis_historical_warehouse)، پایگاه قوانین ریشه‌یابی باخت‌ها (tennis_rca_rules) و
          ۴۵ ترکیب دوتایی از ۱۰ آپشن باز ATP/WTA (candidate_45_tennis_pairs) کوئری زنده اجرا می‌کند.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && !data && (
          <p className="rounded-lg border border-red-400/30 bg-red-400/[0.06] p-3 text-xs text-red-200">
            اتصال به کنسول برقرار نشد: {error}
          </p>
        )}

        {data && (
          <>
            {/* match selector chips */}
            <div className="scroll-slim flex max-w-full gap-1.5 overflow-x-auto pb-1">
              {data.matches.map((m) => (
                <button
                  key={m.eventKey}
                  onClick={() => setSelected(m.eventKey)}
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors",
                    match?.eventKey === m.eventKey
                      ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200"
                      : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
                  )}
                  aria-pressed={match?.eventKey === m.eventKey}
                >
                  <span className="mono-num" dir="ltr">
                    [{m.pairCode.replace("-", "↔")}]
                  </span>{" "}
                  {m.label}
                </button>
              ))}
              {data.matches.length === 0 && !loading && (
                <span className="text-[11px] text-muted-foreground">
                  فعلاً هیچ مسابقه تاییدشده QQL برای نمایش وجود ندارد.
                </span>
              )}
            </div>

            {match && (
              <div className="space-y-3">
                {/* the executed query summary */}
                <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.05] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn("border text-[10px] font-bold", FAMILY_TONE[match.family])}>
                      {match.familyLabelFa}
                    </Badge>
                    <span className="mono-num text-[10px] text-white/70" dir="ltr">
                      {match.tour} · {match.surface} · ranks{" "}
                      {match.rankA ?? "?"}/{match.rankB ?? "?"} · Hold{" "}
                      {(match.holdA * 100).toFixed(1)}/{(match.holdB * 100).toFixed(1)}% · ρ{" "}
                      {match.rho.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-2 text-[10.5px] leading-5 text-white/80">{match.queryFa}</p>
                  <p className="mt-1 text-[11px] font-bold text-cyan-200">{match.traceFa}</p>
                </div>

                {/* the 45-pair ranking table (top candidates) */}
                <div className="scroll-slim max-h-72 overflow-y-auto rounded-xl border border-white/5">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 z-10 bg-black/60 backdrop-blur">
                      <tr className="text-white/60">
                        <th className="px-3 py-2 text-start font-bold">جفت (pair_code)</th>
                        <th className="px-3 py-2 text-center font-bold">ضریب A/B</th>
                        <th className="px-3 py-2 text-center font-bold">استیک</th>
                        <th className="px-3 py-2 text-center font-bold">پوشش MC</th>
                        <th className="px-3 py-2 text-center font-bold">برد دوبل</th>
                        <th className="px-3 py-2 text-center font-bold">وین‌ریت تایم</th>
                        <th className="px-3 py-2 text-center font-bold">امتیاز QQL</th>
                        <th className="px-3 py-2 text-center font-bold">فیلتر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {match.topCandidates.map((c, i) => (
                        <tr
                          key={c.pairCode}
                          className={cn(
                            "border-t border-white/5 hover:bg-white/[0.03]",
                            i === 0 && "bg-emerald-400/[0.06]"
                          )}
                        >
                          <td className="mono-num px-3 py-1.5 font-bold text-white/85" dir="ltr">
                            {i === 0 && "🏆 "}
                            {c.pairCode.replace("-", " ↔ ")}
                          </td>
                          <td className="mono-num px-3 py-1.5 text-center text-white/75" dir="ltr">
                            {c.oddsA.toFixed(2)}/{c.oddsB.toFixed(2)}
                          </td>
                          <td className="mono-num px-3 py-1.5 text-center text-amber-200" dir="ltr">
                            {c.stakeA}+{c.stakeB}
                          </td>
                          <td className="mono-num px-3 py-1.5 text-center text-emerald-300" dir="ltr">
                            {(c.unionProb * 100).toFixed(1)}%
                          </td>
                          <td className="mono-num px-3 py-1.5 text-center text-cyan-300" dir="ltr">
                            {(c.doubleWinProb * 100).toFixed(1)}%
                          </td>
                          <td className="mono-num px-3 py-1.5 text-center text-white/75" dir="ltr">
                            {(c.verifiedWinRate * 100).toFixed(1)}%
                            {c.twinCount > 0 && (
                              <span className="ms-1 text-[9px] text-white/45">({c.twinCount})</span>
                            )}
                          </td>
                          <td className="mono-num px-3 py-1.5 text-center text-white/85" dir="ltr">
                            {c.score.toFixed(1)}
                          </td>
                          <td className="px-3 py-1.5 text-center text-[9.5px]">
                            {c.blockedByRca ? (
                              <span className="text-rose-300">RCA ✗</span>
                            ) : c.gatePassed ? (
                              <span className="text-emerald-300">PASS</span>
                            ) : (
                              <span className="text-white/45">gate ✗</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* RCA rule evaluations */}
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {match.rca.map((r) => (
                    <div
                      key={r.code}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5",
                        r.fired
                          ? "border-amber-300/30 bg-amber-300/[0.07]"
                          : "border-white/8 bg-white/[0.02]"
                      )}
                    >
                      <div className="mono-num text-[9px] font-bold" dir="ltr">
                        {r.code}
                        {r.fired && <span className="ms-1 text-emerald-300">FIRED</span>}
                      </div>
                      <p className="mt-0.5 text-[9.5px] leading-4 text-white/65">{r.noteFa}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* the shadow veto ledger */}
            {data.vetoed.length > 0 && (
              <details className="rounded-xl border border-white/10 bg-black/25 p-3">
                <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-white/80">
                  <ShieldAlert className="h-3.5 w-3.5 text-rose-300" />
                  دفتر سایه — وتوهای سوپروایزر (
                  <span className="mono-num" dir="ltr">{data.vetoed.length}</span> بازی)
                  <ChevronDown className="h-3 w-3" />
                </summary>
                <div className="mt-2 space-y-1">
                  {data.vetoed.map((v, i) => (
                    <p key={i} className="text-[10px] leading-4 text-white/60">
                      <span className="font-bold text-rose-300">{v.label}</span>
                      {v.code && <span className="mono-num ms-1" dir="ltr">[{v.code}]</span>}
                      {v.reason && <span className="ms-1">— {v.reason}</span>}
                    </p>
                  ))}
                </div>
              </details>
            )}

            <p className="text-[9.5px] text-muted-foreground">
              آخرین اجرا: <span className="mono-num" dir="ltr">{data.generatedAt.slice(11, 19)}</span> UTC —
              کنسول هر ۱۲۰ ثانیه به‌صورت خودکار کوئری را دوباره اجرا می‌کند؛ بدون نیاز به باز بودن مرورگر.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
