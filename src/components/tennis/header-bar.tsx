"use client";

import { useEffect, useState } from "react";
import { Activity, RadioTower, RefreshCw, Satellite } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SourceStatus } from "@/lib/tennis/types";

interface HeaderBarProps {
  onRefresh: () => void;
  refreshing: boolean;
  lastUpdated: number | null;
  sources: Record<string, SourceStatus>;
}

function TehranClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const raf = requestAnimationFrame(tick);
    const t = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);
  if (!now) {
    return <span className="mono-num text-xs text-muted-foreground">--:--:--</span>;
  }
  const fmt = new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <span className="mono-num text-xs text-muted-foreground" dir="ltr">
      {fmt.format(now)}
    </span>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  espn_atp_scoreboard: "ESPN ATP",
  espn_wta_scoreboard: "ESPN WTA",
  espn_atp_rankings: "رنکینگ ATP",
  espn_wta_rankings: "رنکینگ WTA",
  espn_atp_news: "اخبار ATP",
  espn_wta_news: "اخبار WTA",
  polymarket_gamma: "Polymarket",
};

export function HeaderBar({ onRefresh, refreshing, lastUpdated, sources }: HeaderBarProps) {
  const active = Object.entries(sources);
  const okCount = active.filter(([, s]) => s.ok).length;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            {/* mini tennis ball mark */}
            <span className="absolute h-5 w-5 rounded-full bg-[#dfff4f]" />
            <span className="absolute h-5 w-5 rounded-full border-x-2 border-white/70 [transform:rotate(38deg)]" />
          </div>
          <div>
            <h1 className="text-base font-extrabold leading-tight sm:text-lg">
              نئوتنیس مارکوف کوانت
            </h1>
            <p className="mono-num text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              NeoTennis Markov Quant · @aineobet Tennis Division
            </p>
          </div>
        </div>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <div className="hidden items-center gap-1.5 md:flex">
            <Badge variant="outline" className="gap-1 border-emerald-400/30 bg-emerald-400/5 text-emerald-300">
              <Satellite className="h-3 w-3" />
              <span className="mono-num">{okCount}/{active.length || 7}</span> سرویس زنده
            </Badge>
            <Badge variant="outline" className="gap-1 border-white/10 bg-white/5 text-muted-foreground">
              <RadioTower className="h-3 w-3" />
              Tehran
            </Badge>
            <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
              <Activity className="h-3 w-3" />
              <TehranClock />
            </Badge>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={refreshing}
            className="gap-2 border-white/10 bg-white/5 hover:bg-white/10"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "در حال واکشی…" : "به‌روزرسانی زنده"}
          </Button>
        </div>
      </div>

      {/* source telemetry strip */}
      <div className="scroll-slim overflow-x-auto border-t border-white/5">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5">
          {active.length === 0 && (
            <span className="text-[11px] text-muted-foreground">در حال اتصال به APIهای زنده…</span>
          )}
          {active.map(([key, s]) => (
            <span
              key={key}
              title={s.ok ? `${s.latencyMs}ms` : s.error}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${
                s.ok
                  ? "border-white/10 bg-white/5 text-muted-foreground"
                  : "border-red-400/30 bg-red-400/5 text-red-300"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  s.ok ? "bg-emerald-400 live-dot" : "bg-red-400"
                }`}
              />
              {SOURCE_LABELS[key] ?? key}
              {s.ok && <span className="mono-num text-[9px] opacity-60">{s.latencyMs}ms</span>}
            </span>
          ))}
          {lastUpdated && (
            <span className="mono-num ms-auto shrink-0 text-[10px] text-muted-foreground">
              sync {new Date(lastUpdated).toLocaleTimeString("fa-IR")}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
