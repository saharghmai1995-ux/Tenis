"use client";

import { Radar, ShieldCheck, Zap } from "lucide-react";

export function TennisFooter() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="mono-num text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          NEOBET TENNIS QUANT • @AINEOBET • SHA-256 LOCKED • v12.0
        </p>
        <p className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-emerald-400" />
            تسویه خودکار ۷ روزه از سرور ESPN — حسابداری سطح مسابقه
          </span>
          <span className="inline-flex items-center gap-1">
            <Zap className="h-3 w-3 text-amber-300" />
            موتور مارکوف ۴ لایه · کالیبره Kovalchik 2016 · سوپروایزر ۳ الگویی با سهمیه ۶۵٪
          </span>
          <span className="inline-flex items-center gap-1">
            <Radar className="h-3 w-3 text-cyan-300" />
            3D Hawk-Eye Court Telemetry · Spatial Glass UI
          </span>
        </p>
      </div>
    </footer>
  );
}
