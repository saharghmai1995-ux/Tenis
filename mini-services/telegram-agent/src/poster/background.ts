// ─── Poster engine: procedural 16-bit pixel-art backgrounds ─────────────────
// Dithered gradient bands, crowd, floodlights, halftone field + per-theme decor.
// All decor is intentionally low-contrast so foreground text boxes stay readable.

import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ThemeSurface } from "../types";
import { latinize } from "./latinize";
import { makeRng, type Rng } from "./rng";
import { drawSprite, SPRITES } from "./sprites";

// Bayer 4x4 ordered-dither matrix
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${bl})`;
}

const THEME_SKY: Record<ThemeSurface, [string, string]> = {
  HARD: ["#12122a", "#05050d"],
  CLAY: ["#221016", "#0b0609"],
  GRASS: ["#0c1e14", "#050d09"],
  FOOTBALL: ["#0b1e12", "#04100a"],
  ACADEMY: ["#0a2016", "#03120b"],
  MARKETING: ["#220f1a", "#0c040e"],
  RESULTS: ["#121a24", "#050a0f"],
};

const CROWD_COLORS = ["#3d4654", "#5c3a44", "#2e4a56", "#55483a", "#443a5c", "#4a5450"];

interface CourtPalette {
  courtA: string;
  courtB: string;
  line: string;
  deco: string;
}

const COURT_PALETTES: Record<"HARD" | "CLAY" | "GRASS", CourtPalette> = {
  HARD: { courtA: "#1e5f7d", courtB: "#185068", line: "#e8eef2", deco: "#4dd6ff" },
  CLAY: { courtA: "#a34a26", courtB: "#8f3f1f", line: "#fff6e8", deco: "#ffd166" },
  GRASS: { courtA: "#1e6b3c", courtB: "#195c33", line: "#eaf2e4", deco: "#42e282" },
};

/** deterministic main rng shared with the engine (crowd/floodlights positions) */
let sharedRng: Rng = makeRng(1);

export function getBackgroundRng(): Rng {
  return sharedRng;
}

export function drawBackground(
  ctx: SKRSContext2D,
  theme: ThemeSurface,
  seed: number,
  w: number,
  h: number,
): void {
  const rng = makeRng(seed ^ 0x5eed17);
  sharedRng = makeRng(seed ^ 0xa11ce);

  // ── 1. dithered vertical gradient bands ──────────────────────────────────
  const [skyTop, skyBot] = THEME_SKY[theme];
  const STEPS = 18;
  const bandH = h / STEPS;
  for (let i = 0; i < STEPS; i++) {
    ctx.fillStyle = lerpColor(skyTop, skyBot, i / (STEPS - 1));
    ctx.fillRect(0, Math.floor(i * bandH), w, Math.ceil(bandH) + 1);
  }
  // Bayer-style checker transitions at every band boundary
  for (let i = 1; i < STEPS; i++) {
    const b = Math.floor(i * bandH);
    const cNext = lerpColor(skyTop, skyBot, i / (STEPS - 1));
    for (let x = 0; x < w; x += 4) {
      const col = (x / 4) | 0;
      ctx.fillStyle = cNext;
      if (col % 2 === 0) ctx.fillRect(x, b - 2, 4, 2);
      else ctx.fillRect(x, b, 4, 2);
    }
  }

  // ── 2. giant halftone dot field (very subtle) ────────────────────────────
  const dotStep = 54;
  for (let gy = 0, row = 0; gy < h; gy += dotStep, row++) {
    for (let gx = 0; gx < w; gx += dotStep) {
      const rr = 2 + 3 * (gy / h);
      const cyanRow = row % 2 === 0;
      ctx.fillStyle = cyanRow ? "rgba(77,214,255,0.045)" : "rgba(255,77,214,0.035)";
      ctx.beginPath();
      ctx.arc(gx + (row % 2) * (dotStep / 2), gy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── 3. pixel crowd band (top) ────────────────────────────────────────────
  const crowdTop = 86;
  const crowdBot = Math.min(230, h * 0.16);
  for (let y = crowdTop; y < crowdBot; y += 6) {
    for (let x = 4; x < w; x += 7) {
      if (rng.chance(0.42)) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = CROWD_COLORS[rng.int(0, CROWD_COLORS.length - 1)];
        const s = rng.int(2, 3);
        ctx.fillRect(x, y, s, s);
        ctx.globalAlpha = 1;
      }
    }
  }
  // crowd railing
  ctx.fillStyle = "rgba(20,24,38,0.9)";
  ctx.fillRect(0, crowdBot, w, 6);
  ctx.fillStyle = "rgba(120,140,160,0.25)";
  ctx.fillRect(0, crowdBot, w, 2);

  // ── 4. floodlight towers with light cones ────────────────────────────────
  drawFloodlight(ctx, rng, 130, w, h, 1);
  drawFloodlight(ctx, rng, w - 130, w, h, -1);

  // ── 5. theme-specific decor ──────────────────────────────────────────────
  switch (theme) {
    case "HARD":
    case "CLAY":
    case "GRASS":
      drawCourt(ctx, rng, theme, w, h);
      break;
    case "FOOTBALL":
      drawFootball(ctx, rng, w, h);
      break;
    case "ACADEMY":
      drawAcademy(ctx, rng, w, h);
      break;
    case "MARKETING":
      drawMarketing(ctx, rng, w, h);
      break;
    case "RESULTS":
      drawResults(ctx, rng, w, h);
      break;
  }

  // ── 6. global dim so foreground text stays readable ──────────────────────
  ctx.fillStyle = "rgba(4,4,12,0.42)";
  ctx.fillRect(0, 0, w, h);
}

// ─── floodlights ────────────────────────────────────────────────────────────

function drawFloodlight(
  ctx: SKRSContext2D,
  rng: Rng,
  cx: number,
  w: number,
  h: number,
  dir: number,
): void {
  const topY = 84;
  // light cone (translucent triangle) drawn behind the pole
  ctx.fillStyle = "rgba(255,248,214,0.07)";
  ctx.beginPath();
  ctx.moveTo(cx - 30, topY + 34);
  ctx.lineTo(cx + 30, topY + 34);
  ctx.lineTo(cx + dir * 320, topY + 520);
  ctx.lineTo(cx - dir * 260, topY + 520);
  ctx.closePath();
  ctx.fill();

  // pole
  ctx.fillStyle = "#0c0c18";
  ctx.fillRect(cx - 4, topY + 34, 8, 190);
  ctx.fillStyle = "#1a1e2e";
  ctx.fillRect(cx - 7, topY + 34, 14, 8);

  // light panel
  ctx.fillStyle = "#141824";
  ctx.fillRect(cx - 34, topY, 68, 34);
  ctx.fillStyle = "#0a0a12";
  ctx.fillRect(cx - 34, topY, 68, 3);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      ctx.fillStyle = rng.chance(0.85) ? "rgba(255,246,214,0.92)" : "rgba(160,160,140,0.6)";
      ctx.fillRect(cx - 28 + c * 12, topY + 6 + r * 9, 8, 6);
    }
  }
}

// ─── tennis court (HARD / CLAY / GRASS) ─────────────────────────────────────

function drawCourt(
  ctx: SKRSContext2D,
  rng: Rng,
  theme: "HARD" | "CLAY" | "GRASS",
  w: number,
  h: number,
): void {
  const pal = COURT_PALETTES[theme];
  const yTop = h * 0.335;
  const yBot = h * 0.885;
  const topL = 372;
  const topR = 708;
  const botL = 64;
  const botR = w - 64;

  const trap = (t: number): [number, number] => [
    topL + (botL - topL) * t,
    topR + (botR - topR) * t,
  ];

  // court surface (two-tone: outer + inner alley band)
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = pal.courtA;
  ctx.beginPath();
  ctx.moveTo(topL, yTop);
  ctx.lineTo(topR, yTop);
  ctx.lineTo(botR, yBot);
  ctx.lineTo(botL, yBot);
  ctx.closePath();
  ctx.fill();
  // inner court (slightly darker center block)
  const [iL1, iR1] = trap(0.16);
  const [iL2, iR2] = trap(0.95);
  ctx.fillStyle = pal.courtB;
  ctx.beginPath();
  ctx.moveTo(iL1, yTop + (yBot - yTop) * 0.16);
  ctx.lineTo(iR1, yTop + (yBot - yTop) * 0.16);
  ctx.lineTo(iR2, yTop + (yBot - yTop) * 0.95);
  ctx.lineTo(iL2, yTop + (yBot - yTop) * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // white court lines
  ctx.strokeStyle = pal.line;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(topL, yTop);
  ctx.lineTo(topR, yTop);
  ctx.lineTo(botR, yBot);
  ctx.lineTo(botL, yBot);
  ctx.closePath();
  ctx.stroke();
  // service line
  const [sL, sR] = trap(0.42);
  const sY = yTop + (yBot - yTop) * 0.42;
  ctx.beginPath();
  ctx.moveTo(sL, sY);
  ctx.lineTo(sR, sY);
  ctx.stroke();
  // center service line
  const [cL1, cR1] = trap(0.42);
  const [cL2, cR2] = trap(0.58);
  ctx.beginPath();
  ctx.moveTo((cL1 + cR1) / 2, sY);
  ctx.lineTo((cL2 + cR2) / 2, yTop + (yBot - yTop) * 0.58);
  ctx.stroke();
  // baselines ticks
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(topL, yTop);
  ctx.lineTo(botL, yBot);
  ctx.moveTo(topR, yTop);
  ctx.lineTo(botR, yBot);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // net band across the middle
  const netY = yTop + (yBot - yTop) * 0.24;
  const [nL, nR] = trap(0.24);
  const net = SPRITES.NET;
  const ns = 5;
  for (let x = nL; x < nR - net.w * ns; x += net.w * ns) {
    drawSprite(ctx, net, x, netY, ns, { p: "#3d4654", t: "#cfd6dd", s: "#5a6878" });
  }
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#0e1220";
  ctx.fillRect(nL - 8, netY - 6, 8, net.h * ns + 12);
  ctx.fillRect(nR, netY - 6, 8, net.h * ns + 12);
  ctx.globalAlpha = 1;

  // giant BALL + RACKET flanking
  ctx.globalAlpha = 0.17;
  drawSprite(ctx, SPRITES.BALL, 30, h * 0.42, 16);
  drawSprite(ctx, SPRITES.RACKET, w - 265, h * 0.40, 16);
  ctx.globalAlpha = 1;

  // scoreboard board
  const sbX = w - 320;
  const sbY = h * 0.185;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#0b0e1a";
  ctx.fillRect(sbX, sbY, 272, 84);
  ctx.strokeStyle = pal.deco;
  ctx.lineWidth = 3;
  ctx.strokeRect(sbX + 4, sbY + 4, 264, 76);
  ctx.fillStyle = pal.deco;
  ctx.font = 'bold 26px "DejaVu Sans Mono"';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(latinize("P1 0-0 P2"), sbX + 136, sbY + 44);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
}

// ─── football pitch ─────────────────────────────────────────────────────────

function drawFootball(ctx: SKRSContext2D, rng: Rng, w: number, h: number): void {
  const pitchTop = h * 0.30;
  const pitchBot = h * 0.90;
  const stripeH = 78;
  let i = 0;
  for (let y = pitchTop; y < pitchBot; y += stripeH, i++) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = i % 2 === 0 ? "#15582e" : "#1a6636";
    ctx.fillRect(0, y, w, Math.min(stripeH, pitchBot - y));
    ctx.globalAlpha = 1;
  }
  // markings
  ctx.strokeStyle = "rgba(240,248,240,0.45)";
  ctx.lineWidth = 5;
  const midY = (pitchTop + pitchBot) / 2;
  ctx.beginPath();
  ctx.moveTo(40, pitchTop);
  ctx.lineTo(w - 40, pitchTop);
  ctx.moveTo(40, pitchBot);
  ctx.lineTo(w - 40, pitchBot);
  ctx.moveTo(40, midY);
  ctx.lineTo(w - 40, midY);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(w / 2, midY, 150, 88, 0, 0, Math.PI * 2);
  ctx.stroke();
  // penalty boxes
  ctx.strokeRect(w / 2 - 300, pitchTop, 600, 120);
  ctx.strokeRect(w / 2 - 300, pitchBot - 120, 600, 120);

  // GOAL sprite large at top center
  ctx.globalAlpha = 0.55;
  drawSprite(ctx, SPRITES.GOAL, w / 2 - 144, pitchTop - 60, 18);
  // SOCCERBALLs
  drawSprite(ctx, SPRITES.SOCCERBALL, w * 0.66, midY - 170, 11);
  drawSprite(ctx, SPRITES.SOCCERBALL, w * 0.24, midY + 130, 6);

  // corner flags
  const flag = (x: number, y: number): void => {
    ctx.fillStyle = "#e8eef2";
    ctx.fillRect(x, y - 54, 4, 54);
    ctx.fillStyle = "#ff5d5d";
    ctx.fillRect(x + 4, y - 54, 22, 14);
  };
  flag(44, pitchTop + 2);
  flag(w - 48, pitchTop + 2);
  flag(44, pitchBot - 2);
  flag(w - 48, pitchBot - 2);
  ctx.globalAlpha = 1;
}

// ─── academy chalkboard ─────────────────────────────────────────────────────

function drawAcademy(ctx: SKRSContext2D, rng: Rng, w: number, h: number): void {
  // chalk dust
  for (let i = 0; i < 320; i++) {
    ctx.fillStyle = `rgba(240,248,240,${rng.range(0.04, 0.14)})`;
    ctx.fillRect(rng.int(0, w), rng.int(0, h), rng.int(1, 2), rng.int(1, 2));
  }
  // chalk smudges
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = "rgba(240,248,240,0.04)";
    ctx.fillRect(rng.int(40, w - 260), rng.int(100, h - 200), rng.int(120, 260), rng.int(6, 16));
  }
  // hand-drawn dashed rects
  ctx.strokeStyle = "rgba(240,248,240,0.12)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 7]);
  for (let i = 0; i < 3; i++) {
    const rx = rng.int(60, w - 340);
    const ry = rng.int(260, h - 380);
    ctx.strokeRect(rx, ry, rng.int(180, 300), rng.int(110, 190));
  }
  ctx.setLineDash([]);
  // giant BOOK + MORTARBORD
  ctx.globalAlpha = 0.18;
  drawSprite(ctx, SPRITES.BOOK, 66, h * 0.46, 14);
  drawSprite(ctx, SPRITES.MORTARBORD, w - 300, h * 0.42, 14);
  ctx.globalAlpha = 1;
  // floating glyphs
  const glyphs = ["Aa", "EV", "%", "xG", "1X2", "+/-", "AH"];
  ctx.font = 'bold 54px "DejaVu Sans Mono"';
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = `rgba(240,248,240,${rng.range(0.08, 0.14)})`;
    const g = latinize(glyphs[i]);
    ctx.fillText(g, rng.int(30, w - 120), rng.int(160, h - 140));
  }
}

// ─── marketing jackpot ──────────────────────────────────────────────────────

function drawMarketing(ctx: SKRSContext2D, rng: Rng, w: number, h: number): void {
  // coin fountains: two parabolic arcs of coins
  const fountain = (cx: number, baseY: number, spread: number, height: number): void => {
    for (let t = 0; t <= 12; t++) {
      const tt = t / 12;
      const x = cx + (tt - 0.5) * spread;
      const y = baseY - Math.sin(tt * Math.PI) * height;
      ctx.globalAlpha = rng.range(0.3, 0.55);
      drawSprite(ctx, SPRITES.COIN, x, y, 4);
    }
    ctx.globalAlpha = 1;
  };
  fountain(150, h * 0.66, 420, 330);
  fountain(w - 150, h * 0.66, 420, 330);
  // scattered coins
  for (let i = 0; i < 10; i++) {
    ctx.globalAlpha = rng.range(0.2, 0.4);
    drawSprite(ctx, SPRITES.COIN, rng.int(20, w - 70), rng.int(160, h - 160), rng.int(3, 5));
  }
  ctx.globalAlpha = 1;

  // trophy on podium (center)
  const podiumY = h * 0.62;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#1c1420";
  ctx.fillRect(w / 2 - 150, podiumY + 150, 300, 60);
  ctx.fillStyle = "#2a1c12";
  ctx.fillRect(w / 2 - 100, podiumY + 90, 200, 60);
  ctx.fillStyle = "#3a2812";
  ctx.fillRect(w / 2 - 60, podiumY + 30, 120, 60);
  drawSprite(ctx, SPRITES.TROPHY, w / 2 - 80, podiumY - 140, 10);
  ctx.globalAlpha = 1;

  // slot machine strip "7 7 7"
  const sx = 60;
  const sy = h * 0.175;
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#0b0e1a";
  ctx.fillRect(sx, sy, 250, 96);
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = 3;
  ctx.strokeRect(sx + 4, sy + 4, 242, 88);
  ctx.font = 'bold 44px "DejaVu Sans Mono"';
  ctx.fillStyle = "#ffd166";
  ctx.fillText(latinize("7"), sx + 38, sy + 66);
  ctx.fillText(latinize("7"), sx + 108, sy + 66);
  ctx.fillText(latinize("7"), sx + 178, sy + 66);
  ctx.globalAlpha = 1;

  // star sparkles
  for (let i = 0; i < 8; i++) {
    ctx.globalAlpha = rng.range(0.25, 0.5);
    drawSprite(ctx, SPRITES.STAR, rng.int(30, w - 60), rng.int(120, h - 200), rng.int(2, 3));
  }
  ctx.globalAlpha = 1;
}

// ─── results podium ─────────────────────────────────────────────────────────

function drawResults(ctx: SKRSContext2D, rng: Rng, w: number, h: number): void {
  // podium (3 steps, center)
  const baseY = h * 0.80;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#2a3040";
  ctx.fillRect(w / 2 - 240, baseY, 160, 90); // left (silver step)
  ctx.fillRect(w / 2 + 80, baseY + 30, 160, 60); // right (bronze step)
  ctx.fillStyle = "#3a3040";
  ctx.fillRect(w / 2 - 80, baseY - 40, 160, 130); // center (gold step)
  ctx.fillStyle = "rgba(255,209,102,0.5)";
  ctx.fillRect(w / 2 - 80, baseY - 40, 160, 8);
  ctx.fillStyle = "rgba(160,180,200,0.4)";
  ctx.fillRect(w / 2 - 240, baseY, 160, 6);
  drawSprite(ctx, SPRITES.TROPHY, w / 2 - 56, baseY - 190, 7);
  ctx.globalAlpha = 1;

  // confetti dots
  const confetti = ["#ffd166", "#4dd6ff", "#ff4dd6", "#42e282", "#fff6e8"];
  for (let i = 0; i < 240; i++) {
    ctx.globalAlpha = rng.range(0.25, 0.55);
    ctx.fillStyle = confetti[rng.int(0, confetti.length - 1)];
    ctx.fillRect(rng.int(0, w), rng.int(0, h * 0.75), 3, rng.int(3, 6));
  }
  ctx.globalAlpha = 1;

  // faint CHECK / CROSS glyph rows
  for (let i = 0; i < 4; i++) {
    const y = 300 + i * 260 + rng.int(-30, 30);
    ctx.globalAlpha = 0.10;
    drawSprite(ctx, SPRITES.CHECK, rng.int(60, w / 2 - 80), y, 4);
    drawSprite(ctx, SPRITES.CROSS, rng.int(w / 2 + 80, w - 90), rng.int(200, h - 260), 4);
  }
  ctx.globalAlpha = 1;
}
