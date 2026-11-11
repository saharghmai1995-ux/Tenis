"use client";

// ─── NeoTennis Markov Quant v3.0 — Animated 4-Layer Markov Decision Tree ───
// Point p_A → Game Hold G(p) → Set Matrix S_A → 4 Bo3 outcomes (2-0 / 2-1 /
// 1-2 / 0-2) → Dual-Slip coverage. Data flows along neon paths as animated
// SVG particles so the user can SEE how a +5% single-point serve edge
// compounds into a ~91% dual-tip win probability.

import type { AnalyzedMatch } from "@/lib/tennis/types";

interface NodeSpec {
  x: number;
  y: number;
  w: number;
  h: number;
}

const NODE = {
  point: { x: 8, y: 132, w: 118, h: 56 },
  game: { x: 188, y: 132, w: 118, h: 56 },
  set: { x: 368, y: 132, w: 118, h: 56 },
  outcomes: [
    { x: 556, y: 18, w: 96, h: 42 },
    { x: 556, y: 86, w: 96, h: 42 },
    { x: 556, y: 154, w: 96, h: 42 },
    { x: 556, y: 222, w: 96, h: 42 },
  ],
  dual: { x: 674, y: 118, w: 112, h: 64 },
};

const EDGE_PATHS = {
  pToG: "M 126 160 C 158 160, 156 160, 188 160",
  gToS: "M 306 160 C 338 160, 336 160, 368 160",
  sToOut: (ty: number) =>
    `M 486 160 C 520 160, 524 ${ty + 21}, 556 ${ty + 21}`,
  outToDual: (sy: number) =>
    `M 652 ${sy + 21} C 664 ${sy + 21}, 662 150, 674 150`,
};

function edgePath(d: string, tone: string, delay = "0s") {
  return (
    <g key={d}>
      <path d={d} fill="none" stroke={tone} strokeWidth="1.6" opacity="0.5" className="flow-line" style={{ animationDelay: delay }} />
      <circle r="2.6" fill={tone}>
        <animateMotion dur="1.9s" repeatCount="indefinite" path={d} />
      </circle>
      <circle r="2" fill="#ffffff" opacity="0.85">
        <animateMotion dur="1.9s" begin="0.65s" repeatCount="indefinite" path={d} />
      </circle>
    </g>
  );
}

function NodeBox({
  spec,
  title,
  value,
  tone,
  highlight = false,
}: {
  spec: NodeSpec;
  title: React.ReactNode;
  value: string;
  tone: string;
  highlight?: boolean;
}) {
  return (
    <foreignObject x={spec.x} y={spec.y} width={spec.w} height={spec.h}>
      <div
        className={`flex h-full w-full flex-col items-center justify-center rounded-xl border px-1.5 text-center ${
          highlight
            ? "border-amber-300/60 bg-amber-300/10 shadow-[0_0_18px_rgba(251,191,36,0.35)]"
            : "border-white/15 bg-white/[0.05]"
        }`}
        style={{ boxShadow: highlight ? undefined : "inset 0 1px 1px rgba(255,255,255,0.12)" }}
      >
        <span className="text-[9px] leading-3 text-muted-foreground">{title}</span>
        <span className={`mono-num text-[13px] font-extrabold leading-4 ${tone}`} dir="ltr">
          {value}
        </span>
      </div>
    </foreignObject>
  );
}

