"use client";

// ─── NeoTennis Markov Quant v3.0 — Official SHA-256 Record Table ───────────
// BUG FIXED (v2.0 audit): every match used to occupy TWO rows (winning slip
// A + losing slip B) → fake 29/30 (49.2%) ledger against an 89.7% gauge.
//
// v3.0 · Match-Level Dual-Slip Accounting: EXACTLY ONE row per match. Both
// wings (تیپ A / تیپ B) sit side by side in that single row, the winning
// wing carries the glowing green tick, and clicking the row expands a soft
// accordion with the exact per-wing math, set results and the ESPN
// verification link. Accounting identity:
//   netMatchProfit = winningSlipStake × winningSlipOdds − (stakeA + stakeB)

import { Fragment, useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ExternalLink,
  FileCheck2,
  Lock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LedgerMatchRow, LedgerPayload } from "@/lib/tennis/types";

const SURFACE_LABEL: Record<string, string> = {
  HARD: "هارد",
  CLAY: "خاک",
  GRASS: "چمن",
};

const LINE_LABEL: Record<string, string> = {
  DUAL: "زوج‌تیپ",
  COMBO: "میکس",
  SNIPER: "اسنایپر",
};

/** per-wing settlement math string, e.g. 50 × 2.85 − 100 = +42.5 */
function wingMath(r: LedgerMatchRow, legOdds: number, legStake: number): string {
  if (r.status === "PENDING") return "—";
  if (r.status === "WON") {
    const net = legOdds * legStake - r.stake;
    return `${legStake} × ${legOdds.toFixed(2)} − ${r.stake} = ${net >= 0 ? "+" : ""}${net.toFixed(1)}`;
  }
  return `−${legStake} (باخت بال)`;
}

