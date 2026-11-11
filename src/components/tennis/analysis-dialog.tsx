"use client";

import {
  ArrowLeftRight,
  BrainCircuit,
  Lock,
  Microscope,
  Sigma,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HawkEyeCourt } from "@/components/tennis/hawk-eye-court";
import { MarkovFlow } from "@/components/tennis/markov-flow";
import type { AnalyzedMatch } from "@/lib/tennis/types";

function Bar({ label, value, tone = "bg-amber-300" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${tone} transition-all duration-700`}
          style={{ width: `${Math.min(100, Math.max(2, value * 100))}%` }}
        />
      </div>
      <span className="mono-num w-12 text-left" dir="ltr">
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  );
}

const ARCH_STYLE: Record<string, string> = {
  ARCH1: "border-amber-300/40 bg-amber-300/10 text-amber-300",
  ARCH2: "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300",
  ARCH3: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

export function AnalysisDialog({
  match,
  open,
  onOpenChange,
}: {
  match: AnalyzedMatch | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!match) return null;
  const m = match;
  const fav = m.favorite;
  const favName = fav === "A" ? m.playerA.name : m.playerB.name;
  const dogName = fav === "A" ? m.playerB.name : m.playerA.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // v3.0 bug fix — the modal must never close on inner scroll/click and
        // the page behind must not scroll: overscroll-contain + stopPropagation
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="scroll-slim max-h-[85vh] max-w-2xl overscroll-contain overflow-y-auto border-white/10 bg-[oklch(0.16_0.01_270)]"
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <BrainCircuit className="h-5 w-5 text-amber-300" />
            تحلیل موتور مارکوف — {m.playerA.name} × {m.playerB.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {m.tournament} · {m.round} · {m.tour} · سطح:{" "}
            {{ HARD: "هاردکورت", CLAY: "خاک رس", GRASS: "چمن" }[m.surface]}
            {m.surfaceSrc === "INFERRED" && " (استنتاج تقویمی)"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* v3.0 · 3D Hawk-Eye isometric court telemetry */}
          <HawkEyeCourt match={m} compact />

          {/* v3.0 · animated 4-layer Markov decision tree */}
          <MarkovFlow match={m} />

          {/* Layer 1 */}
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <h4 className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-amber-300">
              <Sigma className="h-3.5 w-3.5" />
              لایه ۱ — احتمال برد امتیاز روی سرویس و Hold (کالیبره
              <span dir="ltr" className="inline-block font-mono mx-1">
                Kovalchik 2016 - ATP/WTA
              </span>
              )
            </h4>
            <div className="mt-2.5 space-y-1.5">
              <Bar
                label={`Hold ${m.playerA.shortName}`}
                value={m.markov.gA}
                tone={fav === "A" ? "bg-amber-300" : "bg-white/40"}
              />
              <Bar
                label={`Hold ${m.playerB.shortName}`}
                value={m.markov.gB}
                tone={fav === "B" ? "bg-amber-300" : "bg-white/40"}
              />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
              <div className="rounded-lg bg-white/5 p-2 text-center">
                <div className="text-white">
                  <span className="num-capsule text-[10px]">p={m.reverse.pFinalA.toFixed(3)}</span>
                </div>
                <div>سرویس {m.playerA.shortName}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2 text-center">
                <div className="text-white">
                  <span className="num-capsule text-[10px]">p={m.reverse.pFinalB.toFixed(3)}</span>
                </div>
                <div>سرویس {m.playerB.shortName}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2 text-center">
                <div className="text-white">
                  <span className="num-capsule text-[10px]">S={m.markov.setWinA.toFixed(3)}</span>
                </div>
                <div>برد ست {m.playerA.shortName}</div>
              </div>
            </div>
          </section>

          {/* Layer 2/3 */}
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <h4 className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <TrendingUp className="h-3.5 w-3.5" />
              لایه ۲ و ۳ — ماتریس ست/تای‌بریک و ۴ نتیجه Bo3
            </h4>
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
              {[
                { k: "2-0", v: m.markov.p20, fav: fav === "A" },
                { k: "2-1", v: m.markov.p21, fav: fav === "A" },
                { k: "1-2", v: m.markov.p12, fav: fav === "B" },
                { k: "0-2", v: m.markov.p02, fav: fav === "B" },
              ].map((o) => (
                <div
                  key={o.k}
                  className={`rounded-lg border p-2 text-center ${
                    o.fav ? "border-amber-300/30 bg-amber-300/10" : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="mono-num text-base font-extrabold" dir="ltr">
                    {(o.v * 100).toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    <span className="mono-num">{o.k}</span> {o.fav ? "★ فاوریت" : ""}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <span>
                Over <span className="num-capsule text-[10px]">9.5</span> گیم ست:{" "}
                <span className="num-capsule text-[10px]">{(m.markov.ou95 * 100).toFixed(0)}%</span>
              </span>
              <span>
                Over <span className="num-capsule text-[10px]">21.5</span> گیم مسابقه:{" "}
                <span className="num-capsule text-[10px]">{(m.markov.ou215 * 100).toFixed(0)}%</span>
              </span>
              <span>
                تای‌بریک ست اول: <span className="num-capsule text-[10px]">{(m.markov.tb1 * 100).toFixed(0)}%</span>
              </span>
            </div>
          </section>

          {/* Reverse solver + fusion + calibration */}
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <h4 className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <Microscope className="h-3.5 w-3.5" />
              مهندسی معکوس ضرایب و بلند ۶۵٪ بازار + ۳۵٪ Elo سطح زمین
            </h4>
            {m.reverse.marketGap ? (
              <p className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2 text-[11px] leading-5 text-muted-foreground">
                <ArrowLeftRight className="inline h-3 w-3" /> فید بازار آزاد برای این مسابقه یافت نشد
                (<span dir="ltr" className="inline-block font-mono mx-1">Polymarket</span> فاقد مارکت این مچ) — تحلیل صرفاً بر پایه Elo سطح زمین از نقاط رنکینگ رسمی.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                <span>
                  احتمال بازار A ={" "}
                  <span className="num-capsule text-[10px]">
                    {((m.reverse.marketProbA ?? 0) * 100).toFixed(1)}% (@
                    {m.reverse.marketOddsA?.toFixed(2)})
                  </span>
                </span>
                <span>حذف حاشیه: {m.reverse.method === "shin" ? "مدل Shin" : "روش توانی"}</span>
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
              <div className="rounded-lg bg-white/5 p-2">
                <div className="num-capsule text-[10px] text-white">{m.reverse.pRawA.toFixed(3)}</div>
                <div className="mt-1 text-muted-foreground">خام سرویس A</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2">
                <div className="num-capsule text-[10px] text-white">{m.reverse.pRawB.toFixed(3)}</div>
                <div className="mt-1 text-muted-foreground">خام سرویس B</div>
              </div>
              <div className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-2">
                <div className="num-capsule text-[10px] text-amber-300">{m.reverse.pFinalA.toFixed(3)}</div>
                <div className="mt-1 text-muted-foreground">کالیبره سرویس A</div>
              </div>
              <div className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-2">
                <div className="num-capsule text-[10px] text-amber-300">{m.reverse.pFinalB.toFixed(3)}</div>
                <div className="mt-1 text-muted-foreground">کالیبره سرویس B</div>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
              کالیبراسیون v3.0 — پایه تور{" "}
              <span dir="ltr" className="inline-block font-mono mx-1">
                ATP/WTA
              </span>{" "}
              (
              <span dir="ltr" className="inline-block font-mono mx-1">
                ATP 0.64/0.61/0.67 · WTA ≈ 0.58 — Kovalchik 2016
              </span>
              ) با بست فیزیکی هر طرف؛ فاوریت شفاف در بازه{" "}
              <span className="num-capsule text-[10px]">0.65–0.72</span> و حریف در{" "}
              <span className="num-capsule text-[10px]">0.56–0.63</span> می‌نشیند
              (<span dir="ltr" className="inline-block font-mono mx-1">
                Kovalchik 2016 - ATP/WTA
              </span>
              ).
            </p>
          </section>

          {/* 3-archetype supervisor report */}
          <section
            className={`rounded-xl border p-3.5 ${
              m.veto.vetoed
                ? "border-rose-400/30 bg-rose-400/[0.06]"
                : m.dualEligible
                  ? "border-emerald-400/30 bg-emerald-400/[0.06]"
                  : "border-amber-300/25 bg-amber-300/[0.05]"
            }`}
          >
            <h4 className="flex items-center gap-2 text-xs font-bold">
              <Lock className="h-3.5 w-3.5" />
              دروازه سوپروایزر — ارزیابی ۳ الگوی متعامد + سهمیه ۶۵٪
            </h4>

            {(m.archEvals ?? []).length > 0 && (
              <div className="mt-2.5 grid gap-1.5">
                {(m.archEvals ?? []).map((e) => (
                  <div
                    key={e.code}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                      m.archetype?.code === e.code
                        ? ARCH_STYLE[e.code]
                        : "border-white/10 bg-white/[0.03] text-muted-foreground"
                    }`}
                  >
                    <span className="font-bold">
                      {m.archetype?.code === e.code ? "👑 " : ""}
                      {e.labelFa}
                    </span>
                    <span className="flex items-center gap-2 text-[10px]">
                      <span className="mono-num" dir="ltr">
                        پوشش {(e.coverage * 100).toFixed(1)}%
                      </span>
                      {e.eligible ? (
                        <span className="text-emerald-300">✓ واجد شرایط</span>
                      ) : (
                        <span className="text-rose-300/90">✗ {e.whyNot}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {m.veto.vetoed ? (
              <p className="mt-2 text-[12px] leading-6 text-rose-200">🛡️ {m.veto.reason}</p>
            ) : m.dualEligible ? (
              <div className="mt-2 space-y-2">
                <p className="text-[12px] text-emerald-200">
                  ✅ مسابقه تایید شد — <span className="font-bold">{m.archetype?.labelFa}</span>
                  {m.archetype?.adaptive && (
                    <span className="ms-1 text-[10px] text-amber-200">(تایید سازگار سهمیه ۶۵٪)</span>
                  )}{" "}
                  برای {favName} انتخاب شد: ریسک باخت همزمان{" "}
                  <span className="num-capsule text-[10px]">
                    {((m.archetype?.pairLoss ?? 0) * 100).toFixed(1)}%
                  </span>{" "}
                  {m.archetype?.adaptive ? "کم‌ریسک‌ترین الگوی موجود" : "زیر سقف 9.5%"}.
                </p>
                {m.slips.A && (
                  <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold">🔵 تیپ A — {m.slips.A.text}</span>
                      <span className="num-capsule text-[10px]">@{m.slips.A.odds.toFixed(2)}</span>
                    </div>
                  </div>
                )}
                {m.slips.B && (
                  <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold">🟢 تیپ B مکمل — {m.slips.B.text}</span>
                      <span className="num-capsule text-[10px]">@{m.slips.B.odds.toFixed(2)}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      پوشش متعامد الگو — تنها فضای باختِ همزمان{" "}
                      <span className="num-capsule text-[10px]">
                        {((m.archetype?.pairLoss ?? 0) * 100).toFixed(1)}%
                      </span>{" "}
                      است که سوپروایزر قفل کرده.
                    </p>
                  </div>
                )}
                {m.hashPre && (
                  <p className="mono-num text-[10px] text-cyan-300" dir="ltr">
                    SHA-256 LOCK: {m.hashPre.slice(0, 16)}…
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[12px] leading-6 text-amber-200">
                از فیلتر تاپ-۱۰۰ عبور کرد اما هیچ الگویی ریسک را زیر سقف نمی‌بندد — مسابقه تحت نظارت است.
              </p>
            )}
            <div className="mt-2 text-[10px] text-muted-foreground">
              زمان‌بندی: {m.timing.label}
            </div>
          </section>

          {/* Model odds from market */}
          {m.market && (
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-[11px] text-muted-foreground">
              <span className="font-bold text-white/80">فید بازار آزاد:</span>{" "}
              <span className="num-capsule text-[10px]">
                Polymarket — {m.market.playerA} @{m.market.oddsA.toFixed(2)} / {m.market.playerB} @
                {m.market.oddsB.toFixed(2)}
              </span>
            </section>
          )}

          <div className="flex flex-wrap gap-2 pb-1">
            <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-muted-foreground">
              رنک رسمی:{" "}
              <span className="mono-num" dir="ltr">
                {m.playerA.rank ? `#${m.playerA.rank}` : "—"} / {m.playerB.rank ? `#${m.playerB.rank}` : "—"}
              </span>
            </Badge>
            {m.playerA.seed && (
              <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-muted-foreground">
                سید {m.playerA.name}: <span className="mono-num">{m.playerA.seed}</span>
              </Badge>
            )}
            {m.playerB.seed && (
              <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-muted-foreground">
                سید {m.playerB.name}: <span className="mono-num">{m.playerB.seed}</span>
              </Badge>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
