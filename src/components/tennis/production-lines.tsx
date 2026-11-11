"use client";

import { useMemo, useState } from "react";
import {
  Crosshair,
  Crown,
  Gem,
  Lock,
  Rocket,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TiltCard } from "@/components/tennis/spatial-tilt";
import { dedupeByKey } from "@/lib/tennis/dedupe";
import type { AnalyzedMatch, FeedPayload, LineItem, Surface } from "@/lib/tennis/types";

const SURFACE_DOT: Record<Surface, string> = {
  HARD: "bg-cyan-400",
  CLAY: "bg-orange-400",
  GRASS: "bg-emerald-400",
};

const SURFACE_LABEL: Record<Surface, string> = {
  HARD: "هارد",
  CLAY: "خاک",
  GRASS: "چمن",
};

const ARCH_STYLE: Record<string, string> = {
  ARCH1: "border-amber-300/40 bg-amber-300/10 text-amber-300",
  ARCH2: "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300",
  ARCH3: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

function SurfaceDot({ surface }: { surface: Surface }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-block h-2 w-2 rounded-full ${SURFACE_DOT[surface]}`} />
      </TooltipTrigger>
      <TooltipContent className="text-xs">{SURFACE_LABEL[surface]}کورت</TooltipContent>
    </Tooltip>
  );
}

function startLabel(item: LineItem): string {
  if (!item.startTime) return "";
  const t = new Date(item.startTime).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = t - Date.now();
  if (item.state === "in") return "در حال بازی";
  if (diff < 0) return "شروع‌شده";
  const mins = Math.round(diff / 60000);
  return mins >= 60
    ? `شروع ~${Math.floor(mins / 60)}ساعت ${mins % 60}دقیقه بعد`
    : `شروع ~${mins} دقیقه بعد`;
}

function LineCard({
  item,
  variant,
}: {
  item: LineItem;
  variant: "A" | "B" | "combo" | "sniper";
}) {
  const accent =
    variant === "A"
      ? "border-amber-300/25 bg-amber-300/[0.06]"
      : variant === "B"
        ? "border-emerald-400/25 bg-emerald-400/[0.06]"
        : variant === "combo"
          ? "border-cyan-400/25 bg-cyan-400/[0.05]"
          : "border-rose-400/25 bg-rose-400/[0.05]";
  const icon =
    variant === "A" ? (
      <Target className="h-4 w-4 text-amber-300" />
    ) : variant === "B" ? (
      <Gem className="h-4 w-4 text-emerald-300" />
    ) : variant === "combo" ? (
      <Sparkles className="h-4 w-4 text-cyan-300" />
    ) : (
      <Crosshair className="h-4 w-4 text-rose-300" />
    );

  return (
    <TiltCard className={`rise-in rounded-2xl border ${accent}`}>
      <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.tour} · {item.round}
            </div>
            <div className="flex items-center gap-1.5 text-sm font-bold">
              <SurfaceDot surface={item.surface} />
              {item.playerA} <span className="text-muted-foreground">×</span> {item.playerB}
            </div>
          </div>
        </div>
        <div className="text-left">
          {/* v3.0 — odds live in a dark capsule, mono tabular-nums */}
          <div className="num-capsule text-xl font-extrabold text-white">
            {item.odds.toFixed(2)}
            <span className="text-xs text-muted-foreground">x</span>
          </div>
          <div className="mono-num mt-1 text-[10px] text-muted-foreground" dir="ltr">
            P={Math.round(item.prob * 100)}%
          </div>
        </div>
      </div>
      <p className="mt-2.5 text-[13px] leading-6">{item.desc}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-muted-foreground">
          {item.tournament}
        </Badge>
        <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-muted-foreground">
          {startLabel(item)}
        </Badge>
        {item.archetype && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={`gap-1 text-[10px] font-bold ${ARCH_STYLE[item.archetype.code] ?? "border-white/10 bg-white/5 text-muted-foreground"}`}
              >
                👑 {item.archetype.labelFa}
                {item.archetype.adaptive && " (سازگار)"}
                <span className="mono-num">· {(item.archetype.coverage * 100).toFixed(1)}%</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              {item.archetype.labelEn} — پوشش کل فضای پیشامد{" "}
              <span className="mono-num">{(item.archetype.coverage * 100).toFixed(1)}%</span> · ریسک باخت
              همزمان <span className="mono-num">{(item.archetype.pairLoss * 100).toFixed(1)}%</span>
            </TooltipContent>
          </Tooltip>
        )}
        {item.timing.optimal && (
          <Badge className="border-0 bg-amber-300 text-[10px] font-bold text-black">
            <Rocket className="h-3 w-3" /> {item.timing.code === "T30" ? "T-30m Pre-Warmup" : "In-Play After Early Break"}
          </Badge>
        )}
        {item.hashPre && (
          <Badge variant="outline" className="mono-num gap-1 border-cyan-400/30 bg-cyan-400/5 text-[10px] text-cyan-300" dir="ltr">
            <Lock className="h-3 w-3" /> {item.hashPre.slice(0, 10)}
          </Badge>
        )}
        {/* v3.0 — stake rides a mono capsule, Persian label rides font-sans */}
        <span className="ms-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
          استیک:
          <span className="num-capsule text-[10px]">{item.stake}</span>
          واحد
        </span>
      </div>
      </div>
    </TiltCard>
  );
}

// ─── Near-gate strip: live 3-archetype candidacy for unapproved matches ────
function NearGateStrip({ matches }: { matches: AnalyzedMatch[] }) {
  const candidates = useMemo(() => {
    return matches
      .filter((m) => m.state !== "post" && !m.veto.vetoed)
      .slice(0, 40)
      .map((m) => {
        const fav = m.favorite;
        const hold = fav === "A" ? m.markov.gA : m.markov.gB;
        const sFav = fav === "A" ? m.markov.setWinA : 1 - m.markov.setWinA;
        const best = [...(m.archEvals ?? [])]
          .filter((e) => e.eligible)
          .sort((a, b) => a.pairLoss - b.pairLoss)[0];
        const anyWindow = (m.archEvals ?? []).some((e) => e.eligible);
        return { m, hold, sFav, best, anyWindow };
      })
      .filter((c) => !c.best)
      .sort((a, b) => a.sFav - b.sFav)
      .slice(0, 4);
  }, [matches]);

  if (candidates.length === 0) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-xs font-bold text-white/80">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
        کاندیدهای زیر ذره‌بین سوپروایزر (ارزیابی زنده ۳ الگو)
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {candidates.map(({ m, hold, sFav }) => (
          <div key={m.eventKey} className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold">
                <SurfaceDot surface={m.surface} />{" "}
                {m.favorite === "A" ? m.playerA.name : m.playerB.name}
                <span className="text-muted-foreground"> × {m.favorite === "A" ? m.playerB.name : m.playerA.name}</span>
              </span>
              <span className="mono-num text-[10px] text-muted-foreground">{m.tournament.slice(0, 16)}</span>
            </div>
            <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="w-24">S_fav</span>
                <div className="h-1.5 flex-1 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-cyan-400"
                    style={{ width: `${Math.min(100, (sFav / 0.9) * 100)}%` }}
                  />
                </div>
                <span className="mono-num">{(sFav * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-24">Hold fav</span>
                <div className="h-1.5 flex-1 rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${hold >= 0.85 ? "bg-emerald-400" : "bg-amber-400"}`}
                    style={{ width: `${Math.min(100, (hold / 0.95) * 100)}%` }}
                  />
                </div>
                <span className={`mono-num ${hold >= 0.85 ? "text-emerald-300" : ""}`}>{Math.round(hold * 100)}%</span>
              </div>
              <p className="pt-0.5 leading-4 text-muted-foreground/80">
                خارج از پنجره الگوها — پنجره رقابتی{" "}
                <span className="mono-num">56% ≤ S_fav &lt; 68%</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProductionLines({ feed }: { feed: FeedPayload }) {
  const [booster, setBooster] = useState(true);
  const { dual, combo2, combo3, sniper, shadow } = feed.lines;

  // v2.0 bug fix — the shadow ledger is grouped ONE row per match (the v1.0
  // audit saw every match listed twice). Legs stay separate for settlement;
  // the render unifies them by matchId with the canonical Map dedupe.
  const shadowGroups = useMemo(() => {
    const first = dedupeByKey(
      [...shadow].sort((a, b) => a.matchId.localeCompare(b.matchId)),
      (s) => s.matchId
    );
    return first.slice(0, 10);
  }, [shadow]);

  // Principal-Lock Booster display: asymmetric staking preview on dual line
  const boosterNote = booster
    ? "شتاب‌دهنده نامتقارن فعال: پس از هر برد، سود قفل می‌شود و نیمی از آن به استیک بعدی تزریق می‌گردد (اصل سرمایه همیشه محفوظ)"
    : "استیک ثابت ۱ واحدی";

  return (
    <section aria-label="خطوط تولید" className="space-y-4">
      <Card className="spatial-card rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <Rocket className="h-4 w-4 text-amber-300" />
            خطوط تولید سیگنال (۳ لاین مستقل)
            <span className="text-[11px] font-normal text-muted-foreground">
              — سوپروایزر ۳ الگویی با سهمیه تایید ۶۵٪ · خروجی امروز: {Math.ceil(dual.length / 2)} مسابقه زوج‌تیپ ({dual.length} بال) · {combo2.length + combo3.length} میکس ·{" "}
              {sniper.length} اسنایپر · {shadow.length} وتو
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="dual">
            <TabsList className="grid w-full grid-cols-3 bg-white/5">
              <TabsTrigger value="dual" className="gap-1.5 text-xs">
                <Target className="h-3.5 w-3.5" /> زوج‌تیپ الگویی
              </TabsTrigger>
              <TabsTrigger value="combo" className="gap-1.5 text-xs">
                <Sparkles className="h-3.5 w-3.5" /> میکس سلاطین سرویس
              </TabsTrigger>
              <TabsTrigger value="sniper" className="gap-1.5 text-xs">
                <Crosshair className="h-3.5 w-3.5" /> تک‌تیرانداز
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dual" className="mt-4 space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-amber-300/20 bg-amber-300/5 px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-amber-300" />
                  <div>
                    <div className="text-xs font-bold text-amber-300">
                      سوییچ شتاب‌دهنده نامتقارن — Principal-Lock Booster
                    </div>
                    <div className="text-[10px] text-muted-foreground">{boosterNote}</div>
                  </div>
                </div>
                <Switch checked={booster} onCheckedChange={setBooster} aria-label="شتاب‌دهنده" />
              </div>

              {dual.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
                  <ShieldAlert className="mx-auto h-8 w-8 text-amber-300/60" />
                  <p className="mt-3 text-sm font-bold">هیچ الگویی امروز صلاحیت نگرفت</p>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-6 text-muted-foreground">
                    سوپروایزر v2.0 هر مسابقه را با ۳ الگوی متعامد ارزیابی می‌کند
                    (تسلط فاوریت / نبرد نزدیک / سپر سرویس‌زنان) و فقط وقتی ریسک باخت
                    همزمان زیر <span className="mono-num">9.5%</span> باشد تایید می‌کند.
                    بازی‌های رقابتی تراز اول با «الگوی ۲» تایید و تسویه می‌شوند — نه وتو.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {dual.map((item) => (
                    <LineCard key={`${item.matchId}-${item.leg}`} item={item} variant={item.leg.startsWith("B") ? "B" : "A"} />
                  ))}
                </div>
              )}

              <NearGateStrip matches={feed.matches} />

              {shadow.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    🛡️ دفتر سایه — ({shadow.length} تیپ وتوشده، بدون احتساب وین‌ریت)
                  </div>
                  {/* v2.0 bug fix: dedupe by match id — one line per match */}
                  <div className="scroll-slim mt-2 grid max-h-40 gap-1.5 overflow-y-auto">
                    {shadowGroups.map((s) => (
                      <div key={s.matchId} className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5 text-[11px]">
                        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${SURFACE_DOT[s.surface]}`} />
                        <span className="truncate text-muted-foreground">{s.desc}</span>
                        <span className="mono-num ms-auto shrink-0 text-[10px] text-white/40">
                          {s.playerA.split(" ").pop()} × {s.playerB.split(" ").pop()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="combo" className="mt-4 space-y-3">
              {[...combo2, ...combo3].length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
                  میکس با پنجره هدف <span className="mono-num">2.80x–5.80x</span> یافت نشد — سلاطین سرویس امروز در تداخل رنکینگ هستند.
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {[...combo2, ...combo3].map((item) => (
                    <LineCard key={`${item.matchId}-${item.leg}`} item={item} variant="combo" />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="sniper" className="mt-4 space-y-3">
              {sniper.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
                  تیر خالصی در پنجره هدف <span className="mono-num">4.20x–7.50x</span> پیدا نشد.
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {sniper.map((item) => (
                    <LineCard key={`${item.matchId}-${item.leg}`} item={item} variant="sniper" />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </section>
  );
}
