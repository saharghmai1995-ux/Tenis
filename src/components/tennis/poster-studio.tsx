"use client";

// ─── NeoTennis Markov Quant — Poster Studio ─────────────────────────────────
// Client component: renders the procedural 1080×1440 poster for the selected
// match, with Teaser/Full modes, PNG download and Telegram channel send.
// UI is Persian; the canvas image itself is 100% English (see lib/tennis/poster).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crown, Download, FlaskConical, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { drawPoster, type PosterData, type PosterSurface } from "@/lib/tennis/poster";
import type { AnalyzedMatch } from "@/lib/tennis/types";

type PosterMode = PosterData["mode"];
type SendTarget = "public" | "vip";

const SURFACE_ACCENT: Record<PosterSurface, { text: string; border: string; dot: string }> = {
  HARD: { text: "text-cyan-300", border: "border-cyan-400/30", dot: "bg-cyan-300" },
  CLAY: { text: "text-orange-300", border: "border-orange-400/30", dot: "bg-orange-300" },
  GRASS: { text: "text-emerald-300", border: "border-emerald-400/30", dot: "bg-emerald-300" },
};

/** AnalyzedMatch → PosterData for the drawing engine. */
function toPosterData(match: AnalyzedMatch, mode: PosterMode, preview: boolean): PosterData {
  const marketProbAFav = match.market
    ? match.favorite === "A"
      ? match.market.probA
      : match.market.probB
    : undefined;

  // Review mode derives slips straight from the live model output and marks
  // the render with a MODEL PREVIEW ribbon — the supervisor gate stays intact.
  const favName = match.favorite === "A" ? match.playerA.name : match.playerB.name;
  const p20Fav = match.favorite === "A" ? match.markov.p20 : match.markov.p02;
  const over25 = match.markov.p21 + match.markov.p12;

  return {
    playerA: {
      name: match.playerA.name,
      shortName: match.playerA.shortName,
      flagUrl: match.playerA.flagUrl,
      rank: match.playerA.rank,
      seed: match.playerA.seed,
    },
    playerB: {
      name: match.playerB.name,
      shortName: match.playerB.shortName,
      flagUrl: match.playerB.flagUrl,
      rank: match.playerB.rank,
      seed: match.playerB.seed,
    },
    tournament: match.tournament,
    round: match.round,
    surface: match.surface,
    favorite: match.favorite,
    slipA: match.slips.A
      ? { textEn: match.slips.A.textEn, odds: match.slips.A.odds }
      : preview && p20Fav > 0.02
        ? { textEn: `${favName.toUpperCase()} WINS 2-0 (SET BETTING)`, odds: Number((1 / p20Fav).toFixed(2)) }
        : undefined,
    slipB: match.slips.B
      ? { textEn: match.slips.B.textEn, odds: match.slips.B.odds }
      : preview && over25 > 0.02
        ? { textEn: "TOTAL SETS — OVER 2.5 SETS", odds: Number((1 / over25).toFixed(2)) }
        : undefined,
    hashPre: match.hashPre,
    timingLabel: match.timing ? TIMING_EN[match.timing.code] : undefined,
    marketProbAFav,
    mode,
    preview,
  };
}

function safeFileNamePart(input: string): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned || "match";
}

// The canvas is English-only — map timing codes to English telemetry labels.
const TIMING_EN: Record<string, string> = {
  T30: "T-30m Pre-Warmup — Optimal Entry",
  INPLAY_BREAK: "In-Play After Early Break",
  INPLAY: "In-Play — Live",
  WAIT: "Awaiting T-30m Window",
  DONE: "Settled",
};

/** Narrow an unknown JSON body to a string field (no `any`). */
function readStringField(body: unknown, key: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تبدیل پوستر به base64 ناموفق بود"));
    reader.readAsDataURL(blob);
  });
}

export interface PosterStudioProps {
  matches: AnalyzedMatch[]; // approved dual slips (production posters)
  allMatches?: AnalyzedMatch[]; // upcoming matches for the engineering-review mode
  onSent?: () => void;
}

