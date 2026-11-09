"use client";

import { useMemo, useState } from "react";
import { Newspaper, Search, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { NewsItem, RankRow, Tour } from "@/lib/tennis/types";

export function RankingsNews({
  rankings,
  news,
}: {
  rankings: { atp: RankRow[]; wta: RankRow[] };
  news: NewsItem[];
}) {
  const [tour, setTour] = useState<Tour>("ATP");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const base = tour === "ATP" ? rankings.atp : rankings.wta;
    const query = q.trim().toLowerCase();
    const list = query
      ? base.filter((r) => r.name.toLowerCase().includes(query))
      : base;
    return list.slice(0, 100);
  }, [rankings, tour, q]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Rankings */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <Trophy className="h-4 w-4 text-amber-300" />
            جدول رنکینگ رسمی جهان
            <Tabs value={tour} onValueChange={(v) => setTour(v as Tour)}>
              <TabsList className="h-7 bg-white/5">
                <TabsTrigger value="ATP" className="h-5 px-2 text-[11px]">ATP</TabsTrigger>
                <TabsTrigger value="WTA" className="h-5 px-2 text-[11px]">WTA</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative ms-auto w-40">
              <Search className="absolute end-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جستجو…"
                className="h-7 bg-white/5 text-xs"
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="scroll-slim max-h-72 overflow-y-auto rounded-xl border border-white/5">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[oklch(0.19_0.01_270)]">
                <tr className="text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">#</th>
                  <th className="px-3 py-2 text-start font-medium">بازیکن</th>
                  <th className="px-3 py-2 text-end font-medium">امتیاز</th>
                  <th className="px-3 py-2 text-end font-medium">تغییر</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const diff = r.previous - r.rank;
                  return (
                    <tr key={`${r.tour}-${r.rank}`} className="border-t border-white/5 hover:bg-white/[0.04]">
                      <td className="mono-num px-3 py-1.5 text-muted-foreground">{r.rank}</td>
                      <td className="px-3 py-1.5 font-medium">{r.name}</td>
                      <td className="mono-num px-3 py-1.5 text-end">{r.points.toLocaleString("en-US")}</td>
                      <td className="mono-num px-3 py-1.5 text-end">
                        {diff === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={diff > 0 ? "text-emerald-300" : "text-rose-300"}>
                            {diff > 0 ? `▲${diff}` : `▼${-diff}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      بازیکنی یافت نشد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* News radar */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Newspaper className="h-4 w-4 text-amber-300" />
            رادار اخبار زنده تنیس و وضعیت جسمانی
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="scroll-slim max-h-72 space-y-2.5 overflow-y-auto pe-1">
            {news.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                فید اخبار در دسترس نیست.
              </p>
            )}
            {news.map((n) => (
              <a
                key={n.id}
                href={n.link ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2.5 transition-colors hover:border-white/15 hover:bg-white/[0.06]"
              >
                {n.image && (
                  <img
                    src={n.image}
                    alt={n.headline}
                    className="h-14 w-24 shrink-0 rounded-lg object-cover"
                    loading="lazy"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="border-white/10 bg-white/5 px-1.5 py-0 text-[9px] text-muted-foreground">
                      {n.tour}
                    </Badge>
                    {n.published && (
                      <span className="mono-num text-[9px] text-muted-foreground">
                        {new Date(n.published).toLocaleDateString("fa-IR")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs font-bold leading-5">{n.headline}</p>
                  {n.description && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                      {n.description}
                    </p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
