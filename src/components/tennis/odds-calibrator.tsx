"use client";

// ─── v6.0 · Live 1xBet Tennis Odds Calibrator (master-prompt §4) ────────────
// Two quick odds boxes («ضریب فعلی در 1xBet شما» — Tip A / Tip B) prefilled
// with the card's real 1xBet model prices. The instant the director types the
// odds he actually sees on the 1xBet board, the panel re-computes:
//   • the exact equal-profit 100-unit stake split (Stake A / Stake B)
//   • the guaranteed net profit (or loss) of the dutched position
//   • the combined inverse-sum 1/O_A + 1/O_B (the board margin actually taken)
// and when the inverse-sum crosses 0.97 (odds collapsed on 1xBet), a red
// warning card fires: «سود داچینگ کافی نیست — تغییر خودکار به رژیم بانکر / استاپ».

import { useMemo, useState } from "react";
import { AlertTriangle, Calculator, TrendingUp } from "lucide-react";

export interface CalibratorLeg {
  label: string;        // تیپ A / تیپ B / تیپ اصلی / پوشش
  labelEn: string;      // TYPE A / TYPE B
  modelOdds: number;    // the card's real-1xBet model price
  marketEn?: string;    // official market name (context row)
  eventKey?: string;    // ESPN event key — enables the REAL-QUOTE LOCK
  leg?: string;         // engine leg code — resolves the market to lock
}

/** Audit v14 — map an engine leg code to its real-market coordinates. */
export function marketOfLeg(leg?: string): { market: string; line: string } | null {
  const l = leg ?? "";
  if (/^A(-|$)/.test(l) || /^B(-|$)/.test(l) || l.startsWith("A-O") || l.startsWith("B-A"))
    return { market: "MW_A", line: "" };
  if (l.startsWith("SB-P1-20") || l.includes("SB-F20") || l === "T1-SB-F20") return { market: "SB_2_0", line: "" };
  if (l.startsWith("SB-P1-21") || l.includes("SB-F21") || l === "T2-SB-F21") return { market: "SB_2_1", line: "" };
  if (l.startsWith("TS-O25")) return { market: "TS_O25", line: "2.5" };
  if (l.startsWith("TG-O205")) return { market: "TG_O205", line: "20.5" };
  if (l.startsWith("TG-O225")) return { market: "TG_O225", line: "22.5" };
  if (l.startsWith("TG-U205")) return { market: "TG_U205", line: "20.5" };
  if (l.startsWith("TG-U215")) return { market: "TG_U215", line: "21.5" };
  if (l.startsWith("GH-F35")) return { market: "GH_F35", line: "-3.5" };
  if (l.startsWith("GH-F45")) return { market: "GH_F45", line: "-4.5" };
  return null;
}

interface SplitResult {
  stakeA: number;
  stakeB: number;
  netProfit: number;      // guaranteed units when either wing wins
  inverseSum: number;     // 1/O_A + 1/O_B
  collapsed: boolean;     // inverseSum >= 0.97 → dutching no longer profitable
  positive: boolean;      // netProfit > 0
}

function dutchSplit(oA: number, oB: number, total = 100): SplitResult {
  const invA = 1 / Math.max(oA, 1.01);
  const invB = 1 / Math.max(oB, 1.01);
  const s = invA + invB;
  const stakeA = Math.round(((total * invA) / s) * 10) / 10;
  const stakeB = Math.round((total - stakeA) * 10) / 10;
  const payA = stakeA * oA - total;
  const payB = stakeB * oB - total;
  const netProfit = Math.round(Math.min(payA, payB) * 10) / 10;
  const inverseSum = invA + invB;
  return {
    stakeA,
    stakeB,
    netProfit,
    inverseSum: Math.round(inverseSum * 1000) / 1000,
    collapsed: inverseSum >= 0.97,
    positive: netProfit > 0,
  };
}

const num = (raw: string, fallback: number): number => {
  const v = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(v) && v >= 1.01 && v <= 50 ? v : fallback;
};

