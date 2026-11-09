"use client";

import { useMemo } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Crown,
  Flame,
  Gauge,
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
import type { LedgerPayload, ProductionLine } from "@/lib/tennis/types";

const LINE_LABELS: Record<ProductionLine, string> = {
  DUAL: "زوج‌تیپ طلایی مکمل",
  COMBO: "میکس سلاطین سرویس",
  SNIPER: "تک‌تیرانداز ضریب بالا",
  SHADOW: "دفتر سایه (وتوها)",
};

const LINE_COLORS: Record<ProductionLine, string> = {
  DUAL: "text-amber-300",
  COMBO: "text-cyan-300",
  SNIPER: "text-rose-300",
  SHADOW: "text-muted-foreground",
};

// ─── Animated semicircle win-rate gauge ────────────────────────────────────
function WinRateGauge({ rate }: { rate: number }) {
  const pct = Math.max(0, Math.min(1, rate));
  // semicircle from 180° → 0°
  const radius = 80;
  const cx = 110;
  const cy = 104;
  const arcLen = Math.PI * radius;
  const filled = arcLen * pct;
  const angle = Math.PI * (1 - pct);
  const needleX = cx + radius * Math.cos(angle);
  const needleY = cy - radius * Math.sin(angle);

  return (
    <div className="relative flex flex-col items-center">
      <svg viewBox="0 0 220 132" className="w-full max-w-[240px]">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="55%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${arcLen}`}
          style={{ transition: "stroke-dasharray 1.1s cubic-bezier(0.22,1,0.36,1)" }}
        />
        {/* needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ transition: "all 1.1s cubic-bezier(0.22,1,0.36,1)" }}
        />
        <circle cx={cx} cy={cy} r="5" fill="#f5c542" />
        <text
          x={cx}
          y={cy - 26}
          textAnchor="middle"
          className="mono-num"
          fill="white"
          fontSize="30"
          fontWeight="800"
        >
          {(pct * 100).toFixed(1)}%
        </text>
        <text
          x={cx}
          y={cy - 8}
          textAnchor="middle"
          fill="rgba(255,255,255,0.5)"
          fontSize="10"
        >
          COMBINED WIN RATE
        </text>
      </svg>
    </div>
  );
}

// ─── Bank growth curve (custom SVG area) ───────────────────────────────────
function BankCurve({ bank, start }: { bank: number; start: number }) {
  const { path, area, last } = useMemo(() => {
    const W = 560;
    const H = 150;
    const min = Math.min(start, bank) * 0.998;
    const max = Math.max(start, bank) * 1.002 || 1;
    const y = (v: number) => H - 8 - ((v - min) / (max - min || 1)) * (H - 20);
    const lastY = y(bank);
    const lastX = W - 4;
    const startY = y(start);
    const path = `M 4 ${startY} L ${lastX} ${lastY}`;
    const area = `M 4 ${startY} L ${lastX} ${lastY} L ${lastX} ${H} L 4 ${H} Z`;
    return { path, area, last: { x: lastX, y: lastY } };
  }, [bank, start]);

  const up = bank >= start;
  return (
    <svg viewBox="0 0 560 150" className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="bankGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={up ? "#34d399" : "#fb7185"} stopOpacity="0.28" />
          <stop offset="100%" stopColor={up ? "#34d399" : "#fb7185"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#bankGrad)" />
      <path
        d={path}
        fill="none"
        stroke={up ? "#34d399" : "#fb7185"}
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{ transition: "d 1s ease" }}
      />
      <circle cx={last.x} cy={last.y} r="4" fill={up ? "#34d399" : "#fb7185"}>
        <animate attributeName="r" values="4;7;4" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

export function CommandCenter({ ledger }: { ledger: LedgerPayload }) {
  const { stats, groups } = ledger;
  const streakUp = stats.streak > 0;
  const best = stats.bestWin;

  const kpis = [
    {
      icon: Banknote,
      label: "بانک ۱۰۰۰ واحدی",
      value: `${stats.bank.toLocaleString("fa-IR")}`,
      hint: `${stats.profit >= 0 ? "+" : ""}${stats.profit.toFixed(1)} واحد`,
      tone: stats.profit >= 0 ? "text-emerald-300" : "text-rose-300",
    },
    {
      icon: Scale,
      label: "بازده روی سرمایه",
      value: `${(stats.roi * 100).toFixed(1)}%`,
      hint: `${stats.settled} تیپ تسویه‌شده`,
      tone: stats.roi >= 0 ? "text-emerald-300" : "text-rose-300",
    },
    {
      icon: Flame,
      label: "رگبار فعلی",
      value: streakUp ? `${stats.streak} برد` : `${Math.abs(stats.streak)} باخت`,
      hint: "برد پیاپی آخرین تیپ‌ها",
      tone: streakUp ? "text-amber-300" : "text-rose-300",
    },
    {
      icon: Layers,
      label: "کل تیپ‌های دفترکل",
      value: `${stats.picks}`,
      hint: `${groups.reduce((s, g) => s + g.pending, 0)} در انتظار نتیجه`,
      tone: "text-white",
    },
  ];

  return (
    <section aria-label="مرکز فرماندهی وین‌ریت" className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* gauge */}
        <Card className="glass-card rise-in">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Gauge className="h-4 w-4 text-amber-300" />
              مرکز فرماندهی وین‌ریت
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <WinRateGauge rate={stats.combinedWinRate} />
            <p className="text-center text-[11px] text-muted-foreground">
              تجمیع ۳ خط تولید — دفتر سایه جداست (بدون دوباره‌شماری)
            </p>
          </CardContent>
        </Card>

        {/* bank curve */}
        <Card className="glass-card rise-in lg:col-span-2">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Banknote className="h-4 w-4 text-emerald-300" />
              منحنی رشد بانک ۱۰۰۰ واحدی
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-2">
            <BankCurve bank={stats.bank} start={stats.bankStart} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <k.icon className="h-3 w-3" />
                    {k.label}
                  </div>
                  <div className={`mono-num mt-1 text-lg font-bold ${k.tone}`}>{k.value}</div>
                  <div className="text-[10px] text-muted-foreground">{k.hint}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* disjoint ledger */}
      <Card className="glass-card rise-in">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <ShieldOff className="h-4 w-4 text-amber-300" />
            دفترکل افرازی (Disjoint Ledger)
            <span className="text-[11px] font-normal text-muted-foreground">
              — هر خط تولید مستقل تسویه می‌شود؛ وتوها فقط در دفتر سایه
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="scroll-slim max-h-64 overflow-y-auto rounded-xl border border-white/5">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">خط تولید</TableHead>
                  <TableHead className="text-xs">تیپ</TableHead>
                  <TableHead className="text-xs">برد</TableHead>
                  <TableHead className="text-xs">وین‌ریت</TableHead>
                  <TableHead className="text-xs">سود</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.line}>
                    <TableCell className={`text-xs font-bold ${LINE_COLORS[g.line]}`}>
                      {LINE_LABELS[g.line]}
                    </TableCell>
                    <TableCell className="mono-num text-xs">
                      {g.picks}
                      <span className="text-muted-foreground"> ({g.pending}⏳)</span>
                    </TableCell>
                    <TableCell className="mono-num text-xs">{g.won} / {g.lost}</TableCell>
                    <TableCell className="mono-num text-xs">
                      {g.picks - g.pending > 0 ? `${(g.winRate * 100).toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell
                      className={`mono-num text-xs ${g.profit >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {g.profit >= 0 ? "+" : ""}
                      {g.profit.toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                  بهترین برد دفترکل
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                  {best.matchLabel} — <span className="mono-num">@{best.odds.toFixed(2)}</span>{" "}
                  ({LINE_LABELS[best.line]})
                </p>
                <p className={`mono-num mt-1 flex items-center gap-1 text-sm font-bold ${best.profit && best.profit > 0 ? "text-emerald-300" : ""}`}>
                  {best.profit && best.profit > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  +{(best.profit ?? 0).toFixed(1)} واحد
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
