"use client";

import { useMemo, useState } from "react";
import {
  CloudSun,
  Droplets,
  Eye,
  Flame,
  Play,
  Search,
  Trophy,
  Wind,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AnalyzedMatch, MatchState, Surface, Tour } from "@/lib/tennis/types";

const SURFACE_CLASS: Record<Surface, { wrap: string; text: string; dot: string; label: string }> = {
  HARD: {
    wrap: "surface-hard",
    text: "text-cyan-300",
    dot: "bg-cyan-400",
    label: "هاردکورت",
  },
  CLAY: {
    wrap: "surface-clay",
    text: "text-orange-300",
    dot: "bg-orange-400",
    label: "خاک رس",
  },
  GRASS: {
    wrap: "surface-grass",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
    label: "چمن",
  },
};

const STATE_BADGE: Record<MatchState, { label: string; cls: string }> = {
  pre: { label: "پیش از بازی", cls: "border-white/15 bg-white/5 text-white/70" },
  in: { label: "زنده", cls: "border-rose-400/40 bg-rose-400/10 text-rose-300" },
  post: { label: "پایان یافت", cls: "border-white/10 bg-white/[0.03] text-muted-foreground" },
};

function WeatherChip({ match }: { match: AnalyzedMatch }) {
  const w = match.weather;
  if (!w) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="gap-1.5 border-white/10 bg-white/5 text-[10px] text-muted-foreground"
        >
          <CloudSun className="h-3 w-3" />
          {w.ok ? (
            <>
              <span className="mono-num">{Math.round(w.tempC ?? 0)}°</span>
              <span className="inline-flex items-center gap-0.5">
                <Wind className="h-2.5 w-2.5" />
                <span className="mono-num">{Math.round(w.windKph ?? 0)}</span>
              </span>
              <span className="inline-flex items-center gap-0.5">
                <Droplets className="h-2.5 w-2.5" />
                <span className="mono-num">{Math.round(w.humidity ?? 0)}%</span>
              </span>
            </>
          ) : (
            "—"
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        آب‌وهوای {match.city} · {w.source === "open-meteo" ? "Open-Meteo" : "wttr.in"}
      </TooltipContent>
    </Tooltip>
  );
}

function ScoreLine({ match }: { match: AnalyzedMatch }) {
  if (match.state === "pre") {
    const start = match.startTime ? new Date(match.startTime) : null;
    return (
      <span className="mono-num text-[11px] text-muted-foreground">
        {start ? start.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) : "—"}
      </span>
    );
  }
  const n = Math.max(match.playerA.linescores.length, match.playerB.linescores.length);
  return (
    <div className="mono-num flex items-center gap-1 text-xs" dir="ltr">
      {Array.from({ length: n }).map((_, i) => {
        const a = match.playerA.linescores[i]?.value ?? 0;
        const b = match.playerB.linescores[i]?.value ?? 0;
        const aw = match.playerA.linescores[i]?.winner;
        const bw = match.playerB.linescores[i]?.winner;
        return (
          <span key={i} className="rounded bg-white/5 px-1.5 py-0.5">
            <span className={aw ? "text-emerald-300 font-bold" : "text-white/50"}>{a}</span>
            <span className="text-white/30">-</span>
            <span className={bw ? "text-emerald-300 font-bold" : "text-white/50"}>{b}</span>
          </span>
        );
      })}
    </div>
  );
}

