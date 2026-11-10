"use client";

// ─── NeoTennis Markov Quant v2.0 — Official SHA-256 Record Table ───────────
// کارنامه رسمی: every settled pick of the 7-day auto-settlement window with
// its real result, profit and the pre-match SHA-256 lock.

import { useMemo, useState } from "react";
import { BadgeCheck, FileCheck2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LedgerPayload, ProductionLine } from "@/lib/tennis/types";

const LINE_LABELS: Record<ProductionLine, string> = {
  DUAL: "زوج‌تیپ الگویی",
  COMBO: "میکس",
  SNIPER: "اسنایپر",
  SHADOW: "سایه",
};

const SURFACE_LABEL: Record<string, string> = {
  HARD: "هارد",
  CLAY: "خاک",
  GRASS: "چمن",
};

export function RecordTable({ ledger }: { ledger: LedgerPayload }) {
  const [filter, setFilter] = useState<"ALL" | "WON" | "LOST">("ALL");

  const settled = useMemo(() => {
    const rows = ledger.rows.filter((r) => r.status === "WON" || r.status === "LOST");
    return (filter === "ALL" ? rows : rows.filter((r) => r.status === filter)).slice(0, 40);
  }, [ledger.rows, filter]);

  const won = ledger.rows.filter((r) => r.status === "WON").length;
  const lost = ledger.rows.filter((r) => r.status === "LOST").length;
  const decided = won + lost;
  const winRate = decided > 0 ? (won / decided) * 100 : 0;

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <FileCheck2 className="h-4 w-4 text-emerald-300" />
          کارنامه رسمی SHA-256
          <Badge variant="outline" className="gap-1 border-emerald-400/30 bg-emerald-400/5 text-[10px] text-emerald-300">
            <BadgeCheck className="h-3 w-3" />
            <span className="mono-num">{decided}</span> تیپ تسویه‌شده ۷ روز اخیر
          </Badge>
          <span className="text-[11px] font-normal text-muted-foreground">
            — وین‌ریت واقعی ثبت‌شده: <span className="mono-num">{winRate.toFixed(1)}%</span> (
            <span className="mono-num">{won}</span> برد / <span className="mono-num">{lost}</span> باخت)
          </span>
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
        {settled.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            هنوز تیپ تسویه‌شده‌ای در پنجره ۷ روزه ثبت نشده — موتور به محض پایان هر مسابقه
            تاییدشده، آن را با نتیجه واقعی ESPN تسویه می‌کند.
          </p>
        ) : (
          <div className="scroll-slim max-h-96 overflow-y-auto rounded-xl border border-white/5">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">مسابقه</TableHead>
                  <TableHead className="text-xs">خط</TableHead>
                  <TableHead className="text-xs">تیپ</TableHead>
                  <TableHead className="text-xs">ضریب</TableHead>
                  <TableHead className="text-xs">نتیجه</TableHead>
                  <TableHead className="text-xs">وضعیت</TableHead>
                  <TableHead className="text-xs">سود</TableHead>
                  <TableHead className="text-xs">قفل SHA-256</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settled.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[220px] truncate text-xs">
                      <span className="font-medium">{r.matchLabel}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {r.tournament} · {SURFACE_LABEL[r.surface] ?? r.surface}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{LINE_LABELS[r.line]}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-[11px]">{r.desc}</TableCell>
                    <TableCell className="mono-num text-xs">{r.odds.toFixed(2)}</TableCell>
                    <TableCell className="mono-num text-xs text-muted-foreground">{r.result ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.status === "WON" ? (
                        <span className="font-bold text-emerald-300">✓ برد</span>
                      ) : (
                        <span className="font-bold text-rose-300">✗ باخت</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`mono-num text-xs ${(r.profit ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {(r.profit ?? 0) >= 0 ? "+" : ""}
                      {(r.profit ?? 0).toFixed(1)}
                    </TableCell>
                    <TableCell className="mono-num text-[10px] text-cyan-300/80" dir="ltr">
                      {r.hash ? (
                        <span className="inline-flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          {r.hash.slice(0, 10)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
