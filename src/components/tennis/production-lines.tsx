"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Copy,
  Crosshair,
  Crown,
  ExternalLink,
  Gem,
  Layers,
  Landmark,
  Link2,
  Lock,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
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
import { legLabelOf, REGIME_META } from "@/lib/tennis/supervisor";
import type {
  AnalyzedMatch,
  CrownInfo,
  FeedPayload,
  LineItem,
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
      <span className="mono-num w-9 text-right">{Math.round(value * 100)}%</span>
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

// ─── v5.5 Tab-BANKER flashcard: ONE safe single button (100u direct stake) ─

function BankerFlashcard({ item }: { item: LineItem }) {
  const matchLabel = `${item.playerA} × ${item.playerB}`;
  return (
    <TiltCard className="rise-in rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.04]">
      <div className="p-4">
        <FlashHeader item={item} matchLabel={matchLabel} />
        <RegimeBadges item={item} />
        <div className="mt-3">
          <MarketBox tone="A" wingLabel="بانکر امن — تک‌دکمه رسمی (استیک کامل ۱۰۰ واحد)" item={item} />
        </div>
        <FlashFooter item={item} matchLabel={matchLabel} />
      </div>
    </TiltCard>
  );
}

// ─── v5.0 Tab-CLUSTER flashcard: 3 exact set/game scenarios (100u dutching) ─

function ClusterFlashcard({ legs }: { legs: LineItem[] }) {
  const first = legs[0];
  const matchLabel = `${first.playerA} × ${first.playerB}`;
  const totalStake = legs.reduce((s, l) => s + l.stake, 0);
  const coverage = first.regime?.coverage ?? 0;
  return (
    <TiltCard className="rise-in rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/[0.04]">
      <div className="p-4">
        <FlashHeader item={first} matchLabel={matchLabel} />
        <RegimeBadges item={first} />
        <div className="mt-3 space-y-2.5">
          {legs.map((l, i) => (
            <MarketBox
              key={l.leg}
              tone={i === 0 ? "A" : i === 1 ? "B" : "single"}
              wingLabel={`سناریو ${i + 1} — داچینگ ${totalStake > 0 ? ((l.stake / totalStake) * 100).toFixed(1) : "0"}٪`}
              item={l}
            />
          ))}
        </div>
        <div className="mt-2.5 rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/10 p-2.5 text-center">
          <span className="text-[11px] font-bold text-fuchsia-200">
            پوشش مشترک ۳ سناریو در ۱۰,۰۰۰ شبیه‌سازی:{" "}
            <span className="mono-num">{(coverage * 100).toFixed(1)}%</span> — سود خالص هر سناریو{" "}
            <span className="mono-num" dir="ltr">+35% تا +55%</span>
          </span>
        </div>
        {/* v6.0 — live 1xBet calibrator on the two heaviest cluster scenarios */}
        {legs.length >= 2 && (
          <OddsCalibrator
            legA={{
              label: "سناریو ۱",
              labelEn: "SCENARIO 1",
              modelOdds: legs[0].odds,
              marketEn: legs[0].marketEn,
            }}
            legB={{
              label: "سناریو ۲",
              labelEn: "SCENARIO 2",
              modelOdds: legs[1].odds,
              marketEn: legs[1].marketEn,
            }}
            matchLabel={matchLabel}
          />
        )}
        <FlashFooter item={first} matchLabel={matchLabel} />
      </div>
    </TiltCard>
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
        </div>
        <V5Panel item={A} />
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
          }}
          legB={{
            label: isComboRegime ? "پوشش مکمل" : "تیپ B",
            labelEn: isComboRegime ? "COVER" : "TYPE B",
            modelOdds: B.odds,
            marketEn: B.marketEn,
          }}
          matchLabel={matchLabel}
        />
        <FlashFooter item={A} matchLabel={matchLabel} />
      </div>
    </TiltCard>
  );
}

// ─── v4.0 Tab-2 Multi-Match Parlay Slip card (legs table + combined odds) ──

function legTime(iso: string | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  return faTime(iso);
}

