"use client";

// ─── NeoTennis — Telegram Supervisor Agent Monitor ──────────────────────────
// Live control panel for the always-warm telegram-agent (port 3030):
// scheduler jobs, run history, dry-run outbox previews, live-mode toggle and
// manual job triggers. All requests go through the gateway (XTransformPort).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CirclePause,
  CirclePlay,
  Clock,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const AGENT = "/api/agent";

interface AgentJob {
  id: string;
  label: string;
  labelFa: string;
  target: string;
  cron?: string;
  everySeconds?: number;
  enabled: boolean;
  lastRun?: string;
  lastStatus?: string;
  lastError?: string;
  nextRun?: string;
  runs: number;
}

interface AgentPost {
  id?: number;
  at: string;
  jobId: string;
  target: string;
  posterKind: string;
  mode: string;
  status: string;
  caption?: string;
  error?: string;
}

interface AgentStatusPayload {
  ok: boolean;
  bot: { username: string; live: boolean };
  chats: { public?: string; vip?: string };
  uptimeSeconds: number;
  jobs: AgentJob[];
  recentPosts: AgentPost[];
  flashQueue: {
    cursor: number;
    total: number;
    dateKey: string;
    postsToday?: number;
    cooldownActive?: boolean;
    cooldownMinutes?: number;
  };
  academy: { nextLesson: number; total: number };
  dataFeed: { lastWarmOk: boolean; lastWarmAt?: string; matches: number; approved: number };
}

const STATUS_STYLE: Record<string, string> = {
  OK: "border-emerald-300/40 bg-emerald-300/10 text-emerald-200",
  SENT: "border-emerald-300/40 bg-emerald-300/10 text-emerald-200",
  "DRY-RUN": "border-cyan-300/40 bg-cyan-300/10 text-cyan-200",
  SKIPPED: "border-amber-300/40 bg-amber-300/10 text-amber-200",
  ERROR: "border-rose-300/40 bg-rose-300/10 text-rose-200",
};

const TARGET_FA: Record<string, string> = {
  public: "عمومی",
  vip: "VIP",
  both: "هر دو",
};

function fmtTehran(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Tehran",
  });
}

