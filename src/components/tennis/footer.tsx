"use client";

import { ShieldCheck, Zap } from "lucide-react";

export function TennisFooter() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="mono-num text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          NEOBET TENNIS QUANT • @AINEOBET • SHA-256 LOCKED
        </p>
        <p className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-emerald-400" />
            تسویه خودکار ۷۲ ساعته از سرور ESPN
          </span>
          <span className="inline-flex items-center gap-1">
            <Zap className="h-3 w-3 text-amber-300" />
            موتور مارکوف ۴ لایه · بی‌داده فرضی (Zero-Mock)
          </span>
        </p>
      </div>
    </footer>
  );
}
