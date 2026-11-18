"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Crown,
  Flame,
  Layers,
  Scale,
  ShieldOff,
  Timer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BankGrowthPro } from "@/components/tennis/bank-growth-pro";
import { GyroGauge } from "@/components/tennis/gyro-gauge";
import type { LedgerPayload, ProductionLine, QqlFamilyStat } from "@/lib/tennis/types";

// ─── v12 · the 6 QQL pattern families of the disjoint ledger ──────────────────
const FAMILY_TONE: Record<string, string> = {
  F1: "text-amber-300",
  F2: "text-emerald-300",
  F3: "text-orange-300",
  F4: "text-violet-300",
  F5: "text-cyan-300",
  F6: "text-lime-300",
};

function FamilyRow({ f }: { f: QqlFamilyStat }) {
  const decided = f.won + f.lost;
  const winRate = decided > 0 ? f.winRate : f.modelCoverage;
  const profitTone = f.profit > 0 ? "text-emerald-300" : f.profit < 0 ? "text-rose-300" : "text-white/60";
  // v12 — a family awaiting its first live position shows its architecture
  // baseline instead of a dead «0 (0) | +0.0» row (master-prompt v11 §3)
  const empty = f.picks === 0;
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className={`text-xs font-bold ${FAMILY_TONE[f.family] ?? "text-white"}`}>
        {f.labelFa}
      </TableCell>
      <TableCell className="mono-num text-xs" dir="ltr">
        {empty ? (
          <span className="text-white/55">پایگاه الگو</span>
        ) : (
          <>
            {f.picks}
            <span className="text-muted-foreground"> ({f.pending}⏳)</span>
          </>
        )}
      </TableCell>
      <TableCell className="mono-num text-xs" dir="ltr">
        {empty ? <span className="text-white/40">—</span> : `${f.won} / ${f.lost}`}
      </TableCell>
      <TableCell className="mono-num text-xs" dir="ltr">
        {`${(winRate * 100).toFixed(0)}%`}
        {decided === 0 && (
          <span className="ms-1 text-[9px] text-white/45">
            {empty ? "پوشش معماری" : "پایگاه الگو"}
          </span>
        )}
      </TableCell>
      <TableCell className={`mono-num text-xs ${profitTone}`} dir="ltr">
        {empty ? <span className="text-white/40">—</span> : `${f.profit >= 0 ? "+" : ""}${f.profit.toFixed(1)}`}
      </TableCell>
    </TableRow>
  );
}

const LINE_LABELS: Record<ProductionLine, string> = {
  DUAL: "زوج‌تیپ طلایی مکمل",
  BANKER: "بانکر امن سرویس",
  SINGLE: "تک‌گزینه عمیق مارکوف",
  REGCOMBO: "کمبوی کاپولا + پوشش",
  CLUSTER: "خوشه نتیجه دقیق",
  ACCUMULATOR: "آکومولاتور سلاطین سرویس",
  COMBO: "میکس سلاطین سرویس",
  SNIPER: "تک‌تیرانداز ضریب بالا",
  SHADOW: "دفتر سایه (وتوها)",
};

const LINE_COLORS: Record<ProductionLine, string> = {
  DUAL: "text-amber-300",
  BANKER: "text-emerald-300",
  SINGLE: "text-sky-300",
  REGCOMBO: "text-violet-300",
  CLUSTER: "text-orange-300",
  ACCUMULATOR: "text-lime-300",
  COMBO: "text-cyan-300",
  SNIPER: "text-rose-300",
  SHADOW: "text-muted-foreground",
};

