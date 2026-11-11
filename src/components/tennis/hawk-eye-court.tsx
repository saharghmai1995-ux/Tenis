"use client";

// ─── NeoTennis Markov Quant v3.0 — 3D Isometric Hawk-Eye Court ─────────────
// Broadcast-grade telemetry widget (Hawk-Eye Live @ Grand Slams):
//   · perspective(1200px) rotateX(50deg) rotateZ(-6deg) volumetric court
//   · surface-aware texture: galactic-blue hard / Roland-Garros clay /
//     Wimbledon grass
//   · layered <svg> animated parabolic serve arcs (1st & 2nd serve)
//   · pulsing Hawk-Eye ball-bounce rings inside the service boxes
//   · serve speed + Hold % telemetry chips for both players at the net

import { useMemo } from "react";
import { Activity, Gauge, Radar } from "lucide-react";
import type { AnalyzedMatch, Surface } from "@/lib/tennis/types";

const SURFACE_CLASS: Record<Surface, string> = {
  HARD: "hawk-surface-hard",
  CLAY: "hawk-surface-clay",
  GRASS: "hawk-surface-grass",
};

const SURFACE_LABEL: Record<Surface, string> = {
  HARD: "هاردکورت کهکشانی",
  CLAY: "خاک رس رولان گاروس",
  GRASS: "چمن ویمبلدون",
};

/** deterministic model telemetry: serve speed band from calibrated p */
function serveSpeeds(p: number): { first: number; second: number } {
  const first = Math.round(178 + p * 26); // p ∈ [0.55, 0.73] → 192..197 km/h
  return { first, second: first - 16 };
}