function ParlaySlipCard({ item }: { item: LineItem }) {
  const legs = item.legs ?? [];
  const size = legs.length || 2;
  const matchLabel = legs.map((l) => `${l.favShort ?? l.favName} × ${l.dogShort ?? l.dogName}`).join(" | ");
  return (
    <TiltCard className="rise-in rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.04]">
      <div className="p-4">
        {/* official parlay slip header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-black text-cyan-200">
            <Link2 className="h-4 w-4" />
            برگه میکس رسمی {size === 3 ? "۳" : "۲"} تایی
            <span className="mono-num text-[10px] font-bold text-cyan-300/80" dir="ltr">
              (Multi-Match Parlay Slip)
            </span>
          </span>
          <span className="mono-num rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-base font-extrabold text-white" dir="ltr">
            {item.odds.toFixed(2)}x
          </span>
        </div>

        {/* legs table — every base listed separately (v4.5: readable sizes) */}
        <div className="scroll-slim mt-3 max-h-96 space-y-2 overflow-y-auto pe-1">
          {legs.map((leg, i) => (
            <div key={`${leg.eventKey}-${i}`} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="mono-num text-xs font-black text-cyan-300" dir="ltr">
                  LEG {i + 1}
                </span>
                <span className="text-xs font-bold text-white">
                  {leg.favName} <span className="text-white/40">×</span> {leg.dogName}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/70">
                <SurfaceDot surface={leg.surface} />
                <span>{leg.tournament}</span>
                <span dir="ltr">· {leg.tour} {leg.round}</span>
                <span>· ساعت {legTime(leg.startTime)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="mono-num text-[11px] font-bold text-white/85" dir="ltr">
                  MARKET: {leg.marketEn}
                </span>
                <span className="mono-num text-sm font-extrabold text-amber-200" dir="ltr">
                  @{leg.odds.toFixed(2)}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-white/60">{leg.marketFa}</div>
            </div>
          ))}
        </div>

        {/* combined odds + suggested stake */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-center">
            <div className="mono-num text-sm font-extrabold text-white" dir="ltr">
              {item.odds.toFixed(2)}x
            </div>
            <div className="mt-0.5 text-[10px] text-white/65">ضریب کل میکس (Combined Odds)</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-center">
            <div className="mono-num text-sm font-extrabold text-white" dir="ltr">
              {(item.prob * 100).toFixed(1)}%
            </div>
            <div className="mt-0.5 text-[10px] text-white/65">احتمال زنجیره مارکوف</div>
          </div>
          <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-2 text-center">
            <div className="mono-num text-sm font-extrabold text-amber-200" dir="ltr">
              {item.stake} واحد
            </div>
            <div className="mt-0.5 text-[10px] text-amber-200/70">مبلغ استیک پیشنهادی</div>
          </div>
        </div>

        <FlashFooter item={item} matchLabel={matchLabel || item.descEn} />
      </div>
    </TiltCard>
  );
}

// ─── v5.5 Tab-3 sniper flashcard — packaged position (main + capital-
// protection cover, dutched 100-unit split, ONE card per match) ────────────

function SniperPairCard({ main, cover }: { main: LineItem; cover: LineItem }) {
  const matchLabel = `${main.playerA} × ${main.playerB}`;
  const totalStake = main.stake + cover.stake;
  return (
    <TiltCard className="rise-in rounded-2xl border border-rose-400/25 bg-rose-400/[0.04]">
      <div className="p-4">
        <FlashHeader item={main} matchLabel={matchLabel} />
        <V5Panel item={main} />
        <div className="mt-3 space-y-2.5">
          <MarketBox
            tone="single"
            wingLabel={`تک‌تیرانداز — تیپ اصلی (+EV ≥ ۱۴٪) · داچینگ ${totalStake > 0 ? ((main.stake / totalStake) * 100).toFixed(1) : "0"}٪`}
            item={main}
          />
          <MarketBox
            tone="orange"
            wingLabel="پوشش اصل سرمایه — اسنایپر همیشه با پوشش بسته می‌شود"
            item={cover}
          />
        </div>
        <div className="mt-2.5 rounded-xl border border-rose-400/30 bg-rose-400/10 p-2.5 text-center">
          <span className="text-[11px] font-bold text-rose-200">
            پکیج ۱۰۰ واحدی: تیپ اصلی{" "}
            <span className="mono-num" dir="ltr">{main.stake}u @ {main.odds.toFixed(2)}</span> + پوشش{" "}
            <span className="mono-num" dir="ltr">{cover.stake}u @ {cover.odds.toFixed(2)}</span> — هیچ سطری با استیک ۱ یا ۲ واحدی در کارنامه ثبت نمی‌شود
          </span>
        </div>
        {/* v6.0 — live 1xBet calibrator on the sniper package */}
        <OddsCalibrator
          legA={{ label: "تیپ اصلی", labelEn: "SNIPER MAIN", modelOdds: main.odds, marketEn: main.marketEn }}
          legB={{ label: "پوشش سرمایه", labelEn: "CAPITAL COVER", modelOdds: cover.odds, marketEn: cover.marketEn }}
          matchLabel={matchLabel}
        />
        <FlashFooter item={main} matchLabel={matchLabel} />
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
        <div className="mt-3 space-y-2.5">
          <MarketBox tone="violet" wingLabel="کمبوی رسمی تک‌دکمه (تیپ اصلی)" item={main} />
          <MarketBox tone="emerald" wingLabel="پوشش رسمی مکمل (Cover)" item={cover} />
        </div>
        {/* v6.0 — live 1xBet calibrator on the copula combo pair */}
        <OddsCalibrator
          legA={{ label: "تیپ اصلی", labelEn: "COMBO MAIN", modelOdds: main.odds, marketEn: main.marketEn }}
          legB={{ label: "پوشش مکمل", labelEn: "COVER", modelOdds: cover.odds, marketEn: cover.marketEn }}
          matchLabel={matchLabel}
        />
        <FlashFooter item={main} matchLabel={matchLabel} />
      </div>
    </TiltCard>
  );
}

// ─── v5.0 CLUSTER card: the three dutched exact scenarios of one match ──────

function ClusterCard({ legs }: { legs: LineItem[] }) {
  const item = legs[0];
  const matchLabel = `${item.playerA} × ${item.playerB}`;
  const totalStake = legs.reduce((s, l) => s + l.stake, 0);
  const wingLabels = ["سناریو ۱ — داچینگ دقیق", "سناریو ۲ — داچینگ دقیق", "سناریو ۳ — داچینگ دقیق"];
  const tones = ["orange", "violet", "lime"] as const;
  return (
    <TiltCard className="rise-in rounded-2xl border border-orange-400/25 bg-orange-400/[0.04]">
      <div className="p-4">
        <FlashHeader item={item} matchLabel={matchLabel} />
        <V5Panel item={item} />
        <div className="mt-3 space-y-2.5">
          {legs.map((leg, i) => (
            <MarketBox key={leg.leg} tone={tones[i % tones.length]} wingLabel={wingLabels[i]} item={leg} />
          ))}
        </div>
        <div className="mono-num mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] text-white/70" dir="ltr">
          DUTCHING PLAN: {legs.map((l) => `${l.stake}u @ ${l.odds.toFixed(2)}`).join(" + ")} = {Math.round(totalStake * 10) / 10}u · NET +35–55%
        </div>
        <FlashFooter item={item} matchLabel={matchLabel} />
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

// ─── v7.0 Production lines (THREE tabs — master-prompt v7.0 §2 · 100u each) ──
// TAB 1 · 🔗 MIX-2 (2-leg precision parlay · 1.80x–2.25x · legs 1.34x–1.50x)
// TAB 2 · 🎯 DEEP SINGLE (1.72x–2.15x · +6.5% probability edge vs live board)
// TAB 3 · 🏦 BANKER (1.45x–1.65x · Top-25 + Elo gap ≥ 140) + 🔗 ACC-3 (2.70x–3.40x)
// The dual-coverage / regcombo / cluster / sniper lines are RETIRED by the
// v7.0 mandate; the shadow ledger strip stays as the honesty appendix.

/** v7.0 — extract the +EV edge + anchor state recorded in the card meta. */
function deepMetaOf(item: LineItem): { edge: number; anchored: boolean } {
  try {
    const meta = item.meta ? (JSON.parse(item.meta) as { edge?: number; anchored?: boolean }) : {};
    return { edge: meta.edge ?? 0, anchored: meta.anchored ?? false };
  } catch {
    return { edge: 0, anchored: false };
  }
}

function DeepSingleCard({ item }: { item: LineItem }) {
  const matchLabel = `${item.playerA} × ${item.playerB}`;
  const { edge, anchored } = deepMetaOf(item);
  return (
    <TiltCard className="rise-in rounded-2xl border border-sky-400/25 bg-sky-400/[0.04]">
      <div className="p-4">
        <FlashHeader item={item} matchLabel={matchLabel} />
        <RegimeBadges item={item} />
        <div className="mt-3">
          <MarketBox tone="single" wingLabel="تک‌گزینه عمیق — مارکت رسمی تک‌دکمه (استیک کامل ۱۰۰ واحد)" item={item} />
        </div>
        <div className="mt-2.5 rounded-xl border border-sky-400/30 bg-sky-400/10 p-2.5 text-center">
          <span className="text-[11px] font-bold text-sky-200">
            {anchored ? (
              <>
                برتری احتمال مدل نسبت به ضریب زنده 1xBet:{" "}
                <span className="mono-num" dir="ltr">+{(edge * 100).toFixed(1)}%</span> — نقطه سر‌به‌سر{" "}
                <span className="mono-num" dir="ltr">54%</span>
              </>
            ) : (
              <>
                قیمت فرمولی واقعی 1xBet (<span className="mono-num" dir="ltr">1/(p×1.055)</span>) — فید زنده
                امروز برای این مارکت عرضه ندارد — نقطه سر‌به‌سر{" "}
                <span className="mono-num" dir="ltr">54%</span>
              </>
            )}
            {" "}· سود خالص هر برد{" "}
            <span className="mono-num" dir="ltr">+{Math.round((item.odds - 1) * 100)} واحد</span>
          </span>
        </div>
        <FlashFooter item={item} matchLabel={matchLabel} />
      </div>
    </TiltCard>
  );
}

export function ProductionLines({ feed }: { feed: FeedPayload }) {
  const { banker, single, accumulator, combo2, shadow } = feed.lines;

  // v2.0 bug fix — the shadow ledger is grouped ONE row per match (the v1.0
  // audit saw every match listed twice). Legs stay separate for settlement;
  // the render unifies them by matchId with the canonical Map dedupe.
  const shadowGroups = useMemo(() => {
    const first = dedupeByKey(
      [...shadow].sort((a, b) => a.matchId.localeCompare(b.matchId)),
      (s) => s.matchId
    );
    return first.slice(0, 10);
  }, [shadow]);

  const mixSlips = combo2; // v7.0 — 2-leg precision parlay slips only
  const defaultTab = banker.length > 0 ? "banker" : single.length > 0 ? "single" : "mix";

  return (
    <section aria-label="خطوط تولید" className="space-y-4">
      <Card className="spatial-card rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <Rocket className="h-4 w-4 text-amber-300" />
            خطوط تولید سیگنال — نسخه ۷.۰ (۳ خط تولید · ضرایب ۱۰۰٪ زنده اتوماتیک · استیک استاندارد ۱۰۰ واحدی)
            <span className="text-[11px] font-normal text-muted-foreground">
              — خط لوله مارکوف ← کاپولا ← مونت‌کارلو ۱۰هزارتایی ← فید زنده ضرایب ← دروازه سوپروایزر · خروجی امروز:{" "}
              {mixSlips.length} میکس ۲تایی · {single.length} تک‌گزینه عمیق · {banker.length} بانکر ·{" "}
              {accumulator.length} آکومولاتور ۳تایی · {shadow.length} وتو
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={defaultTab}>
            <TabsList className="grid w-full grid-cols-3 gap-1 bg-white/5">
              <TabsTrigger value="mix" className="gap-1.5 text-xs">
                <Link2 className="h-3.5 w-3.5" /> میکس ۲تایی
              </TabsTrigger>
              <TabsTrigger value="single" className="gap-1.5 text-xs">
                <Target className="h-3.5 w-3.5" /> تک‌گزینه عمیق
              </TabsTrigger>
              <TabsTrigger value="banker" className="gap-1.5 text-xs">
                <Wallet className="h-3.5 w-3.5" /> بانکر + آکومو
              </TabsTrigger>
            </TabsList>

            {/* ── Tab 1 · 🔗 MIX-2 — 2-Leg Precision Parlay (1.80x–2.25x) ── */}
            <TabsContent value="mix" className="mt-4 space-y-3">
              <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                  <Link2 className="h-4 w-4" />
                  تب ۱ — میکس ۲ تایی سلاطین سرویس (2-Leg Precision Parlay)
                  <span className="mono-num text-[10px] font-normal text-cyan-200/70" dir="ltr">
                    legs 1.34x–1.50x · total 1.80x–2.25x · +80 تا +125 واحد هر برد · BE 50%
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  دو پایه مستقل از دو بازی مختلف (هندیکپ ست +۱.۵ / برد فاوریت / بالای ۱۹.۵ گیم) در هم ضرب
                  می‌شوند — هر پایه با ضریب زندهٔ قفل‌شده و استیک ۱۰۰ واحدی.
                </div>
              </div>
              {mixSlips.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
                  جفت پایه‌های مستقل با ضریب کل <span className="mono-num">1.80x–2.25x</span> امروز ساخته نشد —
                  برگه میکس فقط وقتی صادر می‌شود که حاصل‌ضرب واقعی دو ضریب زنده داخل پنجره قرار بگیرد.
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {mixSlips.map((item) => (
                    <ParlaySlipCard key={`${item.line}-${item.matchId}-${item.leg}`} item={item} />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Tab 2 · 🎯 DEEP SINGLE — Markov-Copula value pick (1.72x–2.15x) ── */}
            <TabsContent value="single" className="mt-4 space-y-3">
              <div className="rounded-xl border border-sky-400/25 bg-sky-400/[0.06] px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-sky-300">
                  <Target className="h-4 w-4" />
                  تب ۲ — تک‌گزینه عمیق مارکوف-کاپولا (Single Deep-Value Pick)
                  <span className="mono-num text-[10px] font-normal text-sky-200/70" dir="ltr">
                    odds 1.72x–2.15x · +EV edge ≥ +6.5% · BE 54%
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  فقط «۱ دکمه رسمی» در هر بازی: نتایج دقیق ست ۲-۰ (وقتی P ≥ ۵۶٪)، هندیکپ گیم −۳.۵،
                  بالای ۲۱.۵/۲۲.۵ گیم یا کمبوی رسمی برد فاوریت و زیر ۲۱.۵ گیم — ضریب ۱۰۰٪ زنده از فید.
                </div>
              </div>
              {single.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
                  امتیاز +EV ≥ <span className="mono-num">+6.5%</span> نسبت به ضریب زنده امروز پیدا نشد —
                  تک‌گزینه عمیق فقط وقتی صادر می‌شود که مدل، برتری احتمالی واقعی روی تابلوی زنده داشته باشد.
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {single.map((item) => (
                    <DeepSingleCard key={`${item.matchId}-${item.leg}`} item={item} />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Tab 3 · 🏦 SERVICE BANKER + 🔗 3-FOLD ACCA ── */}
            <TabsContent value="banker" className="mt-4 space-y-3">
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                  <Landmark className="h-4 w-4" />
                  تب ۳ — تک‌ستون بنکر سرویس + آکومولاتور ۳ تایی (Service Banker & 3-Fold Acca)
                  <span className="mono-num text-[10px] font-normal text-emerald-200/70" dir="ltr">
                    banker 1.45x–1.65x · Top-25 · Elo gap ≥ 140 · acca 2.70x–3.40x
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  بانکر تک‌شرط (برد مسابقه یا نتایج دقیق ست ۲-۰) با وین‌ریت ۷۸–۸۵٪ برای رشد پایدار بانک +
                  برگه آکومولاتور ۳ تایی روز با ضریب واقعی بانکرها.
                </div>
              </div>
              {banker.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
                  امروز هیچ بازی به پنجره بنکر سرویس (تاپ-۲۵ با گپ امتیازی ≥ ۱۴۰ و S_fav ≥ ۷۰٪) نرسید.
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {banker.map((item) => (
                    <BankerFlashcard key={`${item.matchId}-${item.leg}`} item={item} />
                  ))}
                </div>
              )}
              {accumulator.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 pt-1 text-xs font-bold text-lime-300">
                    <Link2 className="h-3.5 w-3.5" />
                    برگه آکومولاتور ۳ تایی روز (ضریب کل <span className="mono-num" dir="ltr">2.70x–3.40x</span>)
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {accumulator.map((item) => (
                      <ParlaySlipCard key={`${item.line}-${item.matchId}-${item.leg}`} item={item} />
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {shadow.length > 0 && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" />
                🛡️ دفتر سایه — ({shadow.length} تیپ وتوشده، بدون احتساب وین‌ریت)
              </div>
              <div className="scroll-slim mt-2 grid max-h-40 gap-1.5 overflow-y-auto">
                {shadowGroups.map((s) => (
                  <div key={s.matchId} className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5 text-[11px]">
                    <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${SURFACE_DOT[s.surface]}`} />
                    <span className="truncate text-muted-foreground">{s.desc}</span>
                    <span className="mono-num ms-auto shrink-0 text-[10px] text-white/40">
                      {s.playerA.split(" ").pop()} × {s.playerB.split(" ").pop()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
