"use client";

// ─── NeoTennis Markov Quant — Poster Studio (16-Bit Arcade, server-rendered) ─
// The heavy pixel-art/CRT rendering now lives in the always-warm
// telegram-agent service (browser-independent). This studio proxies the
// render, previews it and offers download + manual channel send with a full
// Persian caption.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Download, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { buildArcadeRequest, renderArcadePoster } from "@/lib/tennis/arcade";
import type { AnalyzedMatch } from "@/lib/tennis/types";

type SendTarget = "public" | "vip";

const SURFACE_ACCENT = {
  HARD: { text: "text-cyan-300", border: "border-cyan-400/30", dot: "bg-cyan-300" },
  CLAY: { text: "text-orange-300", border: "border-orange-400/30", dot: "bg-orange-300" },
  GRASS: { text: "text-emerald-300", border: "border-emerald-400/30", dot: "bg-emerald-300" },
} as const;

function safeFileNamePart(input: string): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned || "match";
}

/** Short Persian caption for manual sends (full captions live in the agent). */
function persianCaption(match: AnalyzedMatch, freeCard: boolean): string {
  const faNum = (n: number): string => n.toFixed(2).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
  const time = match.startTime
    ? new Date(match.startTime).toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Tehran",
      })
    : "نامشخص";
  const surface = match.surface === "HARD" ? "هارد" : match.surface === "CLAY" ? "خاک" : "چمن";
  const favName = match.favorite === "A" ? match.playerA.name : match.playerB.name;
  const slipA = match.slips.A;
  const slipB = match.slips.B;
  const lines = [
    "🅽🅴🅾🅱🅴🆃 | پوستر آرکید ۱۶-بیتی NeoBet",
    "",
    `🎾 ${match.playerA.name} × ${match.playerB.name}`,
    `🏆 ${match.tournament} — ${match.round}`,
    `⏰ شروع: ${time} (تهران) | سطح: ${surface}`,
    "",
  ];
  if (slipA) {
    lines.push(`🔹 تیپ A — ${slipA.marketFa ?? slipA.text} | ضریب ${faNum(slipA.odds)}`);
  }
  if (slipB) {
    lines.push(
      freeCard
        ? "🔒 تیپ B فقط در کانال VIP منتشر می‌شود."
        : `🔹 تیپ B — ${slipB.marketFa ?? slipB.text} | ضریب ${faNum(slipB.odds)}`
    );
  }
  lines.push(
    "",
    `⭐️ فاوریت مدل: ${favName} (احتمال ٪${Math.round(match.favWinProb)})`,
    match.hashPre ? `🔐 قفل SHA-256 پیش از بازی: ${match.hashPre.slice(0, 10).toUpperCase()}` : "",
    "🧭 انضباط اجرا: یک واحد ثابت روی هر تیپ؛ بدون چیس، بدون ورود خارج از تایمینگ.",
    "",
    "————————————————",
    "⚡️ کانال عمومی: @aineobet",
    "👑 کارت‌های کامل VIP: @aineobet_vip",
    "⚠️ +۱۸ | مسئولیت مالی با شماست."
  );
  return lines.filter((l) => l !== undefined).join("\n");
}

export interface PosterStudioProps {
  matches: AnalyzedMatch[]; // approved dual slips (production posters)
  allMatches?: AnalyzedMatch[]; // upcoming matches for review mode
  onSent?: () => void;
}