export function Scoreboard({
  matches,
  onAnalyze,
}: {
  matches: AnalyzedMatch[];
  onAnalyze: (m: AnalyzedMatch) => void;
}) {
  const [tour, setTour] = useState<"ALL" | Tour>("ALL");
  const [state, setState] = useState<"ALL" | MatchState>("ALL");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return matches
      .filter((m) => (tour === "ALL" ? true : m.tour === tour))
      .filter((m) => (state === "ALL" ? true : m.state === state))
      .filter((m) =>
        query
          ? `${m.playerA.name} ${m.playerB.name} ${m.tournament}`.toLowerCase().includes(query)
          : true
      )
      .sort((a, b) => {
        const order = { in: 0, pre: 1, post: 2 };
        if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
        return b.favWinProb - a.favWinProb;
      });
  }, [matches, tour, state, q]);

  const liveCount = matches.filter((m) => m.state === "in").length;

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <Trophy className="h-4 w-4 text-amber-300" />
          اسکوربورد زنده ATP/WTA
          {liveCount > 0 && (
            <Badge className="border-0 bg-rose-400 text-[10px] font-bold text-white">
              <Flame className="h-3 w-3" /> {liveCount} بازی زنده
            </Badge>
          )}
          <span className="text-[11px] font-normal text-muted-foreground">
            — تم نوری کارت‌ها با نوع زمین تغییر می‌کند
          </span>
          <div className="ms-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative">
              <Search className="absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جستجوی بازیکن/تورنمنت…"
                className="h-8 w-52 bg-white/5 text-xs"
              />
            </div>
            <Tabs value={tour} onValueChange={(v) => setTour(v as Tour | "ALL")}>
              <TabsList className="h-8 bg-white/5">
                <TabsTrigger value="ALL" className="h-6 text-[11px]">همه</TabsTrigger>
                <TabsTrigger value="ATP" className="h-6 text-[11px]">ATP</TabsTrigger>
                <TabsTrigger value="WTA" className="h-6 text-[11px]">WTA</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={state} onValueChange={(v) => setState(v as MatchState | "ALL")}>
              <TabsList className="h-8 bg-white/5">
                <TabsTrigger value="ALL" className="h-6 text-[11px]">همه</TabsTrigger>
                <TabsTrigger value="in" className="h-6 text-[11px]">زنده</TabsTrigger>
                <TabsTrigger value="pre" className="h-6 text-[11px]">آینده</TabsTrigger>
                <TabsTrigger value="post" className="h-6 text-[11px]">تمام‌شده</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            مسابقه‌ای با این فیلترها یافت نشد.
          </p>
        ) : (
          <div className="scroll-slim grid max-h-[560px] gap-3 overflow-y-auto pe-1 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((m) => {
              const sc = SURFACE_CLASS[m.surface];
              const favName = m.favorite === "A" ? m.playerA.name : m.playerB.name;
              return (
                <div
                  key={m.eventKey}
                  className={`${sc.wrap} rise-in group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:translate-y-[-2px] hover:bg-white/[0.05] hover:shadow-[0_8px_30px_-12px_var(--surface-accent-soft)]`}
                >
                  {/* surface glow strip */}
                  <span className={`absolute inset-x-0 top-0 h-0.5 ${sc.dot} opacity-70`} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className={`${sc.text} border-white/10 bg-white/5 text-[10px]`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />
                        {sc.label}
                        {m.surfaceSrc === "INFERRED" && " ~"}
                      </Badge>
                      <Badge variant="outline" className={`border-white/10 bg-white/5 text-[10px] ${STATE_BADGE[m.state].cls}`}>
                        {m.state === "in" && <Play className="h-2.5 w-2.5" />}
                        {STATE_BADGE[m.state].label}
                      </Badge>
                    </div>
                    <WeatherChip match={m} />
                  </div>

                  <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {m.tournament} · {m.round}
                  </div>

                  <div className="mt-2.5 space-y-1.5">
                    {([m.playerA, m.playerB] as const).map((p, idx) => {
                      const isFav = (idx === 0 ? "A" : "B") === m.favorite;
                      return (
                        <div key={idx} className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {p.flagUrl && (
                              <img
                                src={`/api/tennis/img?url=${encodeURIComponent(p.flagUrl)}`}
                                alt={`پرچم ${p.name}`}
                                className="h-3.5 w-5 rounded-[2px] object-cover"
                                loading="lazy"
                              />
                            )}
                            <span className={`truncate text-sm ${isFav ? "font-bold text-white" : "text-white/70"}`}>
                              {p.name}
                            </span>
                            {isFav && m.state !== "post" && (
                              <span className="mono-num shrink-0 rounded bg-amber-300/15 px-1 text-[9px] font-bold text-amber-300">
                                FAV
                              </span>
                            )}
                            {p.seed && (
                              <span className="mono-num shrink-0 text-[9px] text-muted-foreground">
                                seed {p.seed}
                              </span>
                            )}
                          </div>
                          <span className="mono-num shrink-0 text-[10px] text-muted-foreground">
                            {p.rank ? `#${p.rank}` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/5 pt-2.5">
                    <ScoreLine match={m} />
                    {m.state !== "post" && (
                      <span className="mono-num text-[10px] text-muted-foreground">
                        مدل: {Math.round(m.favWinProb * 100)}%
                      </span>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => onAnalyze(m)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] transition-colors hover:bg-white/15"
                          aria-label={`تحلیل ${favName}`}
                        >
                          <Eye className="h-3 w-3" />
                          تحلیل موتور
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        زنجیره مارکوف، مهندسی معکوس و وضعیت سوپروایزر
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
