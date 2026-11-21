"use client";

// ─── NEOBET Audit v14 · Forensic Audit & Rebuild Lab ────────────────────────
// The honest-control-room panel:
//   ① راستی‌آزمایی — is past performance verifiable at all? (hash chain,
//      retro-mutation counts, settlement integrity, real-market coverage)
//   ② بک‌تست تیپ A — «اگر فقط روی تیپ A ورود می‌شد؟» Tip A only vs Tip B
//      vs the dutched portfolio, plus the reality-adjusted scenario.
//   ③ پوشش دسته‌ها — performance coverage of every flashcard category.
//   ④ واقعیت ضرایب — stored real quotes (ESPN/Polymarket/…) vs card prices,
//      with the operator entry form for BetForward/1xBet board prices.
//   ⑤ معماری بازسازی — the v2 architecture blueprint.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LineChart,
  RefreshCw,
  Scale,
  ScanSearch,
  Sigma,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";

interface Slice {
  n: number;
  won: number;
  lost: number;
  pending: number;
  staked: number;
  profit: number;
  roiPct: number;
  winRatePct: number;
}

interface AuditPayload {
  generatedAt: string;
  verifiability: {
    hashChain: {
      total: number;
      pass: number;
      fail: number;
      passRatePct: number;
      failSamples: Array<{ eventKey: string; players: string; historyVersion: number }>;
    };
    historyMigrations: Record<string, number>;
    settlement: { settled: number; timeTravel: number; unitAnomaly: number; verdict: string };
    marketFeed: {
      liveMatches: number;
      withRealMarketProb: number;
      coveragePct: number;
      verdict: string;
      health: { espnOdds: { attempted: number; got: number }; polymarket: { ok: boolean; status: number | string }; manualQuotes: number; refreshedAt: string } | null;
    };
  };
  selection: {
    modelEdgeByConstructionPct: number;
    interpretation: string;
    tipAHitRatePct: number;
    tipBHitRatePct: number;
    marketCalibration: { matchesWithRealMarket: number; avgAbsGapModelVsMarket: number | null; note: string };
  };
  backtest: {
    dual: BacktestBlock;
    shadow: BacktestBlock;
  };
  categories: {
    byLegFamily: CatRow[];
    byLine: CatRow[];
    byCrownTier: CatRow[];
    bySurface: CatRow[];
    byTour: CatRow[];
    byOddsSource: CatRow[];
  };
  daily: {
    perDay: Array<{ day: string } & Slice>;
    curve: Array<{ day: string; bank: number }>;
  };
  reality: {
    rows: RealityRowView[];
    observedRealFactor: number | null;
    note: string;
  };
  delivery: { ok: boolean; note: string };
}

interface BacktestBlock {
  tipAOnly: Slice;
  tipBOnly: Slice;
  portfolio: Slice;
  scenarioRealPricing: { factor: number; note: string; tipAProfit: number; tipARoiPct: number };
}

interface CatRow extends Slice {
  category: string;
}

interface RealityRowView {
  eventKey: string;
  matchLabel: string;
  market: string;
  line: string;
  realPrice: number;
  source: string;
  cardOdds: number | null;
  deviationPct: number | null;
  verdict: string;
}

interface RealityMatch {
  eventKey: string;
  playerA: string;
  playerB: string;
  tournament: string;
  slipAText: string | null;
  slipAOdds: number | null;
  slipBText: string | null;
  slipBOdds: number | null;
}

