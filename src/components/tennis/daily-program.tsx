"use client";

// ─── NeoTennis — Daily Broadcast Program panel ──────────────────────────────
// The professional daily program with exact Tehran times, rendered from the
// telegram-agent /status payload (single source of truth: src/program.ts of
// the agent). Auto-refreshes every 30s. Browser-independent — this is only a
// VIEWER; the scheduler runs server-side even with every browser closed.

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CircleCheck, CircleX, Clock, Loader2, Pause, Radio } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const AGENT = "/api/agent";

interface ProgramEntry {
  time: string;
  fa: string;
  en: string;
  target: "public" | "vip" | "both";
  targetEn: string;
  jobId: string;
  lastStatus?: string;
  lastRun?: string;
  nextRun?: string;
  elapsed?: boolean;
}

interface StatusPayload {
  ok: boolean;
  bot?: { username?: string; live?: boolean };
  program?: ProgramEntry[];
  tehranTime?: string;
  uptimeSeconds?: number;
}

const targetLabel: Record<ProgramEntry["target"], string> = {
  public: "عمومی",
  vip: "VIP",
  both: "هر دو",
};

const targetClass: Record<ProgramEntry["target"], string> = {
  public: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  vip: "border-amber-300/50 bg-amber-300/10 text-amber-200",
  both: "border-teal-300/40 bg-teal-300/10 text-teal-200",
};

function statusView(e: ProgramEntry) {
  if (e.lastStatus === "SENT") {
    return { icon: <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />, text: "ارسال شد", cls: "text-emerald-300" };
  }
  if (e.lastStatus === "ERROR") {
    return { icon: <CircleX className="h-3.5 w-3.5 text-red-400" />, text: "خطا — تلاش مجدد", cls: "text-red-300" };
  }
  if (e.lastStatus === "SKIPPED") {
    return { icon: <Pause className="h-3.5 w-3.5 text-zinc-500" />, text: "در انتظار نوبت", cls: "text-zinc-400" };
  }
  if (e.elapsed) {
    return { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />, text: "در جریان", cls: "text-amber-200" };
  }
  return { icon: <Clock className="h-3.5 w-3.5 text-zinc-500" />, text: "زمان‌بندی‌شده", cls: "text-zinc-400" };
}

/** Persian-style clock digits for the time column */
const faDigits = (s: string): string => s.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);

export function DailyProgram() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT}/status`, { cache: "no-store" });
      const json = (await res.json()) as StatusPayload;
      if (!json.ok) throw new Error("agent not ok");
      setStatus(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "agent unreachable");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      void load();
      setTick((x) => x + 1);
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const program = status?.program ?? [];
  const doneCount = program.filter((p) => p.lastStatus === "SENT").length;
  const progress = program.length ? Math.round((doneCount / program.length) * 100) : 0;

  return (
    <Card className="border-white/10 bg-zinc-950/60" data-tick={tick}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarClock className="h-4 w-4 text-amber-300" />
          <CardTitle className="text-sm">برنامه روزانه حرفه‌ای پخش</CardTitle>
          <Badge variant="outline" className="border-emerald-400/40 text-[10px] text-emerald-300">
            به وقت تهران
          </Badge>
          {status?.tehranTime && (
            <Badge variant="outline" className="border-white/15 text-[10px]" dir="ltr">
              <Radio className="me-1 inline h-3 w-3 text-emerald-400" />
              {status.tehranTime}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              status?.bot?.live
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                : "border-red-400/40 bg-red-400/10 text-red-300"
            )}
          >
            {status?.bot?.live ? "پخش زنده فعال" : "حالت آزمایشی"}
          </Badge>
          <span className="ms-auto text-[11px] text-muted-foreground">
            {status?.bot?.username ? `بات: @${status.bot.username}` : ""}
          </span>
        </div>
        <CardDescription className="leading-5">
          قرارداد پخش روز — دقیقه‌به‌دقیقه، هر پست به کانال مشخص‌شده ارسال می‌شود. فلش‌کارت هر بازی فقط
          یک‌بار در روز؛ استیک استاندارد هر بازی ۱۰۰ واحدی با اعلام سهم هر تیپ روی کارت و کپشن.
        </CardDescription>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all duration-700"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="پیشرفت برنامه روز"
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          {doneCount} از {program.length} برنامه امروز اجرا شده ({faDigits(String(progress))}٪)
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {error && !status && (
          <p className="rounded-lg border border-red-400/30 bg-red-400/[0.06] p-3 text-xs text-red-200">
            اتصال به ایجنت برقرار نشد: {error} — پنل به‌محض بازگشت هسته، به‌صورت خودکار نوسازی می‌شود.
          </p>
        )}
        <div className="scroll-slim max-h-96 overflow-y-auto rounded-xl border border-white/10">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-zinc-950/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">ساعت</th>
                <th className="px-3 py-2 font-medium">برنامه</th>
                <th className="px-3 py-2 font-medium">کانال</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {program.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    در حال دریافت برنامه از هسته ایجنت…
                  </td>
                </tr>
              )}
              {program.map((p) => {
                const st = statusView(p);
                return (
                  <tr
                    key={p.jobId}
                    className={cn(
                      "border-t border-white/5 transition-colors hover:bg-white/[0.04]",
                      p.lastStatus === "SENT" && "bg-emerald-400/[0.04]",
                      p.lastStatus === "ERROR" && "bg-red-400/[0.05]"
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] font-bold text-amber-200" dir="ltr">
                      {faDigits(p.time)}
                    </td>
                    <td className="px-3 py-2.5 leading-5 text-zinc-200">{p.fa}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={cn("text-[10px]", targetClass[p.target])}>
                        {targetLabel[p.target]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("inline-flex items-center gap-1.5 text-[11px]", st.cls)}>
                        {st.icon}
                        {st.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          پوستر برنامه هر روز ساعت ۰۸:۳۰ در هر دو کانال منتشر می‌شود؛ این پنل همان جدول را مستقیم از
          هسته همیشه‌گرم ایجنت می‌خواند و بدون باز بودن مرورگر هم اجرا می‌شود.
        </p>
      </CardContent>
    </Card>
  );
}