export function CommandCenter({ ledger }: { ledger: LedgerPayload }) {
  const { stats, groups } = ledger;
  const streakUp = stats.streak > 0;
  const best = stats.bestWin;
  const dualGroup = groups.find((g) => g.line === "DUAL");
  const sniperGroup = groups.find((g) => g.line === "SNIPER");
  const sniperDecided = sniperGroup ? sniperGroup.picks - sniperGroup.pending : 0;

  const kpis = [
    {
      icon: Banknote,
      label: "بانک ۱۰۰۰ واحدی",
      // v3.0 — financial figures always ride mono tabular-nums capsules
      value: stats.bank.toLocaleString("en-US"),
      hint: `${stats.profit >= 0 ? "+" : ""}${stats.profit.toFixed(1)} واحد`,
      tone: stats.profit >= 0 ? "text-emerald-300" : "text-rose-300",
    },
    {
      icon: Scale,
      label: "بازده روی سرمایه",
      value: `${(stats.roi * 100).toFixed(1)}%`,
      hint: `${stats.settled} مسابقه/تیپ تسویه‌شده`,
      tone: stats.roi >= 0 ? "text-emerald-300" : "text-rose-300",
    },
    {
      icon: Flame,
      label: "رگبار فعلی",
      value: `${stats.streak}`,
      hint: streakUp ? "برد پیاپی آخرین تیپ‌ها" : "باخت پیاپی آخرین تیپ‌ها",
      tone: streakUp ? "text-amber-300" : "text-rose-300",
    },
    {
      icon: Layers,
      label: "کل پوزیشن‌های دفترکل",
      value: `${stats.picks}`,
      hint: `${groups.reduce((s, g) => s + g.pending, 0)} در انتظار نتیجه`,
      tone: "text-white",
    },
  ];

  return (
    <section aria-label="مرکز فرماندهی وین‌ریت" className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* v4.5 — 3D multi-ring gyroscope · CORE win rate only */}
        <Card className="spatial-card neon-conic rise-in rounded-2xl">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Flame className="h-4 w-4 text-amber-300" />
              گیج ژیروسکوپی وین‌ریت هسته اصلی
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <GyroGauge
              rate={stats.coreWinRate}
              dualRate={dualGroup ? dualGroup.winRate : 0}
              roiRate={Math.max(0, stats.roi)}
              sniperRate={sniperGroup && sniperDecided > 0 ? sniperGroup.winRate : undefined}
            />
            <p className="text-center text-[11px] leading-5 text-muted-foreground">
              وین‌ریت هسته اصلی = زوج‌تیپ طلایی مکمل + میکس‌های امن سلاطین سرویس —
              تک‌تیرانداز ضریب بالا <span className="font-bold text-rose-300">جدا محاسبه می‌شود</span>
            </p>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">
              وین‌ریت وزن‌دار سرمایه: {" "}
              <span className="mono-num text-amber-300" dir="ltr">
                {(stats.stakeWeightedWinRate * 100).toFixed(1)}%
              </span>{" "}
              · تسویه خودکار ۷ روزه ESPN · حسابداری در سطح مسابقه
            </p>
            {ledger.quota && ledger.quota.poolSize > 0 && (
              <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
                <span className="num-capsule text-[10px] text-amber-300">
                  {ledger.quota.approved}/{ledger.quota.poolSize}
                </span>
                تایید سوپروایزر (
                <span className="mono-num">{(ledger.quota.ratio * 100).toFixed(0)}%</span>
                {ledger.quota.adaptive > 0 && (
                  <>
                    {" "}· <span className="mono-num">{ledger.quota.adaptive}</span> سازگار
                  </>
                )}
                )
              </div>
            )}
          </CardContent>
        </Card>

        {/* v6.0 — professional bank-growth module (daily/weekly/monthly) */}
        <BankGrowthPro history={ledger.bankHistory} bankStart={stats.bankStart} bank={stats.bank} />
      </div>

      {/* disjoint ledger — v12: the 6 QQL pattern families + legacy line stats */}
      <Card className="spatial-card rise-in rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <ShieldOff className="h-4 w-4 text-amber-300" />
            دفترکل افرازی (Disjoint Ledger)
            <span className="text-[11px] font-normal text-muted-foreground">
              — ۶ خانواده الگوی کشف‌شده QQL در سطح مسابقه تسویه می‌شوند؛ وتوها فقط در دفتر سایه
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            {/* v12 — the SIX pattern-family rows (QQL discovery) */}
            <div className="scroll-slim max-h-64 overflow-y-auto rounded-xl border border-white/5">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">خانواده الگو (QQL)</TableHead>
                    <TableHead className="text-xs">پوزیشن</TableHead>
                    <TableHead className="text-xs">برد / باخت</TableHead>
                    <TableHead className="text-xs">وین‌ریت</TableHead>
                    <TableHead className="text-xs">سود</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ledger.families ?? []).map((f) => (
                    <FamilyRow key={f.family} f={f} />
                  ))}
                  {(ledger.families ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                        در انتظار اولین پوزیشن QQL…
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* legacy disjoint line stats (compact chips) */}
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <Badge
                  key={g.line}
                  variant="outline"
                  className="border-white/10 bg-white/[0.03] text-[9.5px] font-normal text-white/70"
                >
                  <span className={`font-bold ${LINE_COLORS[g.line]}`}>{LINE_LABELS[g.line]}</span>
                  <span className="mono-num" dir="ltr">
                    {g.picks} ({g.pending}⏳) · {g.won}/{g.lost} · {g.profit >= 0 ? "+" : ""}{g.profit.toFixed(1)}
                  </span>
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <Timer className="h-3.5 w-3.5" />
                نشانگر بهترین زمان ثبت ضریب
              </div>
              <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                  <span className="mono-num">T-30m Pre-Warmup</span> — پنجره طلایی پیش از گرم‌شدن
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  <span className="mono-num">In-Play After Early Break</span> — پس از بریک زودهنگام
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                  خارج از پنجره — صبر و نظارت
                </li>
              </ul>
            </div>
            {best && (
              <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                  <Crown className="h-3.5 w-3.5" />
                  بهترین برد دفترکل (سطح مسابقه)
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                  {best.matchLabel} — <span className="num-capsule text-[10px]">@{best.legs[0]?.odds.toFixed(2)}</span>{" "}
                  ({LINE_LABELS[best.line]})
                </p>
                <p className="mt-1 flex items-center gap-1 text-sm font-bold" dir="ltr">
                  {best.profit > 0 ? (
                    <ArrowUpRight className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4 text-rose-300" />
                  )}
                  <span className={`mono-num ${best.profit > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {best.profit > 0 ? "+" : ""}
                    {best.profit.toFixed(1)}
                  </span>
                  <span className="font-sans text-muted-foreground" dir="rtl">واحد</span>
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