export default function PosterStudio({ matches, allMatches, onSent }: PosterStudioProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<PosterMode>("teaser");
  const [review, setReview] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [sending, setSending] = useState<SendTarget | null>(null);

  const pool = review ? (allMatches ?? []) : matches;
  const selectedMatch = useMemo<AnalyzedMatch | null>(
    () => pool.find((m) => m.eventKey === selectedKey) ?? pool[0] ?? null,
    [pool, selectedKey]
  );

  // Redraw whenever selection or mode changes (flags load inside drawPoster).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedMatch) return;
    let cancelled = false;
    setDrawing(true);
    drawPoster(canvas, toPosterData(selectedMatch, mode, review))
      .then(() => {
        if (!cancelled) setDrawing(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDrawing(false);
        toast.error(err instanceof Error ? err.message : "خطا در تولید پوستر");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMatch, mode, review]);

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedMatch) return;
    canvas
      .toBlob((blob) => {
        if (!blob) {
          toast.error("ساخت فایل PNG ناموفق بود");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `neotennis-${safeFileNamePart(selectedMatch.playerA.shortName)}-${safeFileNamePart(
          selectedMatch.playerB.shortName
        )}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast.success("پوستر دانلود شد");
      }, "image/png");
  }, [selectedMatch]);

  const handleSend = useCallback(
    async (target: SendTarget) => {
      const canvas = canvasRef.current;
      if (!canvas || sending !== null || !selectedMatch) return;
      setSending(target);
      try {
        const blob = await canvasToBlob(canvas);
        if (!blob) throw new Error("ساخت فایل PNG ناموفق بود");
        const dataUrl = await blobToBase64(blob);
        const imageBase64 = dataUrl.replace(/^data:image\/png;base64,/, "");

        const res = await fetch("/api/telegram/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64, target }),
        });

        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }

        const code = readStringField(body, "code");
        if (res.status === 501 || code === "TELEGRAM_NOT_CONFIGURED") {
          toast.error(readStringField(body, "error") ?? "تلگرام پیکربندی نشده است");
          return;
        }
        if (!res.ok) {
          toast.error(readStringField(body, "error") ?? `ارسال ناموفق بود (HTTP ${res.status})`);
          return;
        }

        toast.success(`پوستر به کانال ${target === "public" ? "عمومی" : "VIP"} ارسال شد`);
        onSent?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "خطای ناشناخته در ارسال پوستر");
      } finally {
        setSending(null);
      }
    },
    [sending, selectedMatch, onSent]
  );

  if (!selectedMatch) {
    return (
      <Card dir="rtl" className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Sparkles className="size-6 text-cyan-300/70" />
          <p className="max-w-md text-sm leading-7 text-white/60">
            پوستر پس از تولید تیپ‌های سوپروایزر فعال می‌شود — دروازه طلایی امروز باز نشده است
          </p>
          {(allMatches ?? []).length > 0 && (
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-2.5">
              <FlaskConical className="size-4 text-amber-300" />
              <div className="text-start">
                <div className="text-xs font-bold text-amber-300">حالت بازبینی مهندسی</div>
                <div className="text-[10px] text-white/50">
                  ترسیم آزمایشی پوستر از خروجی زنده مدل با واترمارک MODEL PREVIEW
                </div>
              </div>
              <Switch checked={review} onCheckedChange={setReview} aria-label="حالت بازبینی" />
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const accent = SURFACE_ACCENT[selectedMatch.surface];
  const busy = drawing || sending !== null;

  return (
    <Card dir="rtl" className="gap-4 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-white">
          <Sparkles className="size-4 text-cyan-300" />
          استودیو پوستر — NeoTennis Quant
        </CardTitle>
        <CardDescription className="text-xs leading-6 text-white/50">
          پوستر تلگرام ۱۰۸۰×۱۴۴۰ (۳:۴) — تایپوگرافی داخل تصویر انگلیسی است
          {review && " · حالت بازبینی مهندسی (بدون قفل SHA-256)"}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Review-mode toggle (engineering preview) */}
        <div className="flex items-center justify-between rounded-xl border border-amber-300/20 bg-amber-300/5 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-amber-300" />
            <div>
              <div className="text-xs font-bold text-amber-300">حالت بازبینی مهندسی</div>
              <div className="text-[10px] text-white/50">
                انتخاب هر مسابقه پیش‌رو و ترسیم آزمایشی با واترمارک MODEL PREVIEW
              </div>
            </div>
          </div>
          <Switch checked={review} onCheckedChange={setReview} aria-label="حالت بازبینی" />
        </div>

        {/* Match chips */}
        <div className="flex flex-wrap gap-2">
          {matches.map((m) => {
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
          {/* Canvas preview — 1080×1440 internal, responsive display */}
          <div className="relative w-full max-w-[360px] shrink-0">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_40px_rgba(56,189,248,0.08)]">
              <canvas ref={canvasRef} width={1080} height={1440} className="aspect-[3/4] w-full" />
            </div>
            {drawing ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50">
                <Loader2 className="size-6 animate-spin text-cyan-300" />
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-center gap-2">
              <Badge variant="outline" className={cn("bg-white/[0.04]", accent.text, accent.border)}>
                {selectedMatch.surface} COURT
              </Badge>
              {selectedMatch.hashPre ? (
                <Badge variant="outline" className="border-white/10 bg-white/[0.04] font-mono text-cyan-300">
                  LOCK {selectedMatch.hashPre.slice(0, 10).toUpperCase()}
                </Badge>
              ) : null}
            </div>
          </div>

          {/* Controls */}
          <div className="flex w-full flex-1 flex-col gap-3">
            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              <Button
                type="button"
                size="sm"
                variant={mode === "teaser" ? "secondary" : "ghost"}
                onClick={() => setMode("teaser")}
                className={cn(mode === "teaser" && "bg-white/10 text-white")}
              >
                Teaser (Public)
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "full" ? "secondary" : "ghost"}
                onClick={() => setMode("full")}
                className={cn(mode === "full" && "bg-white/10 text-white")}
              >
                Full (VIP)
              </Button>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.09] hover:text-white"
              onClick={handleDownload}
              disabled={drawing}
            >
              <Download className="size-4" />
              دانلود PNG
            </Button>

            <Button
              type="button"
              className="w-full bg-cyan-500/90 text-black hover:bg-cyan-400"
              onClick={() => handleSend("public")}
              disabled={busy}
            >
              {sending === "public" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              ارسال به کانال عمومی
            </Button>

            <Button
              type="button"
              className="w-full bg-amber-400/90 text-black hover:bg-amber-300"
              onClick={() => handleSend("vip")}
              disabled={busy}
            >
              {sending === "vip" ? <Loader2 className="size-4 animate-spin" /> : <Crown className="size-4" />}
              ارسال به کانال VIP
            </Button>

            <p className="text-[11px] leading-5 text-white/40">
              حالت Teaser تیپ B را تار می‌کند و قفل «UNLOCK IN VIP» می‌گذارد؛ حالت Full برای کانال VIP همه‌چیز را باز نشان می‌دهد.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
