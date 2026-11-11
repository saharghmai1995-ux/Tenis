"use client";

// ─── NeoTennis Markov Quant v3.0 — 3D Multi-Ring Win-Rate Gyroscope ────────
// Replaces the flat v2.0 semicircle gauge: three concentric light rings
// rotating slowly in opposite directions (SVG stroke-dasharray + CSS 3D
// rotation) with floating light particles around the combined win rate.

import { useMemo } from "react";

function ring(
  cx: number,
  cy: number,
  r: number,
  circumference: number,
  filled: number,
  color: string,
  width: number,
  key: string,
  dashGap = 0
) {
  const dash = dashGap > 0 ? `${circumference / (dashGap * 2)} ${circumference / (dashGap * 2)}` : undefined;
  return (
    <g key={key}>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={width}
      />
      {dashGap > 0 ? (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeDasharray={dash}
          opacity={0.28}
          strokeLinecap="round"
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        style={{
          transition: "stroke-dasharray 1.2s cubic-bezier(0.22,1,0.36,1)",
          filter: `drop-shadow(0 0 6px ${color})`,
        }}
      />
    </g>
  );
}

export function GyroGauge({
  rate,
  dualRate,
  roiRate,
}: {
  rate: number; // combined win rate 0..1
  dualRate: number; // DUAL line match-level win rate 0..1
  roiRate: number; // ROI 0..1 (clamped)
}) {
  const pct = Math.max(0, Math.min(1, rate));
  const dualPct = Math.max(0, Math.min(1, dualRate));
  const roiPct = Math.max(0.05, Math.min(1, roiRate));

  const rings = useMemo(() => {
    const cx = 110;
    const cy = 110;
    return [
      { r: 92, c: 2 * Math.PI * 92, f: 2 * Math.PI * 92 * pct, color: "#34d399", w: 9 },
      { r: 74, c: 2 * Math.PI * 74, f: 2 * Math.PI * 74 * dualPct, color: "#fbbf24", w: 7 },
      { r: 57, c: 2 * Math.PI * 57, f: 2 * Math.PI * 57 * roiPct, color: "#22d3ee", w: 5 },
    ];
  }, [pct, dualPct, roiPct]);

  return (
    <div className="gyro-stage relative flex flex-col items-center">
      {/* floating light particles */}
      <span aria-hidden className="float-particle absolute left-3 top-6 h-1.5 w-1.5 rounded-full bg-emerald-300/70" />
      <span aria-hidden className="float-particle absolute right-5 top-10 h-1 w-1 rounded-full bg-cyan-300/70" style={{ animationDelay: "0.8s" }} />
      <span aria-hidden className="float-particle absolute bottom-10 left-8 h-1 w-1 rounded-full bg-amber-300/70" style={{ animationDelay: "1.6s" }} />
      <span aria-hidden className="float-particle absolute bottom-4 right-10 h-1.5 w-1.5 rounded-full bg-white/50" style={{ animationDelay: "2.4s" }} />

      <svg viewBox="0 0 220 220" className="w-full max-w-[240px]" role="img" aria-label={`وین‌ریت ترکیبی ${(pct * 100).toFixed(1)} درصد`}>
        <defs>
          <linearGradient id="gyroOuter" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <g className="gyro-spin-cw">{ring(110, 110, rings[0].r, rings[0].c, rings[0].f, "url(#gyroOuter)", rings[0].w, "outer", 26)}</g>
        <g className="gyro-spin-ccw">{ring(110, 110, rings[1].r, rings[1].c, rings[1].f, "#fbbf24", rings[1].w, "mid", 18)}</g>
        <g className="gyro-spin-cw-fast">{ring(110, 110, rings[2].r, rings[2].c, rings[2].f, "#22d3ee", rings[2].w, "inner")}</g>
        {/* hub */}
        <circle cx="110" cy="110" r="44" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.14)" />
        <text
          x="110"
          y="106"
          textAnchor="middle"
          className="mono-num"
          fill="white"
          fontSize="30"
          fontWeight="800"
        >
          {(pct * 100).toFixed(1)}%
        </text>
        <text x="110" y="126" textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="9">
          COMBINED WIN RATE
        </text>
      </svg>

      {/* ring legend */}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> وین‌ریت ترکیبی
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> زوج‌تیپ در سطح مسابقه
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> بازده روی سرمایه
        </span>
      </div>
    </div>
  );
}
