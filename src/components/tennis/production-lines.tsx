"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  Copy,
  Crown,
  ExternalLink,
  Layers,
  Lock,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TiltCard } from "@/components/tennis/spatial-tilt";
import { OddsCalibrator } from "@/components/tennis/odds-calibrator";
import { dedupeByKey } from "@/lib/tennis/dedupe";
import { legLabelOf, OVERLAP_PATTERNS, REGIME_META } from "@/lib/tennis/supervisor";
import { cn } from "@/lib/utils";
import type {
  AnalyzedMatch,
  CrownInfo,
  FeedPayload,
  LedgerPayload,
  LineItem,
  QqlDecision,
  RegimeDecision,
  Surface,
} from "@/lib/tennis/types";

// ─── v4.0 surface identity (official broadcast badge colors) ───────────────

const SURFACE_DOT: Record<Surface, string> = {
  HARD: "bg-cyan-400",
  CLAY: "bg-orange-400",
  GRASS: "bg-emerald-400",
};

const SURFACE_LABEL: Record<Surface, { en: string; fa: string; chip: string }> = {
  HARD: { en: "HARD COURT", fa: "هاردکورت", chip: "text-cyan-300 border-cyan-400/40 bg-cyan-400/10" },
  CLAY: { en: "CLAY COURT", fa: "خاک رس", chip: "text-orange-300 border-orange-400/40 bg-orange-400/10" },
  GRASS: { en: "GRASS COURT", fa: "چمن", chip: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10" },
};

const ARCH_STYLE: Record<string, string> = {
  ARCH1: "border-amber-300/40 bg-amber-300/10 text-amber-300",
  ARCH2: "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300",
  ARCH3: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

function flagSrc(url: string | undefined): string | null {
  if (!url) return null;
  return `/api/tennis/img?url=${encodeURIComponent(url)}`;
}

function SurfaceDot({ surface }: { surface: Surface }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${SURFACE_DOT[surface]}`} />
      </TooltipTrigger>
      <TooltipContent className="text-xs">{SURFACE_LABEL[surface].fa}کورت</TooltipContent>
    </Tooltip>
  );
}

function SurfaceBadge({ surface }: { surface: Surface }) {
  const s = SURFACE_LABEL[surface];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider ${s.chip}`}
      dir="ltr"
    >
      <span className={`inline-block h-2 w-2 rounded-full ${SURFACE_DOT[surface]}`} />
      {s.en}
    </span>
  );
}

// ─── v4.0 Persian date/time + countdown (تاریخ و ساعت دقیق شروع) ───────────

const faDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fa-IR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
};

const faTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

function countdownLabel(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = t - now;
  if (diff <= 0) return "شروع‌شده / در جریان";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins >= 60) {
    return `شروع تا ${Math.floor(mins / 60)} ساعت و ${mins % 60} دقیقه دیگر`;
  }
  return `شروع تا ${mins}:${String(secs).padStart(2, "0")} دیگر`;
}

function MatchClock({ item }: { item: LineItem }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!item.startTime) return <span className="text-[11px] text-muted-foreground">{item.timing.label}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/75">
      <CalendarClock className="h-3.5 w-3.5 text-white/50" />
      <span className="font-bold text-white/90">
        {faDate(item.startTime)} — ساعت {faTime(item.startTime)}
      </span>
      {item.state === "pre" && (
        <span className="mono-num rounded-md border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[10px] text-amber-200" dir="ltr">
          {countdownLabel(item.startTime, now)}
        </span>
      )}
      {item.state === "in" && (
        <span className="rounded-md border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-200">
          در حال بازی
        </span>
      )}
    </span>
  );
}

// ─── v4.0 player profile strip (flag · rank · seed · Hold% · BP Saved%) ────

function MiniBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.max(2, value * 100));
  return (
    <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground" dir="ltr">
      <span className="w-20 shrink-0 truncate">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${value >= 0.8 ? "bg-emerald-400" : value >= 0.6 ? "bg-amber-300" : "bg-rose-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* v11/v12 — one-decimal telemetry: the per-player continuous values make
          every card's Hold % / BP Saved % unique (no repeated 81%/55% template) */}
      <span className="mono-num w-11 text-right">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

function PlayerProfile({
  name,
  short,
  flag,
  rank,
  seed,
  hold,
  bps,
  tour,
  favorite,
}: {
  name: string;
  short?: string;
  flag?: string;
  rank?: number;
  seed?: number;
  hold?: number;
  bps?: number;
  tour: string;
  favorite: boolean;
}) {
  const src = flagSrc(flag);
  return (
    <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
      <div className="flex items-center gap-2">
        {src ? (
          <img
            src={src}
            alt={`پرچم ${short ?? name}`}
            className="h-6 w-6 shrink-0 rounded-md border border-white/15 object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 text-[9px] font-bold text-white/60">
            {(short ?? name).slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-extrabold text-white">{name}</span>
            {favorite && <Crown className="h-3 w-3 shrink-0 text-amber-300" />}
          </div>
          <div className="mono-num mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground" dir="ltr">
            <span className="font-bold text-white/70">
              {tour} {rank ? `#${rank}` : "—"}
            </span>
            {seed ? <span className="rounded bg-white/10 px-1">Seed #{seed}</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-1.5 space-y-1">
        {hold !== undefined && <MiniBar label="Service Hold %" value={hold} />}
        {bps !== undefined && <MiniBar label="Break Pt Saved %" value={bps} />}
      </div>
    </div>
  );
}

// ─── v4.0 standard 4-row Type A / Type B market box ────────────────────────

function MarketBox({
  tone,
  wingLabel,
  item,
}: {
  tone: "A" | "B" | "single" | "emerald" | "orange" | "violet" | "lime";
  wingLabel: string;
  item: LineItem;
}) {
  const accent =
    tone === "A"
      ? "border-amber-300/30 bg-amber-300/[0.07]"
      : tone === "B" || tone === "emerald"
        ? "border-emerald-400/30 bg-emerald-400/[0.07]"
        : tone === "orange"
          ? "border-orange-400/30 bg-orange-400/[0.07]"
          : tone === "violet"
            ? "border-violet-400/30 bg-violet-400/[0.07]"
            : tone === "lime"
              ? "border-lime-400/30 bg-lime-400/[0.07]"
              : "border-rose-400/30 bg-rose-400/[0.06]";
  const toneText =
    tone === "A"
      ? "text-amber-300"
      : tone === "B" || tone === "emerald"
        ? "text-emerald-300"
        : tone === "orange"
          ? "text-orange-300"
          : tone === "violet"
            ? "text-violet-300"
            : tone === "lime"
              ? "text-lime-300"
              : "text-rose-300";
  const stake = item.stakePct ?? item.stake;
  return (
    <div className={`rounded-xl border p-3 ${accent}`}>
      {/* row 1 — official English market name */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-[10px] font-black ${toneText}`}>{wingLabel}</span>
        <span className="mono-num text-[11px] font-extrabold tracking-wide text-white" dir="ltr">
          MARKET: {item.marketEn ?? item.descEn}
        </span>
      </div>
      {/* row 2 — exact Persian bet translation */}
      <p className="mt-1.5 text-[13px] font-bold leading-6 text-white/95">
        {item.marketFa ?? item.desc}
      </p>
      {/* row 3 — odds + Markov probability */}
      <div className="mono-num mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>
          ضریب: <span className="num-capsule font-extrabold text-white">{item.odds.toFixed(2)}x</span>
        </span>
        <span className="text-white/25">|</span>
        <span>
          احتمال زنجیره مارکوف:{" "}
          <span className="num-capsule text-white">{(item.prob * 100).toFixed(1)}%</span>
        </span>
        {item.targetWindow && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-[10px] text-cyan-300/80" dir="ltr">
                window [{item.targetWindow[0].toFixed(2)}–{item.targetWindow[1].toFixed(2)}]
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-[10px]">
              پنجره قیمت رسمی این مارکت در سایت‌های شرط‌بندی
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {/* row 4 — exact dutching stake of the 100-unit match budget */}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/80">
        <Wallet className="h-3.5 w-3.5 text-amber-300" />
        <span>
          مبلغ شرط:{" "}
          <span className="num-capsule font-extrabold text-amber-200">{stake}</span> واحد
          {item.stakePct !== undefined && (
            <>
              {" "}(
              <span className="mono-num">{Number(stake).toFixed(1)}%</span> از بودجه این بازی)
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// ─── v5.5 · holographic crown-tier badge (GOLD approved / SILVER adaptive —
// BOTH tiers now ride the same full 100-unit standard stake) ─────────────────

function CrownBadge({ crown }: { crown: CrownInfo }) {
  const gold = crown.tier === "GOLD";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`holo-badge flex items-center gap-2.5 rounded-xl px-3 py-2 ${
            gold
              ? "holo-gold border border-amber-300/50 bg-gradient-to-r from-amber-300/15 via-yellow-200/10 to-amber-300/15"
              : "holo-silver border border-slate-300/40 bg-gradient-to-r from-slate-200/10 via-white/10 to-slate-200/10"
          }`}
        >
          <span className="text-lg leading-none drop-shadow">{gold ? "👑" : "🥈"}</span>
          <div className="min-w-0">
            <div
              className={`text-[11px] font-black tracking-wide ${gold ? "text-amber-200" : "text-slate-200"}`}
              dir="ltr"
            >
              {gold ? "GOLD CROWN APPROVED" : "SILVER CROWN · ADAPTIVE"}
            </div>
            <div className="mono-num text-[9px] text-white/60" dir="ltr">
              Monte-Carlo Success: {crown.score}/100 · FULL STAKE 100u
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px] text-[11px] leading-5">
        {crown.labelFa}
        <br />
        {gold
          ? "کارت‌های تاییدشده‌ای که درصد موفقیت مونت‌کارلو بالای ۸۵/۱۰۰ دارند — تاج طلایی با استیک کامل ۱۰۰ واحدی."
          : "کارت سهمیه تطبیقی ۶۵٪ سوپروایزر — با همان استیک کامل ۱۰۰ واحدی استاندارد مدیریت می‌شود."}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── v5.5 · regime chip (the ONE routed strategy with its Sharpe reason) ───

function RegimeChip({ regime }: { regime: RegimeDecision }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="gap-1 border-cyan-400/40 bg-cyan-400/10 text-[10px] font-bold text-cyan-200"
          dir="ltr"
        >
          <span>{regime.icon ?? "🎯"}</span>
          {regime.labelEn ?? regime.labelFa}
          <span className="mono-num">· Sharpe {regime.sharpe.toFixed(2)}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px] text-[11px] leading-5">
        <div className="font-bold" dir="ltr">
          {regime.labelEn}
        </div>
        <p className="mt-1">{regime.why}</p>
        {regime.stakePlanFa && <p className="mt-1 text-[10px]">{regime.stakePlanFa}</p>}
        <p className="mono-num mt-1" dir="ltr">
          coverage {((regime.coverage ?? 0) * 100).toFixed(1)}% · pair-loss{" "}
          {((regime.pairLoss ?? 0) * 100).toFixed(1)}%
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── v4.0 retirement/settlement rule badge (تسویه مصدومیت) ─────────────────

function RetirementRuleBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-400/[0.07] px-2.5 py-1 text-[10px] font-bold text-sky-200">
          <ShieldCheck className="h-3.5 w-3.5" />
          قانون تسویه: نیازمند اتمام کامل مسابقه (Full Match Completion — در صورت انصراف، فسخ ۱.۰۰)
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-[10px] leading-5">
        اگر بازیکن پیش از پایان مسابقه انصراف دهد (Retirement)، همه تیپ‌های این کارت با ضریب
        ۱.۰۰ فسخ می‌شوند و هیچ سودی زیان ندارد — مطابق قانون استاندارد بوک‌میکرهای تنیس.
      </TooltipContent>
    </Tooltip>
  );
}

// ─── v4.0 click-to-verify SHA-256 hash chip + modal ────────────────────────

function espnUrlOf(eventKey?: string, espnUrl?: string): string {
  if (espnUrl) return espnUrl;
  if (eventKey && /^\d+$/.test(eventKey)) {
    return `https://www.espn.com/tennis/match/_/gameId/${eventKey}`;
  }
  return "https://www.espn.com/tennis/";
}

function HashVerifyChip({
  hash,
  eventKey,
  espnUrl,
  matchLabel,
}: {
  hash: string;
  eventKey?: string;
  espnUrl?: string;
  matchLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = espnUrlOf(eventKey, espnUrl);

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="راستی‌آزمایی هش SHA-256"
            className="mono-num inline-flex items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.07] px-2 py-1 text-[10px] text-cyan-300 transition-colors hover:bg-cyan-400/15"
            dir="ltr"
          >
            <Lock className="h-3 w-3" />
            {hash.slice(0, 10).toUpperCase()}
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-[10px]">
          قفل SHA-256 پیش از مسابقه — کلیک برای راستی‌آزمایی
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onClick={(e) => e.stopPropagation()}
          className="max-w-lg border-white/10 bg-[oklch(0.16_0.01_270)]"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <BadgeCheck className="h-4 w-4 text-cyan-300" />
              راستی‌آزمایی قفل SHA-256 پیش از مسابقه
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-5">
              این هش پیش از شروع مسابقه روی کارت حک شده و متن مارکت‌ها و ضرایب را قفل می‌کند —
              پس از تسویه، هیچ عددی قابل دستکاری نیست.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="text-[10px] text-muted-foreground">{matchLabel}</div>
              <p
                className="mono-num mt-1.5 break-all rounded-lg bg-black/40 p-2.5 text-[11px] leading-5 text-cyan-200"
                dir="ltr"
              >
                {hash}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={copyHash}
                className="border-white/15 bg-white/[0.04] text-xs text-white hover:bg-white/10 hover:text-white"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "کپی شد" : "کپی هش"}
              </Button>
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex">
                <Button
                  type="button"
                  size="sm"
                  className="bg-cyan-500/90 text-xs text-black hover:bg-cyan-400"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  صفحه رسمی بازی در ESPN Tennis
                </Button>
              </a>
            </div>
            <p className="text-[10px] leading-5 text-muted-foreground">
              لینک بازی در <span dir="ltr" className="font-mono">espn.com/tennis</span> برای
              تطبیق نتیجه نهایی و تسویه قانونی (قانون اتمام کامل مسابقه) درج شده است.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── shared flashcard header (tournament + metadata + both player profiles) ─

function FlashHeader({ item, matchLabel }: { item: LineItem; matchLabel?: string }) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SurfaceBadge surface={item.surface} />
          <span className="text-[10px] font-bold tracking-wide text-white/70" dir="ltr">
            {item.tour} · {item.round}
          </span>
          <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-muted-foreground">
            {item.tournament}
          </Badge>
        </div>
        {item.timing.optimal && (
          <Badge className="border-0 bg-amber-300 text-[10px] font-bold text-black">
            <Rocket className="h-3 w-3" />
            {item.timing.code === "T30" ? "T-30m Pre-Warmup" : "In-Play After Early Break"}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <MatchClock item={item} />
        {matchLabel && (
          <span className="text-[11px] font-bold text-white/85">{matchLabel}</span>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <PlayerProfile
          name={item.playerA}
          short={item.playerAShort}
          flag={item.flagA}
          rank={item.rankA}
          seed={item.seedA}
          hold={item.holdA}
          bps={item.bpsA}
          tour={item.tour}
          favorite={item.favorite === "A"}
        />
        <PlayerProfile
          name={item.playerB}
          short={item.playerBShort}
          flag={item.flagB}
          rank={item.rankB}
          seed={item.seedB}
          hold={item.holdB}
          bps={item.bpsB}
          tour={item.tour}
          favorite={item.favorite === "B"}
        />
      </div>
    </div>
  );
}

function ArchBadge({ item }: { item: LineItem }) {
  if (!item.archetype) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`gap-1 text-[10px] font-bold ${ARCH_STYLE[item.archetype.code] ?? "border-white/10 bg-white/5 text-muted-foreground"}`}
        >
          <Crown className="h-3 w-3" />
          {item.archetype.labelFa}
          {item.archetype.adaptive && " (سازگار)"}
          <span className="mono-num">· {(item.archetype.coverage * 100).toFixed(1)}%</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        {item.archetype.labelEn} — پوشش کل فضای پیشامد{" "}
        <span className="mono-num">{(item.archetype.coverage * 100).toFixed(1)}%</span> · ریسک باخت
        همزمان <span className="mono-num">{(item.archetype.pairLoss * 100).toFixed(1)}%</span>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── v5.0 · 👑 Crown badge (GOLD / SILVER holographic) ─────────────────────

function CrownBadgeV5({ item }: { item: LineItem }) {
  const c = item.crown;
  if (!c || c.tier === "NONE") return null;
  const gold = c.tier === "GOLD";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          className={`gap-1 border-0 text-[10px] font-black ${
            gold
              ? "bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-400 text-black shadow-[0_0_14px_rgba(251,191,36,0.45)]"
              : "bg-gradient-to-r from-slate-300 via-white to-slate-300 text-slate-900 shadow-[0_0_12px_rgba(226,232,240,0.35)]"
          }`}
        >
          {gold ? "👑" : "🥈"}
          {gold ? "GOLD CROWN" : "SILVER CROWN"}
          <span className="mono-num">MC {c.score}/100</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-[11px] leading-5">
        <div className="font-bold">{c.labelFa}</div>
        <div className="mono-num mt-1 text-[10px]" dir="ltr">
          {c.labelEn}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── v5.0 · regime badge (5-regime router decision) ─────────────────────────

function RegimeBadge({ item }: { item: LineItem }) {
  const r = item.regime;
  if (!r || r.code === "VETOED") return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="gap-1 border-cyan-400/40 bg-cyan-400/10 text-[10px] font-bold text-cyan-200"
        >
          {r.icon} {r.labelFa}
          <span className="mono-num">· Sharpe {r.sharpe.toFixed(2)}</span>
          <span className="mono-num">· MC {r.mcScore}/100</span>
          {r.adaptive && <span className="text-amber-200">· سازگار</span>}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-[11px] leading-5">
        <div className="font-bold" dir="ltr">
          {r.labelEn}
        </div>
        <div className="mt-1">{r.why}</div>
        {r.stakePlanFa && <div className="mt-1 text-[10px]">{r.stakePlanFa}</div>}
        {r.marketEn && (
          <div className="mono-num mt-1 text-[10px]" dir="ltr">
            MARKET: {r.marketEn}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── v5.0 · 4-station pipeline telemetry bar ────────────────────────────────
// [✅ 1. Markov p_A/p_B] ➔ [✅ 2. Copula ρ] ➔ [✅ 3. 10k Monte-Carlo] ➔ [👑 4. Supervisor Crown]

function PipelineBarV5({ item }: { item: LineItem }) {
  const p = item.pipeline;
  if (!p) return null;
  const crownIcon = p.station4Supervisor.label.includes("GOLD")
    ? "👑"
    : p.station4Supervisor.label.includes("SILVER")
      ? "🥈"
      : "✅";
  const stations = [
    {
      ok: p.station1Markov.ok,
      title: "1. Markov",
      sub: `${(p.station1Markov.pA * 100).toFixed(0)}/${(p.station1Markov.pB * 100).toFixed(0)}`,
      icon: "✅",
    },
    {
      ok: p.station2Copula.ok,
      title: "2. Copula ρ",
      sub: p.station2Copula.label.replace("Copula ", ""),
      icon: "✅",
    },
    {
      ok: p.station3MonteCarlo.ok,
      title: "3. 10k Monte-Carlo",
      sub: `${(p.station3MonteCarlo.runs / 1000).toFixed(0)}k runs`,
      icon: "✅",
    },
    {
      ok: p.station4Supervisor.ok,
      title: "4. Supervisor",
      sub: `${p.station4Supervisor.score}/100`,
      icon: crownIcon,
    },
  ];
  return (
    <div className="flex items-stretch gap-1 rounded-xl border border-white/10 bg-black/25 p-1.5" dir="ltr">
      {stations.map((st, i) => (
        <div key={i} className="flex min-w-0 flex-1 items-center gap-1">
          <div
            className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 ${
              st.ok
                ? "border-emerald-400/25 bg-emerald-400/[0.06]"
                : "border-white/10 bg-white/[0.03] opacity-60"
            }`}
          >
            <span className="text-[10px] leading-none">{st.icon}</span>
            <span className="mono-num truncate text-[8.5px] font-bold leading-tight text-white/80">
              {st.title}
            </span>
            <span className="mono-num truncate text-[8.5px] leading-tight text-cyan-300">
              {st.sub}
            </span>
          </div>
          {i < stations.length - 1 && (
            <span className="shrink-0 text-[9px] text-white/35">➔</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** v5.0 stacked panel: regime + crown badges over the 4-station telemetry bar. */
function V5Panel({ item }: { item: LineItem }) {
  const hasCrown = item.crown && item.crown.tier !== "NONE";
  if (!item.regime && !hasCrown && !item.pipeline) return null;
  return (
    <div className="mt-3 space-y-2">
      {(item.regime || hasCrown) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <RegimeBadge item={item} />
          <CrownBadgeV5 item={item} />
        </div>
      )}
      <PipelineBarV5 item={item} />
    </div>
  );
}

function FlashFooter({ item, matchLabel }: { item: LineItem; matchLabel: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2.5">
      <RetirementRuleBadge />
      {item.hashPre && (
        <HashVerifyChip
          hash={item.hashPre}
          eventKey={item.eventKey}
          espnUrl={item.espnUrl}
          matchLabel={matchLabel}
        />
      )}
    </div>
  );
}

// ─── v12 · Quantum pattern line + 🧠 AI RCA & QQL trace box ───────────────────

/** Persian-digit formatter for the quantum telemetry (۹۱.۶٪) */
const faNum = (s: string | number): string =>
  String(s).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);

/** ⚛️ the quantum pattern code of THIS match (v11 §3 — verbatim format) */
function QuantumPatternLine({ qql, combo }: { qql?: QqlDecision; combo?: boolean }) {
  if (!combo && !qql) return null;
  if (combo) {
    return (
      <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] px-3 py-2 text-center">
        <span className="text-[10.5px] font-bold text-cyan-200">
          {"⚛️ بهینه‌ساز کوانتومی از ۴۵ ترکیب: [خانواده ۶ — کمبوی کاپولا + پوشش] • جرم مشترک کاپولا در ۱۰٬۰۰۰ شبیه‌سازی"}
        </span>
      </div>
    );
  }
  const pair = (qql?.pairCode ?? "").split("-").join(" ↔ ");
  return (
    <div className="rounded-xl border border-violet-400/30 bg-violet-400/[0.08] px-3 py-2 text-center">
      <span className="text-[10.5px] font-bold text-violet-200">
        {"⚛️ بهینه‌ساز کوانتومی از "}
        <span className="mono-num" dir="ltr">{faNum(45)}</span>
        {" ترکیب: ["}
        <span className="mono-num font-black text-white" dir="ltr">{pair}</span>
        {"] • پوشش مونت‌کارلو: "}
        <span className="mono-num text-emerald-300" dir="ltr">{faNum(((qql?.unionProb ?? 0) * 100).toFixed(1))}٪</span>
        {" • ناحیه برد دوبل: "}
        <span className="mono-num text-amber-300" dir="ltr">{faNum(((qql?.doubleWinProb ?? 0) * 100).toFixed(1))}٪</span>
      </span>
    </div>
  );
}

/** 🧠 the AI RCA & QQL trace box on every flashcard (v12 §3-2 — verbatim format) */
function QqlTraceBox({ qql }: { qql?: QqlDecision }) {
  if (!qql || !qql.ok) return null;
  const fired = qql.rca.filter((r) => r.fired);
  return (
    <div className="rounded-xl border border-white/12 bg-black/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-black text-white">
          🧠 تحلیل ریشه‌ای و کوئری انتخاب تیپ (AI RCA &amp; QQL Trace)
        </span>
        <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 text-[9.5px] text-emerald-300">
          {"از "}
          <span className="mono-num" dir="ltr">{faNum(qql.evaluated)}</span>
          {" ترکیب — "}
          <span className="mono-num" dir="ltr">{faNum(qql.gatePassedCount)}</span>
          {" عبور از فیلتر طلایی"}
        </Badge>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-white/85">{qql.traceFa}</p>
      {fired.length > 0 && (
        <div className="mt-2 space-y-1">
          {fired.map((r) => (
            <div
              key={r.code}
              className="rounded-lg border border-amber-300/25 bg-amber-300/[0.07] px-2.5 py-1.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <BadgeCheck className="h-3 w-3 shrink-0 text-amber-300" />
                <span className="mono-num text-[9.5px] font-bold text-amber-200" dir="ltr">
                  {r.code}
                </span>
                {r.steer && (
                  <span className="mono-num text-[9.5px] text-emerald-300" dir="ltr">
                    steer → {r.steer}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[10px] leading-4 text-white/70">{r.noteFa}</p>
            </div>
          ))}
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-cyan-300/80 hover:text-cyan-200">
          💻 مشاهده کوئری اجراشده QQL
        </summary>
        <p className="mt-1.5 rounded-lg border border-white/10 bg-black/40 p-2 text-[9.5px] leading-4 text-white/70">
          {qql.queryFa}
        </p>
        <p className="mono-num mt-1 text-[9px] leading-4 text-white/50" dir="ltr">
          {qql.traceEn}
        </p>
      </details>
    </div>
  );
}

// ─── v5.0 regime-aware badges row (crown + pipeline + regime) ─────────────

function RegimeBadges({ item }: { item: LineItem }) {
  if (!item.crown || !item.regime) return null;
  return (
    <div className="mt-3 space-y-2">
      <CrownBadge crown={item.crown} />
      {item.pipeline && <PipelineBarV5 item={item} />}
      <div className="flex flex-wrap items-center gap-2">
        <RegimeChip regime={item.regime} />
        <ArchBadge item={item} />
      </div>
    </div>
  );
}

// ─── v4.0 Tab-DUAL flashcard: one card per match, Type A + Type B boxes ────

function DualFlashcard({ pair }: { pair: { A: LineItem; B: LineItem } }) {
  const { A, B } = pair;
  const matchLabel = `${A.playerA} × ${A.playerB}`;
  const isComboRegime = A.regime?.code === "COMBO";
  return (
    <TiltCard className="rise-in rounded-2xl border border-white/12 bg-white/[0.03]">
      <div className="p-4">
        <FlashHeader item={A} matchLabel={matchLabel} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ArchBadge item={A} />
          <OverlapGateChip item={A} />
        </div>
        <V5Panel item={A} />
        {/* v12 — the ⚛️ quantum pattern code + 🧠 RCA & QQL trace of this match */}
        <div className="mt-3 space-y-2">
          <QuantumPatternLine qql={A.qql} />
          <QqlTraceBox qql={A.qql} />
        </div>
        <div className="mt-3 space-y-2.5">
          <MarketBox
            tone="A"
            wingLabel={isComboRegime ? "تیپ اصلی — دکمه رسمی کمبو" : "تیپ A — دکمه رسمی سایت بت"}
            item={A}
          />
          <MarketBox
            tone="B"
            wingLabel={isComboRegime ? "پوشش رسمی مکمل" : "تیپ B — دکمه مکمل رسمی"}
            item={B}
          />
        </div>
        {A.regime?.code === "COMBO" && (
          <div className="mt-2.5 rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-2.5 text-center">
            <span className="text-[11px] font-bold text-cyan-200">
              پوشش مشترک تیپ اصلی + پوشش در ۱۰,۰۰۰ شبیه‌سازی: {" "}
              <span className="mono-num">
                {(((A.regime.coverage ?? 0) * 100)).toFixed(1)}%
              </span>
            </span>
          </div>
        )}
        {/* v6.0 — live 1xBet odds calibrator (director enters the real board odds) */}
        <OddsCalibrator
          legA={{
            label: isComboRegime ? "تیپ اصلی" : "تیپ A",
            labelEn: isComboRegime ? "COMBO MAIN" : "TYPE A",
            modelOdds: A.odds,
            marketEn: A.marketEn,
            eventKey: A.eventKey,
            leg: A.leg,
          }}
          legB={{
            label: isComboRegime ? "پوشش مکمل" : "تیپ B",
            labelEn: isComboRegime ? "COVER" : "TYPE B",
            modelOdds: B.odds,
            marketEn: B.marketEn,
            eventKey: B.eventKey,
            leg: B.leg,
          }}
          matchLabel={matchLabel}
        />
        <FlashFooter item={A} matchLabel={matchLabel} />
      </div>
    </TiltCard>
  );
}

// ─── v5.0 REGCOMBO card: main + cover wings of one match ────────────────────

function RegComboCard({ pair }: { pair: { main: LineItem; cover: LineItem } }) {
  const { main, cover } = pair;
  const matchLabel = `${main.playerA} × ${main.playerB}`;
  return (
    <TiltCard className="rise-in rounded-2xl border border-violet-400/25 bg-violet-400/[0.04]">
      <div className="p-4">
        <FlashHeader item={main} matchLabel={matchLabel} />
        <V5Panel item={main} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <OverlapGateChip item={main} />
        </div>
        {/* v12 — the ⚛️ quantum pattern line + 🧠 RCA & QQL trace (family F6) */}
        <div className="mt-3 space-y-2">
          <QuantumPatternLine combo />
          <QqlTraceBox qql={main.qql} />
        </div>
        <div className="mt-3 space-y-2.5">
          <MarketBox tone="violet" wingLabel="کمبوی رسمی تک‌دکمه (تیپ اصلی)" item={main} />
          <MarketBox tone="emerald" wingLabel="پوشش رسمی مکمل (Cover)" item={cover} />
        </div>
        {/* v6.0 — live 1xBet calibrator on the copula combo pair */}
        <OddsCalibrator
          legA={{ label: "تیپ اصلی", labelEn: "COMBO MAIN", modelOdds: main.odds, marketEn: main.marketEn, eventKey: main.eventKey, leg: main.leg }}
          legB={{ label: "پوشش مکمل", labelEn: "COVER", modelOdds: cover.odds, marketEn: cover.marketEn, eventKey: cover.eventKey, leg: cover.leg }}
          matchLabel={matchLabel}
        />
        <FlashFooter item={main} matchLabel={matchLabel} />
      </div>
    </TiltCard>
  );
}

// ─── Near-gate strip: live 3-archetype candidacy for unapproved matches ────

function NearGateStrip({ matches }: { matches: AnalyzedMatch[] }) {
  const candidates = useMemo(() => {
    return matches
      .filter((m) => m.state !== "post" && !m.veto.vetoed)
      .slice(0, 40)
      .map((m) => {
        const fav = m.favorite;
        const hold = fav === "A" ? m.markov.gA : m.markov.gB;
        const sFav = fav === "A" ? m.markov.setWinA : 1 - m.markov.setWinA;
        const best = [...(m.archEvals ?? [])]
          .filter((e) => e.eligible)
          .sort((a, b) => a.pairLoss - b.pairLoss)[0];
        const anyWindow = (m.archEvals ?? []).some((e) => e.eligible);
        return { m, hold, sFav, best, anyWindow };
      })
      .filter((c) => !c.best)
      .sort((a, b) => a.sFav - b.sFav)
      .slice(0, 4);
  }, [matches]);

  if (candidates.length === 0) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-xs font-bold text-white/80">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
        کاندیدهای زیر ذره‌بین سوپروایزر (ارزیابی زنده ۳ الگو)
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {candidates.map(({ m, hold, sFav }) => (
          <div key={m.eventKey} className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold">
                <SurfaceDot surface={m.surface} />{" "}
                {m.favorite === "A" ? m.playerA.name : m.playerB.name}
                <span className="text-muted-foreground"> × {m.favorite === "A" ? m.playerB.name : m.playerA.name}</span>
              </span>
              <span className="mono-num text-[10px] text-muted-foreground">{m.tournament.slice(0, 16)}</span>
            </div>
            <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="w-24">S_fav</span>
                <div className="h-1.5 flex-1 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-cyan-400"
                    style={{ width: `${Math.min(100, (sFav / 0.9) * 100)}%` }}
                  />
                </div>
                <span className="mono-num">{(sFav * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-24">Hold fav</span>
                <div className="h-1.5 flex-1 rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${hold >= 0.84 ? "bg-emerald-400" : "bg-amber-400"}`}
                    style={{ width: `${Math.min(100, (hold / 0.95) * 100)}%` }}
                  />
                </div>
                <span className={`mono-num ${hold >= 0.84 ? "text-emerald-300" : ""}`}>{Math.round(hold * 100)}%</span>
              </div>
              <p className="pt-0.5 leading-4 text-muted-foreground/80">
                خارج از پنجره الگوها — پنجره رقابتی{" "}
                <span className="mono-num">54% ≤ S_A &lt; 64%</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── v10 · Overlap-gate chip (the golden filter verdict on every card) ──────

function OverlapGateChip({ item }: { item: LineItem }) {
  const overlap = item.regime?.overlap;
  const pattern = item.regime?.pattern;
  if (!overlap && !pattern) return null;
  const spec = pattern ? OVERLAP_PATTERNS[pattern] : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="gap-1 border-emerald-400/40 bg-emerald-400/10 text-[10px] font-bold text-emerald-200"
          dir="ltr"
        >
          ✅ POSITIVE OVERLAP
          {spec ? ` · ${spec.code}` : ""}
          {overlap ? ` · NET +${overlap.netReturnPct.toFixed(1)}%` : ""}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[340px] text-[11px] leading-5">
        <div className="font-bold">فیلتر ضریب همپوشانی مثبت — تایید سوپروایزر</div>
        {spec && (
          <p className="mt-1">
            {spec.labelFa} — {spec.hookFa}
          </p>
        )}
        {overlap && (
          <p className="mono-num mt-1" dir="ltr">
            impliedOverlapSum {overlap.impliedSum.toFixed(3)} ≤ 0.865 · effectiveOdds{" "}
            {overlap.effectiveOdds.toFixed(2)}x · netOverlapReturn +
            {overlap.netReturnPct.toFixed(1)}% ≥ +15.5%
          </p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">
          هر برد این پکیج حداقل +۱۵.۵٪ سود خالص تضمین‌شده دارد؛ الگوهای بدون همپوشانی مثبت
          توسط سوپروایزر وتو و هرگز وارد بانک نمی‌شوند.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── v10 Production lines (TWO peak tabs + the veto appendix) ────────────────
// TAB 1 · ⚖️ DUAL-HEDGE golden pair — patterns P1 (Set Mastery 57.6/42.4),
//          P2 (Double-Win 56/44 with the both-wins jackpot zone) and P3
//          (Exact Set Split 60/40) — every package a gated 100-unit bet.
// TAB 2 · 🧩 COPULA COMBO + COVER — the second allowed package form.
// The BANKER / DEEP SINGLE / MIX / ACCA / CLUSTER / SNIPER lines are RETIRED
// by the v10 mandate (the −1,029.92u drop era) and can never produce a card.

export function ProductionLines({
  feed,
  ledger,
}: {
  feed: FeedPayload;
  /** v13.0 — the ledger payload drives the Loss-Avoided counterfactual box */
  ledger?: LedgerPayload;
}) {
  const { dual, regCombo, shadow } = feed.lines;

  // ⚖️ group the DUAL wings into ONE package per match (iron rule: 1 match =
  // 1 package = 1 row; the render shows both wings side by side)
  const dualPairs = useMemo(() => {
    const byMatch = new Map<string, LineItem[]>();
    for (const it of dual) {
      const arr = byMatch.get(it.matchId) ?? [];
      arr.push(it);
      byMatch.set(it.matchId, arr);
    }
    return [...byMatch.values()]
      .map((legs) => ({
        A: legs.find((l) => l.meta?.includes('"dualA"')) ?? legs[0],
        B: legs.find((l) => l.meta?.includes('"dualB"')) ?? legs[legs.length - 1],
      }))
      .filter((p) => p.A && p.B);
  }, [dual]);

  const comboPairs = useMemo(() => {
    const byMatch = new Map<string, { main: LineItem; cover: LineItem }>();
    for (const it of regCombo) {
      const prev = byMatch.get(it.matchId);
      const isMain = it.leg.includes("MAIN") || !!it.meta?.includes("regComboMain");
      if (isMain) {
        byMatch.set(it.matchId, { main: it, cover: prev?.cover ?? it });
      } else {
        byMatch.set(it.matchId, { main: prev?.main ?? it, cover: it });
      }
    }
    return [...byMatch.values()].filter((p) => p.main && p.cover);
  }, [regCombo]);

  // v2.0 bug fix — the shadow ledger is grouped ONE row per match
  const shadowGroups = useMemo(() => {
    const first = dedupeByKey(
      [...shadow].sort((a, b) => a.matchId.localeCompare(b.matchId)),
      (s) => s.matchId
    );
    return first.slice(0, 12);
  }, [shadow]);

  const defaultTab = dualPairs.length > 0 ? "dual" : comboPairs.length > 0 ? "combo" : "shadow";
  const overlapVetoes = shadowGroups.filter((s) => s.meta?.includes("OVERLAP") || s.desc.includes("همپوشانی")).length;

  return (
    <section aria-label="خطوط تولید" className="space-y-4">
      <Card className="spatial-card rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <Layers className="h-4 w-4 text-amber-300" />
            خطوط تولید سیگنال — نسخه ۱۰.۰ (بازگشت به معماری قله زوج‌تیپ همپوشان · فیلتر ضریب همپوشانی مثبت · استیک استاندارد ۱۰۰ واحدی)
            <span className="text-[11px] font-normal text-muted-foreground">
              — خط لوله مارکوف ← کاپولا ← مونت‌کارلو ۱۰هزارتایی ← دروازه سوپروایزر + فیلتر همپوشانی مثبت · خروجی امروز:{" "}
              {dualPairs.length} زوج‌تیپ همپوشان · {comboPairs.length} کمبوی کاپولا · {overlapVetoes} وتو همپوشانی · {shadow.length} وتو
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={defaultTab}>
            <TabsList className="grid w-full grid-cols-3 gap-1 bg-white/5">
              <TabsTrigger value="dual" className="gap-1.5 text-xs">
                <Layers className="h-3.5 w-3.5" /> زوج‌تیپ همپوشان
              </TabsTrigger>
              <TabsTrigger value="combo" className="gap-1.5 text-xs">
                <ShieldCheck className="h-3.5 w-3.5" /> کمبو + پوشش
              </TabsTrigger>
              <TabsTrigger value="shadow" className="gap-1.5 text-xs">
                <ShieldAlert className="h-3.5 w-3.5" /> وتوی سوپروایزر
              </TabsTrigger>
            </TabsList>

            {/* ── Tab 1 · ⚖️ DUAL-HEDGE — the champion golden pair (100u package) ── */}
            <TabsContent value="dual" className="mt-4 space-y-3">
              <div className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                  <Layers className="h-4 w-4" />
                  تب ۱ — زوج‌تیپ طلایی همپوشان (Peak Dual-Hedge — معماری قله ۲,۴۴۵+ واحدی)
                  <span className="mono-num text-[10px] font-normal text-amber-200/70" dir="ltr">
                    P1 57.6/42.4 · P2 56/44 DOUBLE-WIN · P3 60/40 · NET +15.5%..+32u EVERY WIN
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  هر بازی فقط و فقط یک پکیج ۱۰۰ واحدی همپوشانی: الگوی ۱ (برد ۲-۰ فاوریت + بالای ۲.۵ ست)،
                  الگوی ۲ (برد ۲-۰ + بالای ۲۰.۵ گیم با ناحیه برد دوبل همزمان) یا الگوی ۳ (تفکیک دقیق ست ۲-۰ / ۲-۱).
                  فقط بازی‌های دارای ضریب همپوشانی مثبت (سود خالص هر برد ≥ +۱۵.۵٪ و شارپ ≥ ۰.۲۵) تایید می‌شوند.
                </div>
              </div>
              {dualPairs.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
                  امروز هیچ بازی‌ای ضریب همپوشانی مثبت (سود خالص ≥{" "}
                  <span className="mono-num">+15.5%</span> و مجموع معکوس ضرایب ≤{" "}
                  <span className="mono-num">0.865</span>) نداشت — 🚫 وتوی سوپروایزر: هیچ پکیجی وارد بانک نمی‌شود.
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {dualPairs.map((pair) => (
                    <DualFlashcard key={`${pair.A.matchId}-${pair.A.leg}`} pair={pair} />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Tab 2 · 🧩 COPULA COMBO + COVER (the second allowed package) ── */}
            <TabsContent value="combo" className="mt-4 space-y-3">
              <div className="rounded-xl border border-violet-400/25 bg-violet-400/[0.06] px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-violet-300">
                  <ShieldCheck className="h-4 w-4" />
                  تب ۲ — کمبوی کاپولا + پوشش رسمی مکمل (Copula Combo + Cover)
                  <span className="mono-num text-[10px] font-normal text-violet-200/70" dir="ltr">
                    main + disjoint cover · dutching 100u · NET ≥ +15.5%
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  دومین قالب مجاز بانک: تیپ اصلی + پوشش مکمل به‌هم‌نمی‌بازند (فضای باخت همزمان دقیق از
                  مونت‌کارلو) — همان قانون ۱۰۰ واحدی و همان فیلتر ضریب همپوشانی مثبت.
                </div>
              </div>
              {comboPairs.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
                  امروز هیچ کمبوی کاپولای واجد فیلتر همپوشانی مثبت صادر نشد — پکیج بدون تایید سوپروایزر
                  ساخته نمی‌شود.
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {comboPairs.map((pair) => (
                    <RegComboCard key={`${pair.main.matchId}-${pair.main.leg}`} pair={pair} />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Tab 3 · 🛡️ THE SUPERVISOR VETO LEDGER (honesty appendix) ── */}
            <TabsContent value="shadow" className="mt-4 space-y-3">
              {/* v13.0 §4 — the mandated LOSS-AVOIDED summary box (formula fix) */}
              {(() => {
                const sh = ledger?.groups?.find((g) => g.line === "SHADOW");
                if (!sh) return null;
                return (
                  <div
                    className={cn(
                      "rounded-xl border px-3.5 py-2.5",
                      sh.profit < 0
                        ? "border-emerald-300/25 bg-emerald-300/[0.06]"
                        : "border-white/10 bg-white/[0.03]"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-emerald-300">
                      <ShieldAlert className="h-4 w-4" />
                      🛡️ زیان جلوگیری‌شده در دفتر سایه (Loss Avoided by Supervisor Veto):{" "}
                      <span className="mono-num" dir="ltr">
                        {sh.profit.toFixed(1)} واحد
                      </span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        (اثبات کارایی فیلتر سوپروایزر — هر برد وتوشده +۱۸واحد و هر باخت وتوشده −۱۰۰واحد پکیج استاندارد حساب می‌شود)
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {sh.won} برد و {sh.lost} باخت وتوشده · {sh.pending} در انتظار — این زیان هرگز به بانک اصلی راه نمی‌یابد؛
                      فیلتر سوپروایزر (تاپ-۱۰۰ + ضریب همپوشانی مثبت) دقیقاً همین ضرر را از دفترکل دور نگه داشته است.
                    </div>
                  </div>
                );
              })()}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  🛡️ دفتر وتو سوپروایزر — ({shadow.length} تیپ وتوشده امروز، بدون احتساب وین‌ریت و بانک)
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  «🚫 وتوی سوپروایزر — عدم وجود ضریب همپوشانی مثبت» بازی‌هایی که هیچ‌یک از الگوها در
                  آن‌ها سود خالص تضمین‌شده ≥ +۱۵.۵٪ نمی‌دهد — هرگز وارد کارنامه و بانک نمی‌شوند. نسخه ۱۳:
                  فیلتر تاپ-۱۰۰ نیز به‌صورت بازگشت‌به‌عقب روی تاریخچه تسویه‌شده اعمال شد و بازی‌های رده‌پایین
                  WTA 125K به همین دفتر منتقل شدند.
                </div>
              </div>
              <div className="scroll-slim grid max-h-72 gap-1.5 overflow-y-auto">
                {shadowGroups.map((s) => (
                  <div key={s.matchId} className="rounded-lg border border-white/5 px-2.5 py-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${SURFACE_DOT[s.surface]}`} />
                      <span className="truncate text-white/70">{s.playerA.split(" ").pop()} × {s.playerB.split(" ").pop()}</span>
                      <span className="mono-num ms-auto shrink-0 text-[10px] text-white/40">{s.tournament}</span>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-rose-300/80" dir="rtl">{s.desc}</p>
                  </div>
                ))}
                {shadow.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center text-xs text-muted-foreground">
                    امروز هیچ وتویی ثبت نشده است.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </section>
  );
}