export function MarkovFlow({ match }: { match: AnalyzedMatch }) {
  const { pFinalA, pFinalB } = match.reverse;
  const gA = match.markov.gA;
  const gB = match.markov.gB;
  const setA = match.markov.setWinA;
  const outcomes = [
    { k: "2-0", v: match.markov.p20 },
    { k: "2-1", v: match.markov.p21 },
    { k: "1-2", v: match.markov.p12 },
    { k: "0-2", v: match.markov.p02 },
  ];
  const dualCoverage = match.archetype
    ? match.archetype.coverage
    : 1 - Math.min(match.markov.p02, match.markov.arch.pairLoss1);

  const dualTone = dualCoverage >= 0.85 ? "#34d399" : dualCoverage >= 0.75 ? "#fbbf24" : "#fb7185";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h4 className="mb-1 flex items-center gap-2 text-xs font-bold text-amber-300">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 18 L10 12 L14 15 L20 6" />
          <circle cx="20" cy="6" r="1.6" fill="currentColor" />
        </svg>
        درخت تصمیم متحرک مارکوف — از برتری تک‌امتیاز تا برد زوج‌تیپ
      </h4>
      <div dir="ltr" className="overflow-x-auto">
        <svg viewBox="0 0 800 285" className="h-[265px] w-full min-w-[620px]">
          {/* edges with flowing particles */}
          {edgePath(EDGE_PATHS.pToG, "#fbbf24")}
          {edgePath(EDGE_PATHS.gToS, "#22d3ee")}
          {NODE.outcomes.map((o, i) =>
            edgePath(EDGE_PATHS.sToOut(o.y), ["#34d399", "#fbbf24", "#fbbf24", "#fb7185"][i], `${i * 0.22}s`)
          )}
          {NODE.outcomes.map((o, i) =>
            edgePath(EDGE_PATHS.outToDual(o.y), dualTone, `${0.4 + i * 0.2}s`)
          )}

          {/* layer 1 — point */}
          <NodeBox
            spec={NODE.point}
            title={<span>امتیاز سرویس <span className="mono-num">p_A / p_B</span></span>}
            value={`${pFinalA.toFixed(3)} · ${pFinalB.toFixed(3)}`}
            tone="text-amber-300"
            highlight
          />
          {/* layer 2 — game hold */}
          <NodeBox
            spec={NODE.game}
            title={<span>Hold گیم <span className="mono-num">G(p)</span></span>}
            value={`${(gA * 100).toFixed(1)}% · ${(gB * 100).toFixed(1)}%`}
            tone="text-cyan-300"
          />
          {/* layer 3 — set matrix */}
          <NodeBox
            spec={NODE.set}
            title={<span>برد ست <span className="mono-num">S_A</span></span>}
            value={`${(setA * 100).toFixed(1)}%`}
            tone="text-white"
          />
          {/* layer 4 — Bo3 outcomes */}
          {NODE.outcomes.map((o, i) => (
            <foreignObject key={`out-${i}`} x={o.x} y={o.y} width={o.w} height={o.h}>
              <div className="flex h-full w-full items-center justify-between rounded-lg border border-white/15 bg-white/[0.04] px-2">
                <span className="mono-num text-[12px] font-bold text-white/85" dir="ltr">{outcomes[i].k}</span>
                <span className="mono-num text-[12px] font-extrabold text-white" dir="ltr">
                  {(outcomes[i].v * 100).toFixed(1)}%
                </span>
              </div>
            </foreignObject>
          ))}
          {/* dual coverage terminal */}
          <foreignObject x={NODE.dual.x} y={NODE.dual.y} width={NODE.dual.w} height={NODE.dual.h}>
            <div
              className="flex h-full w-full flex-col items-center justify-center rounded-xl border px-2 text-center"
              style={{
                borderColor: `${dualTone}66`,
                background: `${dualTone}14`,
                boxShadow: `0 0 20px ${dualTone}44`,
              }}
            >
              <span className="text-[9px] leading-3 text-muted-foreground">پوشش زوج‌تیپ مکمل</span>
              <span className="mono-num text-[16px] font-extrabold" dir="ltr" style={{ color: dualTone }}>
                {(dualCoverage * 100).toFixed(1)}%
              </span>
            </div>
          </foreignObject>
        </svg>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
        ذرات نوری، مسیر انتشار احتمال را نشان می‌دهند: برتری{" "}
        <span className="num-capsule text-[10px] text-amber-300">
          +{Math.abs(pFinalA - pFinalB).toFixed(3)}
        </span>{" "}
        در تک‌امتیاز سرویس، پس از عبور از لایه گیم و ست، به پوشش{" "}
        <span className="num-capsule text-[10px]" style={{ color: dualTone }}>
          {(dualCoverage * 100).toFixed(1)}%
        </span>{" "}
        در زوج‌تیپ مکمل می‌رسد.
      </p>
    </div>
  );
}