export function SupervisorMonitor() {
  const [st, setSt] = useState<AgentStatusPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT}/status`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as AgentStatusPayload;
      if (alive.current) setSt(body);
    } catch {
      if (alive.current) setSt(null);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load]);

  const runJob = useCallback(
    async (jobId: string) => {
      setBusy(jobId);
      try {
        const res = await fetch(`${AGENT}/run/${jobId}`, { method: "POST" });
        const body = (await res.json()) as { ok?: boolean; status?: string; error?: string };
        if (body.ok) {
          toast.success(
            body.status === "DRY-RUN"
              ? "پوستر در حالت آزمایشی ساخته شد (خروجی در صندوق خروجی ایجنت)"
              : body.status === "SKIPPED"
                ? "اجرای کار رد شد — داده امروز برای این کار آماده نبود"
                : `کار ${jobId} با موفقیت اجرا شد`
          );
        } else {
          toast.error(body.error ?? "اجرا ناموفق بود");
        }
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "خطا در اجرای کار");
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const toggleLive = useCallback(
    async (on: boolean) => {
      setToggling(true);
      try {
        const res = await fetch(`${AGENT}/live`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ on }),
        });
        const body = (await res.json()) as { ok?: boolean; live?: boolean };
        if (body.ok) {
          toast.success(
            body.live
              ? "انتشار زنده فعال شد — پست‌ها واقعاً به تلگرام ارسال می‌شوند"
              : "حالت آزمایشی فعال شد — همه‌چیز ساخته می‌شود ولی ارسال نمی‌شود"
          );
        }
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تغییر وضعیت ناموفق بود");
      } finally {
        setToggling(false);
      }
    },
    [load]
  );

  if (!st) {
    return (
      <Card dir="rtl" className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Bot className="size-6 text-amber-300/70" />
          <p className="text-sm font-bold text-white/80">سوپروایزر تلگرام در دسترس نیست</p>
          <p className="text-xs leading-6 text-white/50">
            سرویس ایجنت روی پورت ۳۰۳۰ در حال اجراست؛ اگر همین خطا ماند، لاگ mini-services/telegram-agent را بررسی کنید.
          </p>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
            بررسی مجدد
          </Button>
        </CardContent>
      </Card>
    );
  }

  const live = st.bot.live;

  return (
    <Card dir="rtl" className="gap-4 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base text-white">
          <Bot className="size-4 text-amber-300" />
          ایجنت سوپروایزر تلگرام — @Aineobet_bot
          <Badge
            variant="outline"
            className={cn(
              live
                ? "border-rose-300/50 bg-rose-300/10 text-rose-200"
                : "border-cyan-300/40 bg-cyan-300/10 text-cyan-200"
            )}
          >
            {live ? "LIVE — انتشار واقعی" : "DRY-RUN — حالت آزمایشی"}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs leading-6 text-white/50">
          ۹ پست خودکار روزانه · فلش‌کارت هر ۹۰ ثانیه · بنر ساعتی · گزارش هفتگی جمعه ۲۲:۰۰ (هر دو کانال) —
          پوستر انگلیسی ۱۶-بیتی، کپشن کاملاً فارسی
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* health strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              icon: <Zap className="size-3.5 text-amber-300" />,
              label: "فید موتور",
              value: st.dataFeed.lastWarmOk ? `${st.dataFeed.matches} بازی` : "اسنپ‌شات",
            },
            {
              icon: <Activity className="size-3.5 text-emerald-300" />,
              label: "کارت‌های تأییدشده",
              value: `${st.dataFeed.approved}`,
            },
            {
              icon: <Clock className="size-3.5 text-cyan-300" />,
              label: "فلش‌کارت امروز",
              value:
                st.flashQueue.postsToday !== undefined
                  ? `${st.flashQueue.postsToday} پست${st.flashQueue.cooldownActive ? " · استراحت ضدتکرار" : ""}`
                  : `${st.flashQueue.cursor}/${st.flashQueue.total}`,
            },
            {
              icon: <Radio className="size-3.5 text-fuchsia-300" />,
              label: "آکادمی BET",
              value: `درس ${st.academy.nextLesson}/${st.academy.total}`,
            },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-center"
            >
              <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/50">
                {c.icon}
                {c.label}
              </div>
              <div className="mt-1 text-sm font-bold text-white">{c.value}</div>
            </div>
          ))}
        </div>

        {/* live toggle */}
        <div className="flex items-center justify-between rounded-xl border border-rose-300/20 bg-rose-300/5 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            {live ? (
              <CirclePlay className="size-4 text-rose-300" />
            ) : (
              <CirclePause className="size-4 text-cyan-300" />
            )}
            <div>
              <div className="text-xs font-bold text-white">
                {live ? "انتشار زنده فعال است" : "حالت آزمایشی (dry-run)"}
              </div>
              <div className="text-[10px] text-white/50">
                {live
                  ? "هر پست مستقیماً به کانال تلگرام ارسال می‌شود"
                  : "پوسترها ساخته و ثبت می‌شوند ولی به تلگرام ارسال نمی‌شوند"}
              </div>
            </div>
          </div>
          <Switch
            checked={live}
            disabled={toggling}
            onCheckedChange={(v) => void toggleLive(v)}
            aria-label="انتشار زنده"
          />
        </div>

        {/* jobs */}
        <div className="scroll-slim max-h-96 space-y-1.5 overflow-y-auto pr-1">
          {st.jobs.map((j) => (
            <div
              key={j.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
            >
              <div className="min-w-40 flex-1">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  {j.labelFa}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-white/45">
                  <span dir="ltr" className="font-mono">
                    {j.cron ? `cron ${j.cron}` : `هر ${j.everySeconds}s`}
                  </span>
                  <span>→ {TARGET_FA[j.target] ?? j.target}</span>
                  <span>اجرای بعدی: {fmtTehran(j.nextRun)}</span>
                  <span>آخرین اجرا: {fmtTehran(j.lastRun)}</span>
                  {j.lastError ? <span className="text-rose-300/80">{j.lastError}</span> : null}
                </div>
              </div>
              {j.lastStatus ? (
                <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLE[j.lastStatus])}>
                  {j.lastStatus === "OK" || j.lastStatus === "SENT" ? "موفق" : j.lastStatus === "DRY-RUN" ? "آزمایشی" : j.lastStatus === "SKIPPED" ? "رد شد" : "خطا"}
                </Badge>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-white/15 px-2.5 text-[11px] text-white hover:bg-white/10 hover:text-white"
                disabled={busy !== null}
                onClick={() => void runJob(j.id)}
              >
                {busy === j.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
                اجرا
              </Button>
            </div>
          ))}
        </div>

        {/* recent posts */}
        <div className="space-y-1">
          <div className="text-[11px] font-bold text-white/60">آخرین پست‌های تولیدشده</div>
          <div className="scroll-slim max-h-40 space-y-1 overflow-y-auto pr-1">
            {st.recentPosts.length === 0 ? (
              <p className="py-2 text-center text-[11px] text-white/40">
                هنوز پستی تولید نشده است — با دکمه «اجرا» یکی بسازید.
              </p>
            ) : (
              st.recentPosts.map((p) => (
                <div
                  key={p.id ?? `${p.at}-${p.jobId}`}
                  className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-[11px]"
                >
                  <span className="font-mono text-white/45">{fmtTehran(p.at)}</span>
                  <span className="flex-1 truncate text-white/75">{p.jobId}</span>
                  <span className="text-white/40">{TARGET_FA[p.target] ?? p.target}</span>
                  <Badge variant="outline" className={cn("text-[9px]", STATUS_STYLE[p.status])}>
                    {p.status === "SENT" ? "ارسال شد" : p.status === "DRY-RUN" ? "آزمایشی" : p.status === "SKIPPED" ? "رد شد" : "خطا"}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