export function OddsCalibrator({
  legA,
  legB,
  matchLabel,
}: {
  legA: CalibratorLeg;
  legB: CalibratorLeg;
  matchLabel: string;
}) {
  // prefill glued to the model board when the card re-prices.
  // React-recommended "adjust state during render" pattern (no effect):
  // whenever the underlying model odds change, the typed drafts reset to them.
  const [draft, setDraft] = useState({
    a: legA.modelOdds.toFixed(2),
    b: legB.modelOdds.toFixed(2),
    modelA: legA.modelOdds,
    modelB: legB.modelOdds,
  });
  if (draft.modelA !== legA.modelOdds || draft.modelB !== legB.modelOdds) {
    const next = {
      a: legA.modelOdds.toFixed(2),
      b: legB.modelOdds.toFixed(2),
      modelA: legA.modelOdds,
      modelB: legB.modelOdds,
    };
    setDraft(next);
  }
  const { a: oddsA, b: oddsB } = draft;

  const live = useMemo(
    () => dutchSplit(num(oddsA, legA.modelOdds), num(oddsB, legB.modelOdds)),
    [oddsA, oddsB, legA.modelOdds, legB.modelOdds]
  );

  const model = useMemo(
    () => dutchSplit(legA.modelOdds, legB.modelOdds),
    [legA.modelOdds, legB.modelOdds]
  );

  const [lockState, setLockState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  const lockRealQuote = async (leg: CalibratorLeg, typedOdds: number) => {
    if (!leg.eventKey) return;
    const mk = marketOfLeg(leg.leg);
    if (!mk) return;
    setLockState("saving");
    setLockMsg(null);
    try {
      const res = await fetch("/api/tennis/reality", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventKey: leg.eventKey, market: mk.market, line: mk.line, price: typedOdds, matchLabel }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "ثبت ناموفق");
      setLockState("done");
      setLockMsg(`✔ ضریب واقعی ${typedOdds.toFixed(2)} برای ${mk.market}${mk.line ? ` ${mk.line}` : ""} قفل شد — چرخه بعدی موتور همین را چاپ می‌کند.`);
    } catch (e) {
      setLockState("error");
      setLockMsg(e instanceof Error ? `✖ ${e.message}` : "✖ ثبت ناموفق");
    }
  };

  return (
    <div
      className="mt-3 rounded-xl border border-cyan-400/30 bg-cyan-400/[0.06] p-3"
      role="group"
      aria-label="همگام‌ساز لحظه‌ای با ضریب زنده 1xBet"
    >
      {/* panel header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-cyan-200">
          <Calculator className="h-3.5 w-3.5" />
          🎛️ همگام‌ساز لحظه‌ای با ضریب زنده <span dir="ltr">1xBet</span>
        </span>
        <span className="mono-num text-[9px] font-bold tracking-wide text-cyan-300/70" dir="ltr">
          LIVE 1xBET TENNIS ODDS CALIBRATOR
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
        ضریبی که همین حالا روی تابلوی 1xBet می‌بینید را وارد کنید — تقسیم دقیق
        استیک ۱۰۰ واحدی و سود خالص قطعی فوراً بازمحاسبه می‌شود.
      </p>

      {/* two quick odds boxes */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[
          { leg: legA, value: oddsA, setter: (v: string) => setDraft((d) => ({ ...d, a: v })) },
          { leg: legB, value: oddsB, setter: (v: string) => setDraft((d) => ({ ...d, b: v })) },
        ].map(({ leg, value, setter }) => (
          <label key={leg.labelEn} className="block">
            <span className="mb-1 block text-[10px] font-bold text-cyan-200/90">
              {leg.label} — ضریب فعلی در <span dir="ltr">1xBet</span> شما
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="1.01"
              max="50"
              value={value}
              onChange={(e) => setter(e.target.value)}
              className="mono-num w-full rounded-lg border border-cyan-400/40 bg-black/40 px-2.5 py-2 text-center text-base font-extrabold text-white outline-none transition focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300/40"
              dir="ltr"
              aria-label={`ضریب 1xBet برای ${leg.label}`}
            />
            {leg.marketEn && (
              <span className="mono-num mt-0.5 block truncate text-[8.5px] text-white/40" dir="ltr">
                {leg.marketEn}
              </span>
            )}
          </label>
        ))}
      </div>

      {/* live re-computed split */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-black/30 p-2 text-center">
          <div className="text-[9px] text-muted-foreground">استیک {legA.label}</div>
          <div className="mono-num text-sm font-extrabold text-amber-200" dir="ltr">
            {live.stakeA.toFixed(1)}u
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/30 p-2 text-center">
          <div className="text-[9px] text-muted-foreground">استیک {legB.label}</div>
          <div className="mono-num text-sm font-extrabold text-emerald-200" dir="ltr">
            {live.stakeB.toFixed(1)}u
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/30 p-2 text-center">
          <div className="text-[9px] text-muted-foreground">مجموع معکوس</div>
          <div className={`mono-num text-sm font-extrabold ${live.collapsed ? "text-rose-300" : "text-cyan-200"}`} dir="ltr">
            {live.inverseSum.toFixed(3)}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/30 p-2 text-center">
          <div className="text-[9px] text-muted-foreground">سود خالص قطعی</div>
          <div className={`mono-num text-sm font-extrabold ${live.positive ? "text-emerald-300" : "text-rose-300"}`} dir="ltr">
            {live.netProfit >= 0 ? "+" : ""}
            {live.netProfit.toFixed(1)}u
          </div>
        </div>
      </div>

      {/* model-vs-board delta row */}
      <p className="mono-num mt-1.5 text-center text-[9.5px] text-white/50" dir="ltr">
        MODEL BOARD: {legA.modelOdds.toFixed(2)} / {legB.modelOdds.toFixed(2)} →
        NET {model.netProfit >= 0 ? "+" : ""}
        {model.netProfit.toFixed(1)}u · YOUR 1xBET ENTRIES ABOVE OVERRIDE THE MODEL
      </p>

      {/* 🚨 odds-collapse warning (master-prompt §4 red card) */}
      {live.collapsed ? (
        <div
          className="mt-2 flex items-start gap-2 rounded-xl border border-rose-400/50 bg-rose-500/15 p-2.5"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div>
            <p className="text-[11px] font-black leading-5 text-rose-200">
              🚨 هشدار افت ضریب در <span dir="ltr">1xBet</span> — سود داچینگ کافی نیست
            </p>
            <p className="mt-0.5 text-[10px] leading-4 text-rose-200/80">
              مجموع معکوس دو ضریب واردشده {live.inverseSum.toFixed(3)} ≥ 0.97 شده
              است — با این ضرایب هیچ تقسیم استیک ۱۰۰ واحدی سود قطعی نمی‌دهد.
              <span className="font-bold"> تغییر خودکار به رژیم بانکر / استاپ.</span>
            </p>
          </div>
        </div>
      ) : (
        live.positive && (
          <div className="mt-2 flex items-center justify-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-2 text-center">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
            <span className="text-[10.5px] font-bold text-emerald-200">
              سود خالص قطعی{" "}
              <span className="mono-num" dir="ltr">
                {live.netProfit >= 0 ? "+" : ""}
                {live.netProfit.toFixed(1)}
              </span>{" "}
              واحد از ۱۰۰ واحد در هر سناریو — ضرایب معتبر است
            </span>
          </div>
        )
      )}

      {/* v14 — REAL-QUOTE LOCK: persist the operator-verified board price */}
      {legA.eventKey && marketOfLeg(legA.leg) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-2">
          <span className="text-[10px] font-black text-emerald-200">🔒 قفل در پایگاه واقعیت بازار:</span>
          <button
            type="button"
            className="rounded-md border border-emerald-400/40 bg-emerald-500/80 px-2 py-1 text-[10px] font-black text-white transition hover:bg-emerald-400 disabled:opacity-50"
            onClick={() => void lockRealQuote(legA, num(oddsA, legA.modelOdds))}
            disabled={lockState === "saving"}
          >
            {legA.label}: {num(oddsA, legA.modelOdds).toFixed(2)}
          </button>
          <button
            type="button"
            className="rounded-md border border-emerald-400/40 bg-emerald-500/80 px-2 py-1 text-[10px] font-black text-white transition hover:bg-emerald-400 disabled:opacity-50"
            onClick={() => void lockRealQuote(legB, num(oddsB, legB.modelOdds))}
            disabled={lockState === "saving"}
          >
            {legB.label}: {num(oddsB, legB.modelOdds).toFixed(2)}
          </button>
          {lockMsg && <span className="text-[10px] font-bold text-emerald-200">{lockMsg}</span>}
        </div>
      )}

      <p className="mt-1 truncate text-center text-[9px] text-white/35" dir="ltr">
        {matchLabel}
      </p>
    </div>
  );
}
