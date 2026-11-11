"use client";

// ─── NeoTennis Markov Quant v3.0 — 3D Mouse-Tilt Spatial Hook ──────────────
// VisionOS-style depth response: cards tilt toward the cursor (max ±8°),
// a specular glare follows the pointer, and everything snaps back on exit.
// Touch devices and prefers-reduced-motion users get the flat layout.

import * as React from "react";

const MAX_TILT = 8;

export function useTilt(disabled = false) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [glare, setGlare] = React.useState<{ x: number; y: number; opacity: number }>({
    x: 50,
    y: 50,
    opacity: 0,
  });

  const reduced = React.useMemo(
    () =>
      disabled ||
      (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    [disabled]
  );

  const onMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (reduced) return;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width; // 0..1
      const py = (e.clientY - rect.top) / rect.height;
      const rx = (0.5 - py) * MAX_TILT * 2;
      const ry = (px - 0.5) * MAX_TILT * 2;
      el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(0)`;
      setGlare({ x: px * 100, y: py * 100, opacity: 0.16 });
    },
    [reduced]
  );

  const onMouseLeave = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform =
      "perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0)";
    setGlare((g) => ({ ...g, opacity: 0 }));
  }, []);

  return { ref, glare, onMouseMove, onMouseLeave };
}

/** Wrapper div with the 3D tilt + glare overlay baked in. */
export function TiltCard({
  children,
  className = "",
  disabled = false,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { disabled?: boolean }) {
  const { ref, glare, onMouseMove, onMouseLeave } = useTilt(disabled);
  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={`relative transition-transform duration-200 ease-out will-change-transform ${className}`}
      {...rest}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
        style={{
          opacity: glare.opacity,
          background: `radial-gradient(420px circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.85), transparent 55%)`,
          mixBlendMode: "overlay",
        }}
      />
    </div>
  );
}