export default function PosterStudio({ matches, allMatches, onSent }: PosterStudioProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [freeCard, setFreeCard] = useState(false);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [pngB64, setPngB64] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [sending, setSending] = useState<SendTarget | null>(null);

  const pool = useMemo<AnalyzedMatch[]>(() => {
    if (freeCard) return matches;
    // merge without duplicate chips (approved matches also live in allMatches)
    const seen = new Set(matches.map((m) => m.eventKey));
    const extra = (allMatches ?? []).filter((m) => !seen.has(m.eventKey));
    return [...matches, ...extra];
  }, [matches, allMatches, freeCard]);
  const selectedMatch = useMemo<AnalyzedMatch | null>(
    () => pool.find((m) => m.eventKey === selectedKey) ?? pool[0] ?? null,
    [pool, selectedKey]
  );

  // render through the always-warm agent (server-side 16-bit engine)
  useEffect(() => {
    if (!selectedMatch) return;
    let cancelled = false;
    setDrawing(true);
    const controller = new AbortController();
    renderArcadePoster(buildArcadeRequest(selectedMatch, { freeCard }), controller.signal)
      .then(({ pngBase64 }) => {
        if (cancelled) return;
        setPngB64(pngBase64);
        setPngUrl(`data:image/png;base64,${pngBase64}`);
        setDrawing(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDrawing(false);
        setPngUrl(null);
        toast.error(
          err instanceof Error && err.message.includes("abort")
            ? "رندر لغو شد"
            : `سرویس پوستر آرکید در دسترس نیست — ${err instanceof Error ? err.message : "خطا"}`
        );
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedMatch, freeCard]);

  const handleDownload = useCallback(() => {
    if (!pngUrl || !selectedMatch) return;
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = `neobet-arcade-${safeFileNamePart(selectedMatch.playerA.shortName)}-${safeFileNamePart(
      selectedMatch.playerB.shortName
    )}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("پوستر دانلود شد");
  }, [pngUrl, selectedMatch]);

  const handleSend = useCallback(
    async (target: SendTarget) => {
      if (!pngB64 || sending !== null || !selectedMatch) return;
      setSending(target);
      try {
        const res = await fetch("/api/telegram/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: pngB64,
            target,
            caption: persianCaption(selectedMatch, freeCard),
          }),
        });
        const body: unknown = await res.json().catch(() => null);
        const err =
          typeof body === "object" && body !== null
            ? String((body as Record<string, unknown>).error ?? "")
            : "";
        if (!res.ok) {
          toast.error(err || `ارسال ناموفق بود (HTTP ${res.status})`);
          return;
        }
        toast.success(
          `پوستر ۱۶-بیتی به کانال ${target === "public" ? "عمومی" : "VIP"} با کپشن فارسی ارسال شد`
        );
        onSent?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "خطای ناشناخته در ارسال پوستر");
      } finally {
        setSending(null);
      }
    },
    [pngB64, sending, selectedMatch, freeCard, onSent]
  );

  if (!selectedMatch) {
    return (
      <Card dir="rtl" className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Sparkles className="size-6 text-cyan-300/70" />
          <p className="max-w-md text-sm leading-7 text-white/60">
            پوستر پس از تولید تیپ‌های سوپروایزر فعال می‌شود — دروازه طلایی امروز باز نشده است
          </p>
        </CardContent>
      </Card>
    );
  }

  const accent = SURFACE_ACCENT[selectedMatch.surface];
  const busy = drawing || sending !== null;

  return (
    <Card dir="rtl" className="gap-4 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base text-white">
          <Sparkles className="size-4 text-cyan-300" />
          استودیو پوستر — Retro 16-Bit Arcade
          <Badge variant="outline" className="border-amber-300/40 bg-amber-300/10 text-amber-200">
            موتور سمت سرور — بدون مرورگر
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs leading-6 text-white/50">
          پس‌زمینه پیکسل‌آرت + لایه CRT (اسکن‌لاین + وینیت) · هدر HUD با نشان ۱۶-بیت و INSERT COIN ·
          کلید مارکت لاتین‌سازی‌شده · فوتر جان/سکه پیکسلی — متن داخل تصویر ۱۰۰٪ انگلیسی، کپشن ارسالی ۱۰۰٪ فارسی
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Free-card teaser toggle */}
        <div className="flex items-center justify-between rounded-xl border border-emerald-300/20 bg-emerald-300/5 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <Crown className="size-4 text-emerald-300" />
            <div>
              <div className="text-xs font-bold text-emerald-300">حالت کارت رایگان (تیزر عمومی)</div>
              <div className="text-[10px] text-white/50">
                تیپ B قفل می‌شود — همان پوستری که هر روز ساعت ۱۰:۳۰ در کانال عمومی منتشر می‌شود
              </div>
            </div>
          </div>
          <Switch checked={freeCard} onCheckedChange={setFreeCard} aria-label="حالت کارت رایگان" />
        </div>

        {/* Match chips */}
        <div className="scroll-slim flex max-h-24 flex-wrap gap-2 overflow-y-auto">
          {pool.map((m) => {
            const active = m.eventKey === selectedMatch.eventKey;
            const chipAccent = SURFACE_ACCENT[m.surface];
            return (
              <button
                key={m.eventKey}
                type="button"
                onClick={() => setSelectedKey(m.eventKey)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? `${chipAccent.text} ${chipAccent.border} bg-white/10`
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.07] hover:text-white/80"
                )}
              >
                <span className={cn("size-2 shrink-0 rounded-full", chipAccent.dot)} />
                {m.playerA.shortName} × {m.playerB.shortName}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-start">
          {/* Server-rendered poster preview */}
          <div className="relative w-full max-w-[360px] shrink-0">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_40px_rgba(255,209,102,0.10)]">
              {pngUrl ? (
                <img
                  src={pngUrl}
                  alt={`پوستر آرکید ${selectedMatch.playerA.shortName} در برابر ${selectedMatch.playerB.shortName}`}
                  className="aspect-[3/4] w-full"
                />
              ) : (
                <div className="flex aspect-[3/4] w-full items-center justify-center">
                  {drawing ? (
                    <Loader2 className="size-6 animate-spin text-amber-300" />
                  ) : (
                    <RefreshCw className="size-6 text-white/30" />
                  )}
                </div>
              )}
            </div>
            {drawing ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50">
                <Loader2 className="size-6 animate-spin text-amber-300" />
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Badge variant="outline" className={cn("bg-white/[0.04]", accent.text, accent.border)}>
                {selectedMatch.surface} COURT
              </Badge>
              {selectedMatch.hashPre ? (
                <Badge variant="outline" className="border-white/10 bg-white/[0.04] font-mono text-amber-300">
                  LOCK {selectedMatch.hashPre.slice(0, 10).toUpperCase()}
                </Badge>
              ) : null}
            </div>
          </div>

          {/* Controls */}
          <div className="flex w-full flex-1 flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.09] hover:text-white"
              onClick={handleDownload}
              disabled={!pngUrl}
            >
              <Download className="size-4" />
              دانلود PNG
            </Button>

            <Button
              type="button"
              className="w-full bg-amber-400/90 text-black hover:bg-amber-300"
              onClick={() => handleSend("public")}
              disabled={busy || !pngB64}
            >
              {sending === "public" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              ارسال به کانال عمومی (کپشن فارسی)
            </Button>

            <Button
              type="button"
              className="w-full bg-cyan-500/90 text-black hover:bg-cyan-400"
              onClick={() => handleSend("vip")}
              disabled={busy || !pngB64}
            >
              {sending === "vip" ? <Loader2 className="size-4 animate-spin" /> : <Crown className="size-4" />}
              ارسال به کانال VIP
            </Button>

            <p className="text-[11px] leading-5 text-white/40">
              رندر روی سرویس پایدار telegram-agent انجام می‌شود (پورت ۳۰۳۰)؛ همین موتور، ۹ پست خودکار روزانه را
              نیز تولید و منتشر می‌کند. ارسال دستی با کپشن کامل فارسی همراه است.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
