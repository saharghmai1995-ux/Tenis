// ─── Poster engine: CRT overlay (applied LAST, over everything) ─────────────
// Subtle scanlines + phosphor mask + vignette + glare + header glow.
// Must keep every pixel of text readable — this is flavor, not fog.

import type { SKRSContext2D } from "@napi-rs/canvas";

export function drawCrt(ctx: SKRSContext2D, w: number, h: number, hudBottom = 72): void {
  // ── scanlines: every 4px a 2px black line, alpha ~0.22 ────────────────────
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  for (let y = 0; y < h; y += 4) {
    ctx.fillRect(0, y, w, 2);
  }

  // ── vertical phosphor mask hint: 1px columns every 3px ────────────────────
  const maskColors = ["rgba(77,214,255,0.03)", "rgba(255,77,214,0.03)", "rgba(223,255,79,0.03)"];
  let mi = 0;
  for (let x = 0; x < w; x += 3) {
    ctx.fillStyle = maskColors[mi % 3];
    ctx.fillRect(x, 0, 1, h);
    mi++;
  }

  // ── vignette: radial, transparent center → dark corners ───────────────────
  const rMax = Math.sqrt(w * w + h * h) / 2;
  const grad = ctx.createRadialGradient(w / 2, h / 2, rMax * 0.34, w / 2, h / 2, rMax);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.10)");
  grad.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // ── screen glare: two diagonal streaks over the upper-left ────────────────
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#ffffff";
  ctx.translate(w * 0.16, -60);
  ctx.rotate(-0.42);
  ctx.fillRect(0, 0, 120, h * 1.6);
  ctx.translate(230, 40);
  ctx.fillRect(0, 0, 54, h * 1.6);
  ctx.restore();

  // ── header glow: faint cyan line under the HUD bar ────────────────────────
  const glow = ctx.createLinearGradient(0, hudBottom, 0, hudBottom + 18);
  glow.addColorStop(0, "rgba(77,214,255,0.12)");
  glow.addColorStop(1, "rgba(77,214,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, hudBottom, w, 18);
  ctx.fillStyle = "rgba(160,240,255,0.20)";
  ctx.fillRect(0, hudBottom, w, 2);
}