const num = (v: number, digits = 1) =>
  v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function VerdictBadge({ verdict }: { verdict: string }) {
  const critical = verdict.startsWith("CRITICAL");
  const partial = verdict.startsWith("PARTIAL");
  return (
    <Badge
      className={
        critical
          ? "border-rose-400/50 bg-rose-500/15 text-rose-200"
          : partial
            ? "border-amber-400/50 bg-amber-500/15 text-amber-200"
            : "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
      }
    >
      {critical ? <AlertTriangle className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
      {critical ? "بحرانی" : partial ? "ناقص" : "سالم"}
    </Badge>
  );
}

function SliceTable({ rows, title }: { rows: CatRow[]; title: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-black text-cyan-200">{title}</p>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-white/10">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10">
              <TableHead className="text-[10px] text-muted-foreground">دسته</TableHead>
              <TableHead className="text-center text-[10px] text-muted-foreground">تعداد</TableHead>
              <TableHead className="text-center text-[10px] text-muted-foreground">برد</TableHead>
              <TableHead className="text-center text-[10px] text-muted-foreground">باخت</TableHead>
              <TableHead className="text-center text-[10px] text-muted-foreground">وین‌ریت</TableHead>
              <TableHead className="text-center text-[10px] text-muted-foreground">استیک (u)</TableHead>
              <TableHead className="text-center text-[10px] text-muted-foreground">سود (u)</TableHead>
              <TableHead className="text-center text-[10px] text-muted-foreground">ROI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.category} className="border-white/5">
                <TableCell className="py-1.5 text-[11px] font-bold" dir="ltr">{r.category}</TableCell>
                <TableCell className="mono-num py-1.5 text-center text-[11px]">{r.n}</TableCell>
                <TableCell className="mono-num py-1.5 text-center text-[11px] text-emerald-300">{r.won}</TableCell>
                <TableCell className="mono-num py-1.5 text-center text-[11px] text-rose-300">{r.lost}</TableCell>
                <TableCell className="mono-num py-1.5 text-center text-[11px]">{num(r.winRatePct)}٪</TableCell>
                <TableCell className="mono-num py-1.5 text-center text-[11px]">{num(r.staked)}</TableCell>
                <TableCell className={`mono-num py-1.5 text-center text-[11px] font-bold ${r.profit >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {r.profit >= 0 ? "+" : ""}{num(r.profit, 2)}
                </TableCell>
                <TableCell className={`mono-num py-1.5 text-center text-[11px] font-black ${r.roiPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {r.roiPct >= 0 ? "+" : ""}{num(r.roiPct)}٪
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function BacktestCard({ block, label, tone }: { block: BacktestBlock; label: string; tone: "user" | "internal" }) {
  const rows: Array<{ k: string; s: Slice; accent?: boolean }> = [
    { k: "فقط تیپ A", s: block.tipAOnly, accent: true },
    { k: "فقط تیپ B", s: block.tipBOnly },
    { k: "پرتفوی داچینگ (A+B)", s: block.portfolio },
  ];
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12px] font-black text-white">{label}</p>
        <Badge className={tone === "user" ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" : "border-white/20 bg-white/5 text-white/60"}>
          {tone === "user" ? "خط کاربر (روی کارت‌ها)" : "خط داخلی شبح"}
        </Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="border-white/10">
            <TableHead className="text-[10px]">استراتژی</TableHead>
            <TableHead className="text-center text-[10px]">ن</TableHead>
            <TableHead className="text-center text-[10px]">برد/باخت</TableHead>
            <TableHead className="text-center text-[10px]">وین‌ریت</TableHead>
            <TableHead className="text-center text-[10px]">استیک</TableHead>
            <TableHead className="text-center text-[10px]">سود</TableHead>
            <TableHead className="text-center text-[10px]">ROI</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ k, s, accent }) => (
            <TableRow key={k} className={accent ? "border-white/5 bg-cyan-400/[0.04]" : "border-white/5"}>
              <TableCell className="py-1.5 text-[11px] font-bold">{k}</TableCell>
              <TableCell className="mono-num py-1.5 text-center text-[11px]">{s.n}</TableCell>
              <TableCell className="mono-num py-1.5 text-center text-[11px]">
                <span className="text-emerald-300">{s.won}</span>/<span className="text-rose-300">{s.lost}</span>
                {s.pending > 0 && <span className="text-white/40"> (+{s.pending}⏳)</span>}
              </TableCell>
              <TableCell className="mono-num py-1.5 text-center text-[11px]">{num(s.winRatePct)}٪</TableCell>
              <TableCell className="mono-num py-1.5 text-center text-[11px]">{num(s.staked)}</TableCell>
              <TableCell className={`mono-num py-1.5 text-center text-[11px] font-bold ${s.profit >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {s.profit >= 0 ? "+" : ""}{num(s.profit, 2)}
              </TableCell>
              <TableCell className={`mono-num py-1.5 text-center text-[11px] font-black ${s.roiPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {s.roiPct >= 0 ? "+" : ""}{num(s.roiPct)}٪
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] p-2">
        <p className="text-[10.5px] font-bold leading-5 text-amber-200">
          🧪 سناریوی واقعی‌سازی: اگر همان بردها با ضرایب واقعی بازار (فاکتور {block.scenarioRealPricing.factor}) تسویه می‌شدند،
          تیپ A فقط <span className="mono-num" dir="ltr">
            {block.scenarioRealPricing.tipAProfit >= 0 ? "+" : ""}{num(block.scenarioRealPricing.tipAProfit, 2)}u ({block.scenarioRealPricing.tipARoiPct >= 0 ? "+" : ""}{num(block.scenarioRealPricing.tipARoiPct)}٪)
          </span>{" "}
          می‌شد — نه عدد روی کارت.
        </p>
        <p className="mt-1 text-[9.5px] leading-4 text-white/45" dir="ltr">{block.scenarioRealPricing.note}</p>
      </div>
    </div>
  );
}

export function AuditLab() {
  const [data, setData] = useState<AuditPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [realMatches, setRealMatches] = useState<RealityMatch[]>([]);
  const [quoteForm, setQuoteForm] = useState({ eventKey: "", market: "GH_F35", line: "-3.5", price: "" });
  const [quoteMsg, setQuoteMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/tennis/audit", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "audit fetch failed");
      setData(json as AuditPayload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "خطا در دریافت گزارش");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRealityMatches = useCallback(async () => {
    try {
      const res = await fetch("/api/tennis/reality", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setRealMatches((json.matches ?? []) as RealityMatch[]);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadRealityMatches();
  }, [load, loadRealityMatches]);

  const submitQuote = useCallback(async () => {
    setQuoteMsg(null);
    try {
      const res = await fetch("/api/tennis/reality", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventKey: quoteForm.eventKey,
          market: quoteForm.market,
          line: quoteForm.line,
          price: Number(quoteForm.price),
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "ثبت ناموفق");
      setQuoteMsg("✔ ضریب واقعی ثبت و قفل شد — چرخه بعدی موتور همین ضریب را روی کارت می‌بندد.");
      void loadRealityMatches();
    } catch (e) {
      setQuoteMsg(e instanceof Error ? `✖ ${e.message}` : "✖ ثبت ناموفق");
    }
  }, [quoteForm, loadRealityMatches]);

  const v = data?.verifiability;
  const sel = data?.selection;

  return (
    <Card className="border-cyan-400/25 bg-slate-950/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base font-black text-white">
            <ScanSearch className="h-5 w-5 text-cyan-300" />
            آزمایشگاه راستی‌آزمایی و بازسازی معماری — v14
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-8 border-cyan-400/40 text-cyan-200">
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            اجرای مجدد ممیزی
          </Button>
        </div>
        {data && (
          <p className="mono-num text-[10px] text-white/40" dir="ltr">
            generated {new Date(data.generatedAt).toLocaleString("en-GB")} · delivery {data.delivery.ok ? "live" : data.delivery.note}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {err && (
          <div className="mb-3 rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-[12px] font-bold text-rose-200" role="alert">
            {err}
          </div>
        )}

        <Tabs defaultValue="verify">
          <TabsList className="flex-wrap border-white/10 bg-black/40">
            <TabsTrigger value="verify" className="gap-1.5 data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-200">
              <ScanSearch className="h-3.5 w-3.5" /> راستی‌آزمایی
            </TabsTrigger>
            <TabsTrigger value="backtest" className="gap-1.5 data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-200">
              <Scale className="h-3.5 w-3.5" /> بک‌تست تیپ A
            </TabsTrigger>
            <TabsTrigger value="categories" className="gap-1.5 data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-200">
              <Sigma className="h-3.5 w-3.5" /> پوشش دسته‌ها
            </TabsTrigger>
            <TabsTrigger value="reality" className="gap-1.5 data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-200">
              <LineChart className="h-3.5 w-3.5" /> واقعیت ضرایب
            </TabsTrigger>
            <TabsTrigger value="arch" className="gap-1.5 data-[state=active]:bg-cyan-400/15 data-[state=active]:text-cyan-200">
              <Wrench className="h-3.5 w-3.5" /> معماری بازسازی
            </TabsTrigger>
          </TabsList>

          {/* ① VERIFIABILITY */}
          <TabsContent value="verify" className="mt-3 space-y-3">
            {v && (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[11px] font-black text-white">🔗 زنجیره هش SHA-256</p>
                    <p className="mono-num mt-1 text-2xl font-black text-cyan-200" dir="ltr">{num(v.hashChain.passRatePct)}٪</p>
                    <p className="mono-num mt-0.5 text-[10px] text-white/50" dir="ltr">
                      PASS {v.hashChain.pass} / FAIL {v.hashChain.fail} / TOTAL {v.hashChain.total}
                    </p>
                    <p className="mt-1.5 text-[10px] leading-4 text-rose-200/80">
                      {v.hashChain.fail > 0
                        ? "ردیف‌های فِیل یعنی متن/ضریبِ همان بازی بعد از ثبت، بازنویسی شده (مهاجرت‌های v13) — عملکرد گذشته قابل راستی‌آزمایی کامل نیست."
                        : "همه ردیف‌ها با قفل هش سازگارند."}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[11px] font-black text-white">🕰️ صحت تسویه</p>
                    <p className="mono-num mt-1 text-2xl font-black text-amber-200" dir="ltr">{v.settlement.settled}</p>
                    <p className="mono-num mt-0.5 text-[10px] text-white/50" dir="ltr">
                      time-travel picks: {v.settlement.timeTravel}
                    </p>
                    <p className="mt-1.5 text-[10px] leading-4 text-white/60">{v.settlement.verdict}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(v.historyMigrations).map(([k, n]) => (
                        <Badge key={k} className="border-white/15 bg-white/5 text-[9px] text-white/70" dir="ltr">
                          historyVersion {k}: {n}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[11px] font-black text-white">📡 سلامت فید ضرایب واقعی</p>
                    <div className="mt-1"><VerdictBadge verdict={v.marketFeed.verdict} /></div>
                    <p className="mono-num mt-1.5 text-[10px] text-white/60" dir="ltr">
                      live matches {v.marketFeed.liveMatches} · with real market prob {v.marketFeed.withRealMarketProb} ({v.marketFeed.coveragePct}٪)
                    </p>
                    {v.marketFeed.health && (
                      <p className="mono-num mt-0.5 text-[10px] text-white/50" dir="ltr">
                        ESPN quotes {v.marketFeed.health.espnOdds.got}/{v.marketFeed.health.espnOdds.attempted} · Polymarket {String(v.marketFeed.health.polymarket.status)} · manual {v.marketFeed.health.manualQuotes}
                      </p>
                    )}
                    <p className="mt-1.5 text-[10px] leading-4 text-white/60">
                      پوشش صفر یعنی هیچ کارتی با قیمت واقعی بازار تولید نشده — دقیقاً همان شکایت «ضرایب با واقعیت اختلاف زیادی دارد».
                    </p>
                  </div>
                </div>
                {v.hashChain.failSamples.length > 0 && (
                  <div className="rounded-lg border border-rose-400/30 bg-rose-500/[0.07] p-2">
                    <p className="text-[10px] font-black text-rose-200">نمونه ردیف‌های بازنویسی‌شده:</p>
                    <div className="mono-num mt-1 grid gap-0.5 text-[9.5px] text-rose-200/70" dir="ltr">
                      {v.hashChain.failSamples.map((s) => (
                        <span key={s.eventKey}>#{s.eventKey} {s.players} (hV{s.historyVersion})</span>
                      ))}
                    </div>
                  </div>
                )}
                {sel && (
                  <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.05] p-3">
                    <p className="text-[11px] font-black text-cyan-200">🎯 منطق انتخاب تیپ‌ها — ضرایب یا احتمال؟</p>
                    <p className="mt-1 text-[11px] leading-5 text-white/75">{sel.interpretation}</p>
                    <div className="mono-num mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-white/60" dir="ltr">
                      <span>model edge by construction: {sel.modelEdgeByConstructionPct >= 0 ? "+" : ""}{num(sel.modelEdgeByConstructionPct)}٪</span>
                      <span>tip A hit: {num(sel.tipAHitRatePct)}٪</span>
                      <span>tip B hit: {num(sel.tipBHitRatePct)}٪</span>
                      <span>matches with real market prob: {sel.marketCalibration.matchesWithRealMarket}</span>
                      {sel.marketCalibration.avgAbsGapModelVsMarket !== null && (
                        <span>avg |model − market| gap: {num(sel.marketCalibration.avgAbsGapModelVsMarket * 100, 1)} pts</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ② BACKTEST */}
          <TabsContent value="backtest" className="mt-3 space-y-3">
            {data && (
              <>
                <BacktestCard block={data.backtest.dual} label="زوج‌تیپ رسمی (DUAL) — خطی که واقعاً روی کارت‌ها رفت" tone="user" />
                <BacktestCard block={data.backtest.shadow} label="خط شبح (SHADOW) — ردیابی داخلی؛ ضرایبش 1/prob خالص مدل است" tone="internal" />
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="text-[11px] font-black text-white">📅 منحنی رشد بانک (DUAL، روزهای تهران)</p>
                  <div className="mono-num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px]" dir="ltr">
                    {data.daily.curve.map((p) => (
                      <span key={p.day} className={p.bank >= 0 ? "text-emerald-300/80" : "text-rose-300/80"}>
                        {p.day}: {p.bank >= 0 ? "+" : ""}{num(p.bank, 1)}u
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* ③ CATEGORIES */}
          <TabsContent value="categories" className="mt-3 space-y-3">
            {data && (
              <>
                <SliceTable rows={data.categories.byLegFamily} title="پوشش عملکرد بر اساس خانواده بازار (هر دسته فلش‌کارت)" />
                <div className="grid gap-3 lg:grid-cols-2">
                  <SliceTable rows={data.categories.byLine} title="بر اساس خط تولید" />
                  <SliceTable rows={data.categories.byCrownTier} title="بر اساس تاج سوپروایزر" />
                  <SliceTable rows={data.categories.bySurface} title="بر اساس سطح زمین" />
                  <SliceTable rows={data.categories.byTour} title="بر اساس تور" />
                  <SliceTable rows={data.categories.byOddsSource} title="بر اساس منبع ضریب (پروواننس جدید)" />
                </div>
              </>
            )}
          </TabsContent>

          {/* ④ ODDS REALITY */}
          <TabsContent value="reality" className="mt-3 space-y-3">
            {data && (
              <>
                <p className="text-[10.5px] leading-5 text-white/60">{data.reality.note}</p>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-white/10">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10">
                        <TableHead className="text-[10px]">بازی</TableHead>
                        <TableHead className="text-[10px]" dir="ltr">MARKET</TableHead>
                        <TableHead className="text-center text-[10px]">ضریب واقعی</TableHead>
                        <TableHead className="text-center text-[10px]">منبع</TableHead>
                        <TableHead className="text-center text-[10px]">ضریب کارت</TableHead>
                        <TableHead className="text-center text-[10px]">انحراف</TableHead>
                        <TableHead className="text-center text-[10px]">حکم</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.reality.rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="py-4 text-center text-[11px] text-white/50">
                            هنوز هیچ ضریب واقعی ثبت نشده — با فرم زیر اولین ضریب را وارد کنید.
                          </TableCell>
                        </TableRow>
                      )}
                      {data.reality.rows.map((r) => (
                        <TableRow key={`${r.eventKey}-${r.market}`} className="border-white/5">
                          <TableCell className="py-1.5 text-[10.5px] font-bold" dir="ltr">{r.matchLabel}</TableCell>
                          <TableCell className="mono-num py-1.5 text-[10px]" dir="ltr">{r.market}{r.line && ` ${r.line}`}</TableCell>
                          <TableCell className="mono-num py-1.5 text-center text-[11px] font-black text-cyan-200" dir="ltr">{num(r.realPrice, 2)}</TableCell>
                          <TableCell className="py-1.5 text-center"><Badge className="border-white/15 bg-white/5 text-[9px] text-white/70">{r.source}</Badge></TableCell>
                          <TableCell className="mono-num py-1.5 text-center text-[11px]" dir="ltr">{r.cardOdds ? num(r.cardOdds, 2) : "—"}</TableCell>
                          <TableCell className={`mono-num py-1.5 text-center text-[11px] font-bold ${r.deviationPct && r.deviationPct > 0 ? "text-rose-300" : "text-emerald-300"}`} dir="ltr">
                            {r.deviationPct === null ? "—" : `${r.deviationPct > 0 ? "+" : ""}${num(r.deviationPct)}٪`}
                          </TableCell>
                          <TableCell className="py-1.5 text-center text-[9.5px]">
                            {r.verdict === "CARD_INFLATED" ? "⚠️ کارت متورم" : r.verdict === "CARD_CHEAP" ? "ارزان‌تر از بازار" : r.verdict === "ALIGNED" ? "همسو" : "بدون کارت"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* manual quote entry — the human-in-the-loop reality lock */}
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-3">
                  <p className="text-[11px] font-black text-emerald-200">
                    ✍️ قفل ضریب واقعی (BetForward / 1xBet) — ضریبی که روی تابلو می‌بینید را ثبت کنید؛ چرخه بعدی موتور همین را چاپ می‌کند
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <select
                      className="rounded-lg border border-emerald-400/40 bg-black/50 px-2 py-2 text-[11px] text-white"
                      value={quoteForm.eventKey}
                      onChange={(e) => setQuoteForm((f) => ({ ...f, eventKey: e.target.value }))}
                      aria-label="انتخاب بازی"
                    >
                      <option value="">— بازی را انتخاب کنید —</option>
                      {realMatches.map((m) => (
                        <option key={m.eventKey} value={m.eventKey} dir="ltr">
                          {m.playerA} v {m.playerB}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-lg border border-emerald-400/40 bg-black/50 px-2 py-2 text-[11px] text-white"
                      value={quoteForm.market}
                      onChange={(e) => {
                        const presets: Record<string, string> = {
                          GH_F35: "-3.5", TS_O25: "2.5", TG_O205: "20.5", TG_U215: "21.5", SB_2_0: "", SB_2_1: "", MW_A: "", TG_O225: "22.5",
                        };
                        setQuoteForm((f) => ({ ...f, market: e.target.value, line: presets[e.target.value] ?? f.line }));
                      }}
                      aria-label="انتخاب بازار"
                    >
                      <option value="GH_F35" dir="ltr">GAME HANDICAP −3.5</option>
                      <option value="TS_O25" dir="ltr">TOTAL SETS OVER 2.5</option>
                      <option value="TG_O205" dir="ltr">TOTAL GAMES OVER 20.5</option>
                      <option value="TG_O225" dir="ltr">TOTAL GAMES OVER 22.5</option>
                      <option value="TG_U215" dir="ltr">TOTAL GAMES UNDER 21.5</option>
                      <option value="SB_2_0" dir="ltr">SET BETTING 2-0</option>
                      <option value="SB_2_1" dir="ltr">SET BETTING 2-1</option>
                      <option value="MW_A" dir="ltr">MATCH WINNER</option>
                    </select>
                    <Input
                      className="mono-num h-9 border-emerald-400/40 bg-black/50 text-center text-[12px] text-white"
                      placeholder="line (مثلا -3.5)"
                      value={quoteForm.line}
                      onChange={(e) => setQuoteForm((f) => ({ ...f, line: e.target.value }))}
                      dir="ltr"
                      aria-label="خط بازار"
                    />
                    <Input
                      className="mono-num h-9 border-emerald-400/40 bg-black/50 text-center text-[12px] font-black text-white"
                      placeholder="ضریب (مثلا 1.88)"
                      inputMode="decimal"
                      value={quoteForm.price}
                      onChange={(e) => setQuoteForm((f) => ({ ...f, price: e.target.value }))}
                      dir="ltr"
                      aria-label="ضریب واقعی"
                    />
                    <Button
                      size="sm"
                      className="h-9 bg-emerald-500/90 font-black text-white hover:bg-emerald-400"
                      onClick={() => void submitQuote()}
                      disabled={!quoteForm.eventKey || !quoteForm.price}
                    >
                      قفل ضریب واقعی
                    </Button>
                  </div>
                  {quoteMsg && <p className="mt-2 text-[10.5px] font-bold text-emerald-200">{quoteMsg}</p>}
                </div>
              </>
            )}
          </TabsContent>

          {/* ⑤ ARCHITECTURE V2 */}
          <TabsContent value="arch" className="mt-3">
            <div className="space-y-2.5 text-[11.5px] leading-6 text-white/75">
              <p className="text-[12px] font-black text-cyan-200">اگر معماری را از صفر بازسازی می‌کردم — نقشه v2 (شواهدمحور، نه ادعامحور):</p>
              <ol className="list-inside list-decimal space-y-2">
                <li>
                  <b className="text-white">لایه ۱ · بازار واقعی (Market Ground Truth):</b> همه چیز از قیمت واقعی شروع می‌شود، نه مدل. ESPN Core + Polymarket به‌عنوان فید خودکار؛ ثبت دستی ضرایب تابلوی BetForward/1xBet در پنل «واقعیت ضرایب»؛ هر کوت فقط با منبع + timestamp در RealOddsQuote. هیچ ضریب ساختگی دیگر تولید نمی‌شود؛ اگر بازاری واقعی نبود، روی کارت برچسب «ضرایب مدل — با سایت مقایسه کنید» می‌خورد.
                </li>
                <li>
                  <b className="text-white">لایه ۲ · مدل احتمال (Calibrated Model):</b> مارکوف/کاپولا فقط «احتمال» تولید می‌کند و باید خودش را با خط بسته بازار (Closing Line) بسنجد؛ معیار اصلی سلامت مدل = خطای کالیبراسیون (Brier/CLV) که همین حالا در گزارش دیده می‌شود. سود ادعایی هرگز از «odds × prob همان مدل» محاسبه نمی‌شود.
                </li>
                <li>
                  <b className="text-white">لایه ۳ · موتور ارزش (Value Engine):</b> edge واقعی = p_model × odds_واقعی − 1؛ تیپ فقط وقتی صادر می‌شود که edge مثبت روی ضریبِ بازار باشد، نه روی ضریب داخلی. انتخاب تیپ = ارزش واقعی؛ dutching فقط ابزار ریسک است، نه جادوی «سود قطعی».
                </li>
                <li>
                  <b className="text-white">لایه ۴ · دفتر تغییرناپذیر (Immutable Ledger):</b> دفتر فقط-الحاق (append-only) با زنجیره هش؛ تسویه فقط ردیف PENDING را می‌بندد؛ هر اصلاح = ردیف جدید با ارجاع، نه بازنویسی. مهاجرت‌های گذشته‌نگر (v13) به‌طور پیش‌فرض غیرفعال شد.
                </li>
                <li>
                  <b className="text-white">لایه ۵ · رییس‌جمهور ریسک (Portfolio Risk):</b> بودجه روزانه، سقف ضرر، همبستگی بین بازی‌ها (چند تیپ از یک تورنمنت = ریسک مشترک) و گزارش شارپ واقعی روی ضرایب بازار.
                </li>
                <li>
                  <b className="text-white">لایه ۶ · گزارش صادق (Honest Reporting):</b> وین‌ریت تبلیغاتی فقط از ردیف‌های «هش سالم + ضریب واقعی» محاسبه می‌شود؛ هر کارت برچسب منبع ضریب دارد؛ منحنی رشد بانک از همان دفتر تغییرناپذیر خوانده می‌شود.
                </li>
                <li>
                  <b className="text-white">لایه ۷ · آزمایشگاه بک‌تست:</b> هر قاعده (RC A، گیت‌ها، خانواده‌های QQL) به‌صورت پارامتر روی داده گذشته با ضرایب ثبت‌شده آزمایش می‌شود؛ خروجی همین تب «بک‌تست» است — تصمیم با عدد، نه با حس.
                </li>
              </ol>
              <p className="rounded-lg border border-cyan-400/25 bg-cyan-400/[0.06] p-2.5 text-[10.5px] leading-5 text-cyan-100/80">
                جمع‌بندی صادقانه: معماری فعلی «مدل → ضریب ساختگی → سود ادعایی» است؛ معماری v2 «بازار → احتمال → ارزش واقعی → دفتر تغییرناپذیر» است. مهاجرت این دو، تفاوت بین یک داشبورد تزئینی و یک سیستم معاملاتی واقعی است.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
