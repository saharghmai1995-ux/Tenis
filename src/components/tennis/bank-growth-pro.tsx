"use client";

// ─── v7.0 · Professional Bank-Growth Module (director upgrade request) ──────
// Full analytics suite:
//   • روزانه / هفتگی / ماهانه period selector (Tehran days, Iranian weeks, months)
//   • per-period P&L bar chart + cumulative bank line (dual-axis SVG)
//   • تعداد بازی‌های روزانه (daily match counts), برد/باخت split, per-period win rate
//   • KPI row: today's matches · today's W/L · period P&L · ROI · best/worst
//     period · all-time peak · max drawdown (units + %)
//   • scrollable period ledger table with per-period staked units + ROI

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Crown,
  Percent,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BankHistory, BankPeriodBucket } from "@/lib/tennis/types";

type Range = "daily" | "weekly" | "monthly";

const RANGE_LABEL: Record<Range, string> = {
  daily: "روزانه",
  weekly: "هفتگی",
  monthly: "ماهانه",
};

const W = 640;
const H = 210;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 26;

function Chart({ buckets, bankStart }: { buckets: BankPeriodBucket[]; bankStart: number }) {
  const view = useMemo(() => {
    if (buckets.length === 0) return null;
    const banks = [bankStart, ...buckets.map((b) => b.bankEnd)];
    const pnls = buckets.map((b) => b.pnl);
    const lo = Math.min(...banks, ...pnls, 0) * 0.995;
    const hi = Math.max(...banks, ...pnls, 1) * 1.005;
    const span = hi - lo || 1;
    const y = (v: number) => PAD_T + ((hi - v) / span) * (H - PAD_T - PAD_B);
    const n = buckets.length;
    const slot = (W - PAD_L - PAD_R) / Math.max(n, 1);
    const barW = Math.max(3, Math.min(26, slot * 0.52));
    const cx = (i: number) => PAD_L + slot * i + slot / 2;

    // cumulative bank line (start → each bucket's bankEnd)
    const pts = [`${PAD_L + slot / 2},${y(bankStart)}`];
    buckets.forEach((b, i) => pts.push(`${cx(i)},${y(b.bankEnd)}`));

    // zero line
    const zeroY = y(0);
    // gridlines: 4 levels
    const grid = [0, 1, 2, 3].map((g) => {
      const v = lo + (span * g) / 3;
      return { y: y(v), v: Math.round(v) };
    });

    return {
      bars: buckets.map((b, i) => ({
        x: cx(i) - barW / 2,
        w: barW,
        y: b.pnl >= 0 ? y(b.pnl) : zeroY,
        h: Math.max(1.5, Math.abs(y(b.pnl) - zeroY)),
        pnl: b.pnl,
        pos: b.pnl >= 0,
        label: b.label,
      })),
      line: pts.join(" "),
      last: { x: cx(n - 1), y: y(buckets[n - 1].bankEnd) },
      zeroY,
      grid,
      min: Math.round(lo),
      max: Math.round(hi),
      n,
    };
  }, [buckets, bankStart]);

  if (!view) {
    return (
      <div className="flex h-[210px] items-center justify-center rounded-xl border border-white/5 bg-black/20 text-[11px] text-muted-foreground">
        هنوز هیچ بازی تسویه‌شده‌ای برای رسم منحنی وجود ندارد — پس از اولین تسویه ESPN، نمودارها همین‌جا ساخته می‌شوند.
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="نمودار رشد بانک">
      {/* gridlines + axis labels */}
      {view.grid.map((g, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={g.y} x2={W - PAD_R} y2={g.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={PAD_L - 4} y={g.y + 3} textAnchor="end" fontSize="8" fill="rgba(255,255,255,0.35)" className="mono-num">
            {g.v}
          </text>
        </g>
      ))}
      {/* zero line */}
      <line x1={PAD_L} y1={view.zeroY} x2={W - PAD_R} y2={view.zeroY} stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="4 3" />
      {/* P&L bars */}
      {view.bars.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={Math.min(3, b.w / 2)}
          fill={b.pos ? "rgba(52,211,153,0.75)" : "rgba(251,113,133,0.75)"}
        >
          <title>{`${b.label}: ${b.pnl >= 0 ? "+" : ""}${b.pnl.toFixed(1)} واحد`}</title>
        </rect>
      ))}
      {/* cumulative bank line */}
      <polyline
        points={view.line}
        fill="none"
        stroke="#fbbf24"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 0 3px rgba(251,191,36,0.45))" }}
      />
      <circle cx={view.last.x} cy={view.last.y} r="4" fill="#fbbf24">
        <animate attributeName="r" values="4;7;4" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function StatCell({
  label,
  value,
  tone,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: string;
  sub?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className={`mono-num mt-1 text-base font-bold ${tone}`} dir="ltr">
        {value}
      </div>
      {sub && <div className="text-[9.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function BankGrowthPro({ history, bankStart, bank }: { history?: BankHistory; bankStart: number; bank: number }) {
  const [range, setRange] = useState<Range>("daily");
  const buckets = history ? history[range] : [];

  const agg = useMemo(() => {
    const list = buckets ?? [];
    const wins = list.reduce((s, b) => s + b.wins, 0);
    const losses = list.reduce((s, b) => s + b.losses, 0);
    const matches = list.reduce((s, b) => s + b.matches, 0);
    const pnl = list.reduce((s, b) => s + b.pnl, 0);
    const staked = list.reduce((s, b) => s + (b.staked ?? 0), 0);
    const decided = wins + losses;
    return {
      wins,
      losses,
      matches,
      pnl,
      staked,
      roi: staked > 0 ? pnl / staked : 0,
      winRate: decided > 0 ? wins / decided : 0,
      best: [...list].sort((a, b) => b.pnl - a.pnl)[0],
      worst: [...list].sort((a, b) => a.pnl - b.pnl)[0],
    };
  }, [buckets]);

  const shown = (buckets ?? []).slice(-14);

  return (
    <Card className="spatial-card rise-in rounded-2xl">
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Activity className="h-4 w-4 text-emerald-300" />
            ماژول حرفه‌ای منحنی رشد بانک — تحلیل روزانه / هفتگی / ماهانه
          </CardTitle>
          {/* range selector */}
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
            {(["daily", "weekly", "monthly"] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${
                  range === r
                    ? "bg-emerald-400/20 text-emerald-200 shadow-[0_0_12px_rgba(52,211,153,0.25)]"
                    : "text-muted-foreground hover:text-white"
                }`}
              >
                <CalendarDays className="me-1 inline h-3 w-3" />
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {/* dual-axis chart: P&L bars + cumulative bank line */}
        <div className="rounded-xl border border-white/10 bg-black/25 p-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-1 text-[9.5px] text-white/50">
            <span className="inline-flex items-center gap-1.5">
              <BarChart3 className="h-3 w-3 text-emerald-300" />
              میله‌ها: سود/زیافت دوره · خط طلایی: موجودی بانک
            </span>
            <span>
              بازه نمایش: <span className="mono-num text-white/80">{shown.length}</span> دوره اخیر از{" "}
              <span className="mono-num text-white/80">{buckets?.length ?? 0}</span>
            </span>
          </div>
          <Chart buckets={shown} bankStart={bankStart} />
        </div>

        {/* KPI row — requested detail set (v7.0: 8 cells incl. ROI + all-time peak) */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCell
            icon={CalendarDays}
            label="بازی‌های امروز"
            value={String(history?.today.matches ?? 0)}
            tone="text-white"
            sub={`برد ${history?.today.wins ?? 0} / باخت ${history?.today.losses ?? 0}`}
          />
          <StatCell
            icon={history && history.today.pnl >= 0 ? TrendingUp : TrendingDown}
            label="سود امروز"
            value={`${(history?.today.pnl ?? 0) >= 0 ? "+" : ""}${(history?.today.pnl ?? 0).toFixed(1)}`}
            tone={(history?.today.pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}
            sub={`وین‌ریت امروز ${(100 * (history?.today.winRate ?? 0)).toFixed(0)}%`}
          />
          <StatCell
            icon={ArrowUpRight}
            label={`سود ${RANGE_LABEL[range]}`}
            value={`${agg.pnl >= 0 ? "+" : ""}${agg.pnl.toFixed(1)}`}
            tone={agg.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}
            sub={`${agg.matches} مسابقه تسویه‌شده`}
          />
          <StatCell
            icon={Percent}
            label={`ROI ${RANGE_LABEL[range]}`}
            value={`${agg.staked > 0 ? `${agg.roi >= 0 ? "+" : ""}${(agg.roi * 100).toFixed(2)}` : "—"}%`}
            tone={agg.roi >= 0 ? "text-emerald-300" : "text-rose-300"}
            sub={`کل شرط‌بندی ${agg.staked.toFixed(0)} واحد`}
          />
          <StatCell
            icon={Crown}
            label={`بهترین ${RANGE_LABEL[range] === "روزانه" ? "روز" : RANGE_LABEL[range] === "هفتگی" ? "هفته" : "ماه"}`}
            value={agg.best ? `${agg.best.pnl >= 0 ? "+" : ""}${agg.best.pnl.toFixed(1)}` : "—"}
            tone="text-amber-300"
            sub={agg.best ? `${agg.best.label} · ${agg.best.wins} برد / ${agg.best.losses} باخت` : "بدون داده"}
          />
          <StatCell
            icon={ArrowDownRight}
            label={`بدترین ${RANGE_LABEL[range] === "روزانه" ? "روز" : RANGE_LABEL[range] === "هفتگی" ? "هفته" : "ماه"}`}
            value={agg.worst ? `${agg.worst.pnl >= 0 ? "+" : ""}${agg.worst.pnl.toFixed(1)}` : "—"}
            tone="text-rose-300"
            sub={agg.worst ? `${agg.worst.label} · ${agg.worst.wins} برد / ${agg.worst.losses} باخت` : "بدون داده"}
          />
          <StatCell
            icon={Crown}
            label="قله تاریخی بانک"
            value={(history?.peak.bank ?? bankStart).toLocaleString("en-US")}
            tone="text-amber-300"
            sub={history?.peak.at ? `ثبت در ${history.peak.at.slice(0, 10)}` : "شروع ۱۰۰۰ واحدی"}
          />
          <StatCell
            icon={Activity}
            label="بیشترین افت سرمایه"
            value={`-${history?.maxDrawdown.units ?? 0}`}
            tone="text-rose-300"
            sub={`${(history?.maxDrawdown.pct ?? 0).toFixed(2)}% از قله`}
          />
        </div>

        {/* period ledger table (max-h scroll) */}
        <div className="scroll-slim max-h-56 overflow-y-auto rounded-xl border border-white/5">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10 bg-black/60 backdrop-blur">
              <tr className="text-white/60">
                <th className="px-3 py-2 text-start font-bold">دوره ({RANGE_LABEL[range]})</th>
                <th className="px-3 py-2 text-center font-bold">بازی‌ها</th>
                <th className="px-3 py-2 text-center font-bold">برد / باخت</th>
                <th className="px-3 py-2 text-center font-bold">وین‌ریت</th>
                <th className="px-3 py-2 text-center font-bold">شرط‌ها</th>
                <th className="px-3 py-2 text-center font-bold">ROI</th>
                <th className="px-3 py-2 text-center font-bold">سود دوره</th>
                <th className="px-3 py-2 text-center font-bold">پایان بانک</th>
              </tr>
            </thead>
            <tbody>
              {[...(buckets ?? [])].reverse().map((b) => (
                <tr key={b.period} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-3 py-1.5 font-bold text-white/85">{b.label}</td>
                  <td className="mono-num px-3 py-1.5 text-center text-white/70" dir="ltr">
                    {b.matches}
                  </td>
                  <td className="mono-num px-3 py-1.5 text-center" dir="ltr">
                    <span className="text-emerald-300">{b.wins}</span>
                    <span className="text-white/35"> / </span>
                    <span className="text-rose-300">{b.losses}</span>
                  </td>
                  <td className="mono-num px-3 py-1.5 text-center text-white/70" dir="ltr">
                    {b.wins + b.losses > 0 ? `${(b.winRate * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="mono-num px-3 py-1.5 text-center text-white/60" dir="ltr">
                    {b.staked > 0 ? b.staked.toFixed(0) : "—"}
                  </td>
                  <td
                    className={`mono-num px-3 py-1.5 text-center font-bold ${b.roi >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    dir="ltr"
                  >
                    {b.staked > 0 ? `${b.roi >= 0 ? "+" : ""}${(b.roi * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td
                    className={`mono-num px-3 py-1.5 text-center font-bold ${b.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    dir="ltr"
                  >
                    {b.pnl >= 0 ? "+" : ""}
                    {b.pnl.toFixed(1)}
                  </td>
                  <td className="mono-num px-3 py-1.5 text-center text-white/60" dir="ltr">
                    {b.bankEnd.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
              {(buckets ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-white/45">
                    هنوز داده‌ای برای این بازه ثبت نشده است
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] leading-5 text-muted-foreground">
          حسابداری سطح مسابقه با تقویم تهران — روزها تا نیمه‌شب تهران بسته می‌شوند، هفته‌ها از شنبه آغاز می‌شوند؛
          موجودی فعلی بانک: <span className="mono-num text-white/80" dir="ltr">{bank.toLocaleString("en-US")}</span> واحد.
        </p>
      </CardContent>
    </Card>
  );
}
