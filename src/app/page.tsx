"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeed } from "@/components/tennis/use-feed";
import { HeaderBar } from "@/components/tennis/header-bar";
import { CommandCenter } from "@/components/tennis/command-center";
import { ProductionLines } from "@/components/tennis/production-lines";
import { Scoreboard } from "@/components/tennis/scoreboard";
import { RankingsNews } from "@/components/tennis/rankings-news";
import { TennisFooter } from "@/components/tennis/footer";
import { AnalysisDialog } from "@/components/tennis/analysis-dialog";
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
        {loading && <FeedSkeleton />}
        {!loading && error && <FeedError error={error} onRetry={() => void reload(true)} />}

        {!loading && data && (
          <>
            <CommandCenter ledger={data.ledger} />
            <ProductionLines feed={data} />
            <Scoreboard matches={data.matches} onAnalyze={openAnalysis} />
            <RankingsNews rankings={data.rankings} news={data.news} />
            <PosterStudio matches={posterMatches} allMatches={data.matches.filter((m) => m.state !== "post")} />
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
