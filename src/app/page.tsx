"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeed } from "@/components/tennis/use-feed";
import { HeaderBar } from "@/components/tennis/header-bar";
import { DailyProgram } from "@/components/tennis/daily-program";
import { CommandCenter } from "@/components/tennis/command-center";
import { HawkEyeCourt } from "@/components/tennis/hawk-eye-court";
import { ProductionLines } from "@/components/tennis/production-lines";
import { RecordTable } from "@/components/tennis/record-table";
import { Scoreboard } from "@/components/tennis/scoreboard";
import { RankingsNews } from "@/components/tennis/rankings-news";
import { TennisFooter } from "@/components/tennis/footer";
import { AnalysisDialog } from "@/components/tennis/analysis-dialog";
import { SupervisorMonitor } from "@/components/tennis/supervisor-monitor";
import { QqlExplorer } from "@/components/tennis/qql-explorer";
import PosterStudio from "@/components/tennis/poster-studio";
import type { AnalyzedMatch } from "@/lib/tennis/types";

function FeedSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-48 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
        <div className="h-48 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03] lg:col-span-2" />
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
      <div className="h-80 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
      <p className="text-center text-xs text-muted-foreground">
        در حال واکشی اسکوربورد زنده، رنکینگ رسمی، فید بازار و اجرای موتور مارکوف…
      </p>
    </div>
  );
}

function FeedError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-400/30 bg-red-400/[0.06] p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-red-300" />
      <p className="mt-3 text-sm font-bold">خطا در دریافت فید زنده</p>
      <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
        {error}
      </p>
      <Button onClick={onRetry} size="sm" variant="outline" className="mt-4 gap-2">
        <RefreshCw className="h-3.5 w-3.5" />
        تلاش مجدد
      </Button>
    </div>
  );
}

export default function Home() {
  const { data, loading, error, refreshing, lastUpdated, reload } = useFeed();
  const [analyzing, setAnalyzing] = useState<AnalyzedMatch | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hawkKey, setHawkKey] = useState<string | null>(null);

  // Hawk-Eye hero: live → approved → first available
  const hawkMatches = useMemo(() => {
    if (!data) return [];
    const scored = [...data.matches]
      .filter((m) => m.state !== "post")
      .sort((a, b) => {
        const rank = (x: AnalyzedMatch) =>
          (x.state === "in" ? 0 : 1) + (x.dualEligible ? 0 : 2) - x.favWinProb / 100;
        return rank(a) - rank(b);
      });
    return scored.slice(0, 8);
  }, [data]);

  const hawkMatch = useMemo(
    () => hawkMatches.find((m) => m.eventKey === hawkKey) ?? hawkMatches[0],
    [hawkMatches, hawkKey]
  );

  const openAnalysis = (m: AnalyzedMatch) => {
    setAnalyzing(m);
    setDialogOpen(true);
  };

  const posterMatches = (data?.matches ?? []).filter(
    (m) => m.state !== "post" && m.slips.A && m.slips.B
  );

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        onRefresh={() => void reload(true)}
        refreshing={refreshing || loading}
        lastUpdated={lastUpdated}
        sources={data?.sources ?? {}}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6">
        {/* v3.1 · Professional daily broadcast program (agent-driven, browser-free) */}
        <section aria-label="برنامه روزانه پخش">
          <DailyProgram />
        </section>

        {loading && <FeedSkeleton />}
        {!loading && error && <FeedError error={error} onRetry={() => void reload(true)} />}

        {!loading && data && (
          <>
            {/* v3.0 · 3D Hawk-Eye Court Telemetry hero */}
            <section aria-label="رادار سه‌بعدی چشم شاهین" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold">
                  <Radar className="h-4 w-4 text-amber-300" />
                  ویجت سه‌بعدی رادار چشم شاهین زمین تنیس
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  — بافت و رنگ زمین با سطح بازی تغییر می‌کند (هارد کهکشانی / خاک گاروس / چمن ویمبلدون)
                </span>
                <div className="scroll-slim ms-auto flex max-w-full gap-1.5 overflow-x-auto pb-1">
                  {hawkMatches.map((m) => (
                    <button
                      key={m.eventKey}
                      onClick={() => setHawkKey(m.eventKey)}
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${
                        hawkMatch?.eventKey === m.eventKey
                          ? "border-amber-300/60 bg-amber-300/15 text-amber-200"
                          : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
                      }`}
                      aria-pressed={hawkMatch?.eventKey === m.eventKey}
                    >
                      {m.state === "in" && <span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-400 live-dot align-middle" />}
                      {m.playerA.shortName} × {m.playerB.shortName}
                    </button>
                  ))}
                </div>
              </div>
              {hawkMatch ? (
                <HawkEyeCourt match={hawkMatch} />
              ) : (
                <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
                  بازی پیش‌رو/زنده‌ای برای نمایش رادار زمین یافت نشد.
                </p>
              )}
            </section>

            <CommandCenter ledger={data.ledger} />
            <ProductionLines feed={data} />
            <RecordTable ledger={data.ledger} />
            {/* v12 — 💻 کنسول پرس‌وجوی علوم داده تنیس (QQL & RCA Explorer) */}
            <QqlExplorer />
            <Scoreboard matches={data.matches} onAnalyze={openAnalysis} />
            <RankingsNews rankings={data.rankings} news={data.news} />
            <PosterStudio matches={posterMatches} allMatches={data.matches.filter((m) => m.state !== "post")} />
            <SupervisorMonitor />
          </>
        )}
      </main>

      <TennisFooter />

      <AnalysisDialog
        match={analyzing}
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setAnalyzing(null);
        }}
      />
    </div>
  );
}