export function HawkEyeCourt({
  match,
  compact = false,
}: {
  match: AnalyzedMatch;
  compact?: boolean;
}) {
  const { pFinalA, pFinalB } = match.reverse;
  const holdA = match.markov.gA;
  const holdB = match.markov.gB;

  const speeds = useMemo(
    () => ({
      a: serveSpeeds(pFinalA),
      b: serveSpeeds(pFinalB),
    }),
    [pFinalA, pFinalB]
  );

  // bounce targets inside the deuce/ad service boxes (court-space 0..400 × 0..240)
  const bounces = useMemo(
    () => [
      { x: 292, y: 58, d: "0s" },
      { x: 318, y: 92, d: "0.6s" },
      { x: 104, y: 150, d: "1.1s" },
      { x: 84, y: 184, d: "0.3s" },
    ],
    []
  );

  return (
    <div
      className={`${SURFACE_CLASS[match.surface]} relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-4`}
      aria-label={`رادار چشم شاهین زمین ${match.playerA.name} در برابر ${match.playerB.name}`}
    >
      {/* telemetry HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold">
          <Radar className="h-4 w-4 text-amber-300" />
          <span className="text-amber-300">3D Hawk-Eye Court Telemetry</span>
          <span className="text-[10px] font-normal text-muted-foreground">
            {SURFACE_LABEL[match.surface]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {match.playerA.shortName}
            <span className="num-capsule text-[10px] text-cyan-300">
              {speeds.a.first} km/h
            </span>
            <span className="num-capsule text-[10px] text-emerald-300">
              Hold {(holdA * 100).toFixed(1)}%
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {match.playerB.shortName}
            <span className="num-capsule text-[10px] text-cyan-300">
              {speeds.b.first} km/h
            </span>
            <span className="num-capsule text-[10px] text-emerald-300">
              Hold {(holdB * 100).toFixed(1)}%
            </span>
          </span>
        </div>
      </div>

      {/* 3D isometric stage */}
      <div className={`hawk-stage mt-3 flex justify-center ${compact ? "py-1" : "py-2"}`}>
        <div className={`hawk-tilt court-shadow relative ${compact ? "h-44 w-72" : "h-56 w-[26rem]"}`}>
          {/* court plane */}
          <div className="hawk-court-plane absolute inset-0 rounded-lg border border-white/20" />
          {/* neon court lines (absolute divs) */}
          {/* outer boundary */}
          <div className="hawk-line absolute inset-x-[8%] inset-y-[6%] rounded-[2px] border border-white/70 bg-transparent shadow-none" style={{ boxShadow: "0 0 10px var(--court-line)" }} />
          {/* service boxes */}
          <div className="hawk-line absolute left-[8%] right-[50%] top-[26%] h-[16%] border border-white/60" />
          <div className="hawk-line absolute left-[50%] right-[8%] top-[26%] h-[16%] border border-white/60" />
          <div className="hawk-line absolute left-[8%] right-[50%] bottom-[26%] h-[16%] border border-white/60" />
          <div className="hawk-line absolute left-[50%] right-[8%] bottom-[26%] h-[16%] border border-white/60" />
          {/* center service line */}
          <div className="hawk-line absolute left-1/2 top-[26%] bottom-[26%] w-px -translate-x-1/2" />
          {/* singles sidelines */}
          <div className="hawk-line absolute left-[15%] top-[6%] bottom-[6%] w-px" />
          <div className="hawk-line absolute right-[15%] top-[6%] bottom-[6%] w-px" />

          {/* animated svg overlay — parabolic serve arcs + bounce rings */}
          <svg
            viewBox="0 0 400 240"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            <defs>
              <linearGradient id="arcGradA" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#34d399" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="arcGradB" x1="1" y1="0" x2="0" y2="0">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#f472b6" stopOpacity="0.9" />
              </linearGradient>
            </defs>

            {/* first + second serve arcs — player A (bottom) serving upward */}
            <path
              d="M 200 228 C 120 190, 96 130, 106 66"
              fill="none"
              stroke="url(#arcGradA)"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="hawk-arc-1"
            />
            <path
              d="M 200 228 C 250 200, 296 150, 302 76"
              fill="none"
              stroke="url(#arcGradA)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeDasharray="5 4"
              className="hawk-arc-2"
            />
            {/* serve arcs — player B (top) serving downward */}
            <path
              d="M 200 12 C 130 50, 100 110, 96 176"
              fill="none"
              stroke="url(#arcGradB)"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="hawk-arc-1"
            />
            <path
              d="M 200 12 C 262 44, 300 96, 306 160"
              fill="none"
              stroke="url(#arcGradB)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeDasharray="5 4"
              className="hawk-arc-2"
            />

            {/* Hawk-Eye bounce rings */}
            {bounces.map((b, i) => (
              <g key={i}>
                <circle
                  cx={b.x}
                  cy={b.y}
                  r="2"
                  fill="#fff"
                  opacity="0.9"
                />
                <circle
                  cx={b.x}
                  cy={b.y}
                  r="2"
                  fill="none"
                  stroke={i % 2 === 0 ? "#34d399" : "#fbbf24"}
                  strokeWidth="1.4"
                  className="hawk-ring"
                  style={{ animationDelay: b.d }}
                />
              </g>
            ))}
          </svg>

          {/* net (3D plane hint) */}
          <div
            className="absolute inset-x-[8%] top-1/2 h-1.5 -translate-y-1/2 rounded-full border-y border-white/50 bg-gradient-to-b from-white/25 to-white/5"
            style={{ boxShadow: "0 2px 14px rgba(255,255,255,0.35)" }}
          />
          <div className="absolute left-[8%] right-[8%] top-1/2 -translate-y-1/2 text-center">
            <span className="mono-num rounded bg-black/55 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.3em] text-white/80" dir="ltr">
              NET
            </span>
          </div>

          {/* player anchors */}
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-amber-300/40 bg-black/60 px-2 py-0.5 text-[9px] font-bold text-amber-200">
            {match.playerA.shortName}
          </div>
          <div className="absolute top-1 left-1/2 -translate-x-1/2 rounded-full border border-cyan-400/40 bg-black/60 px-2 py-0.5 text-[9px] font-bold text-cyan-200">
            {match.playerB.shortName}
          </div>
        </div>
      </div>

      {/* bottom telemetry strip */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Gauge className="h-3 w-3 text-amber-300" />
          سرویس دوم:{" "}
          <span className="num-capsule text-[10px]">{speeds.a.second} / {speeds.b.second} km/h</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-emerald-300" />
          برتری تک‌امتیاز سرویس:{" "}
          <span className="num-capsule text-[10px] text-amber-300">
            +{Math.abs(pFinalA - pFinalB).toFixed(3)}
          </span>
          <span className="hidden sm:inline">→ تبدیل به احتمال برد در زوج‌تیپ (درخت مارکوف)</span>
        </span>
      </div>
    </div>
  );
}