function LegChip({
  row,
  leg,
  isWinner,
}: {
  row: LedgerMatchRow;
  leg: LedgerMatchRow["legs"][number];
  isWinner: boolean;
}) {
  const tone =
    leg.status === "PENDING"
      ? "border-white/10 bg-white/[0.04] text-muted-foreground"
      : isWinner
        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200 shadow-[0_0_14px_rgba(52,211,153,0.25)]"
        : "border-rose-400/30 bg-rose-400/[0.07] text-rose-200";
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-1 rounded-xl border px-2.5 py-2 ${tone}`}>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="font-bold">{leg.label}</span>
        <span className="num-capsule text-[10px]">@{leg.odds.toFixed(2)}</span>
      </div>
      <p className="line-clamp-2 text-[11px] leading-4 opacity-90">{leg.desc}</p>
      <div className="flex items-center justify-between gap-1 text-[10px]">
        <span className="text-muted-foreground">
          استیک <span className="mono-num" dir="ltr">{leg.stake}</span>
        </span>
        {leg.status === "WON" && (
          <span className="flex items-center gap-0.5 font-bold text-emerald-300">
            <BadgeCheck className="h-3 w-3" /> برد بال
          </span>
        )}
        {leg.status === "LOST" && <span className="font-bold text-rose-300">✗ باخت بال</span>}
        {leg.status === "PENDING" && <span className="text-muted-foreground">⏳ در انتظار</span>}
      </div>
      <span className="mono-num text-[9px] text-muted-foreground/70" dir="ltr">
        {wingMath(row, leg.odds, leg.stake)}
      </span>
    </div>
  );
}

function MatchRow({ row }: { row: LedgerMatchRow }) {
  const [open, setOpen] = useState(false);
  const isDual = row.line === "DUAL";
  const won = row.status === "WON";
  const lost = row.status === "LOST";

  return (
    <div
      className={`overflow-hidden rounded-xl border transition-colors ${
        won
          ? "border-emerald-400/25 bg-emerald-400/[0.05] hover:border-emerald-400/45"
          : lost
            ? "border-rose-400/25 bg-rose-400/[0.04] hover:border-rose-400/45"
            : "border-white/10 bg-white/[0.03] hover:border-white/20"
      }`}
    >
      {/* headline row — exactly ONE row per match */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-start"
      >
        <span
          className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-extrabold ${
            won
              ? "bg-emerald-400/15 text-emerald-300"
              : lost
                ? "bg-rose-400/15 text-rose-300"
                : "bg-white/10 text-muted-foreground"
          }`}
        >
          {won ? "MATCH WON ✅" : lost ? "MATCH LOST ✗" : "PENDING ⏳"}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold">{row.matchLabel}</span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {row.tournament} · {SURFACE_LABEL[row.surface] ?? row.surface} ·{" "}
            {LINE_LABEL[row.line] ?? row.line}
            {isDual && row.archetype && (
              <> · 👑 {row.archetype.labelFa}{row.archetype.adaptive ? " (سازگار)" : ""}</>
            )}
          </span>
        </span>

        {/* both wings side by side inside the single row */}
        <span className="hidden min-w-0 flex-1 gap-1.5 md:flex">
          {row.legs.map((leg) => (
            <span
              key={leg.leg}
              className={`truncate rounded-lg border px-2 py-1 text-[10px] ${
                leg.status === "WON"
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                  : leg.status === "LOST"
                    ? "border-rose-400/30 bg-rose-400/[0.06] text-rose-200/90"
                    : "border-white/10 bg-white/[0.04] text-muted-foreground"
              }`}
            >
              {leg.status === "WON" && "✓ "}
              {leg.label}: {leg.desc}
            </span>
          ))}
        </span>

        <span className="num-capsule text-[11px] text-white/90" dir="ltr">
          {row.result ?? "—"}
        </span>
        <span
          className={`num-capsule text-[11px] font-bold ${
            row.profit > 0 ? "text-emerald-300" : row.profit < 0 ? "text-rose-300" : "text-muted-foreground"
          }`}
        >
          {row.profit >= 0 ? "+" : ""}
          {row.profit.toFixed(1)}
        </span>
        <span className="num-capsule text-[10px] text-cyan-300/90">
          <Lock className="h-3 w-3" />
          {row.hash ? row.hash.slice(0, 10) : "—"}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* soft accordion detail */}
      {open && (
        <div className="rise-in space-y-3 border-t border-white/10 bg-black/30 px-3 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {row.legs.map((leg) => (
              <LegChip key={leg.leg} row={row} leg={leg} isWinner={leg.leg === row.winnerLeg} />
            ))}
          </div>

          <div className="grid gap-2 text-[10px] text-muted-foreground sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2">
              <div>نتیجه ست‌ها (ESPN)</div>
              <div className="mono-num mt-1 text-sm font-bold text-white" dir="ltr">
                {row.setsA !== undefined && row.setsB !== undefined
                  ? `${row.setsA}-${row.setsB}`
                  : (row.result ?? "—")}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2">
              <div>سرمایه‌گذاری کل مسابقه</div>
              <div className="mono-num mt-1 text-sm font-bold text-white" dir="ltr">
                {row.stake} units
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2">
              <div>سود خالص مسابقه</div>
              <div
                className={`mono-num mt-1 text-sm font-bold ${
                  row.profit >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
                dir="ltr"
              >
                {row.profit >= 0 ? "+" : ""}
                {row.profit.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="mono-num text-[10px] text-cyan-300/80" dir="ltr">
              SHA-256: {row.hash ?? "—"}
            </span>
            {row.espnUrl && (
              <a
                href={row.espnUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/80 transition-colors hover:bg-white/15"
                dir="ltr"
              >
                <ExternalLink className="h-3 w-3" />
                ESPN Verification
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RecordTable({ ledger }: { ledger: LedgerPayload }) {
  const [filter, setFilter] = useState<"ALL" | "WON" | "LOST">("ALL");

  const rows = useMemo(() => {
    const settled = ledger.rows.filter((r) => r.status === "WON" || r.status === "LOST");
    return (filter === "ALL" ? settled : settled.filter((r) => r.status === filter)).slice(0, 40);
  }, [ledger.rows, filter]);

  const won = ledger.rows.filter((r) => r.status === "WON").length;
  const lost = ledger.rows.filter((r) => r.status === "LOST").length;
  const decided = won + lost;
  const winRate = decided > 0 ? (won / decided) * 100 : 0;

  // v3.0 — the DUAL line is accounted at MATCH level (two wings = one position)
  const dualGroup = ledger.groups.find((g) => g.line === "DUAL");
  const dualDecided = dualGroup ? dualGroup.won + dualGroup.lost : 0;
  const dualRate = dualGroup && dualDecided > 0 ? (dualGroup.won / dualDecided) * 100 : 0;

  return (
    <Card className="spatial-card rise-in rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <FileCheck2 className="h-4 w-4 text-emerald-300" />
          کارنامه رسمی SHA-256 — یک سطر برای هر مسابقه
          <Badge variant="outline" className="gap-1 border-emerald-400/30 bg-emerald-400/5 text-[10px] text-emerald-300">
            <BadgeCheck className="h-3 w-3" />
            <span className="mono-num">{decided}</span> پوزیشن تسویه‌شده ۷ روز اخیر
          </Badge>
          <span className="text-[11px] font-normal text-muted-foreground">
            — وین‌ریت سطح مسابقه: <span className="mono-num">{winRate.toFixed(1)}%</span> (
            <span className="mono-num">{won}</span> برد / <span className="mono-num">{lost}</span> باخت)
          </span>
          {dualGroup && dualDecided > 0 && (
            <Badge variant="outline" className="gap-1 border-amber-300/30 bg-amber-300/5 text-[10px] text-amber-300">
              👑 زوج‌تیپ: <span className="mono-num">{dualGroup.won}</span> برد /{" "}
              <span className="mono-num">{dualGroup.lost}</span> باخت (
              <span className="mono-num">{dualRate.toFixed(1)}%</span>)
            </Badge>
          )}
          <Tabs value={filter} onValueChange={(v) => setFilter(v as "ALL" | "WON" | "LOST")}>
            <TabsList className="h-7 bg-white/5">
              <TabsTrigger value="ALL" className="h-5 px-2 text-[11px]">همه</TabsTrigger>
              <TabsTrigger value="WON" className="h-5 px-2 text-[11px]">برد</TabsTrigger>
              <TabsTrigger value="LOST" className="h-5 px-2 text-[11px]">باخت</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            هنوز مسابقه تسویه‌شده‌ای در پنجره ۷ روزه ثبت نشده — موتور به محض پایان هر مسابقه
            تاییدشده، آن را با نتیجه واقعی ESPN در سطح مسابقه تسویه می‌کند.
          </p>
        ) : (
          <div className="scroll-slim max-h-96 space-y-2 overflow-y-auto pe-1">
            {rows.map((r) => (
              <Fragment key={r.id}>
                <MatchRow row={r} />
              </Fragment>
            ))}
          </div>
        )}
        <p className="mt-3 text-center text-[10px] leading-4 text-muted-foreground">
          حسابداری زوج‌تیپ در سطح مسابقه: تیپ A و تیپ B دو بالِ یک پوزیشن واحد هستند —
          برد هر بال یعنی برد مسابقه و سود خالص ={" "}
          <span className="mono-num" dir="ltr">
            winningSlip × odds − (stakeA + stakeB)
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
