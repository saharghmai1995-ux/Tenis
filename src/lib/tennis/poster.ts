// ─── NeoTennis Markov Quant — Procedural Poster Engine ─────────────────────
// Pure canvas drawing module (no React, no DOM assumptions beyond the
// HTMLCanvasElement passed in). Renders a 1080×1440 (3:4 Telegram standard)
// poster with 100% English typography, procedurally drawn 3D court
// background (per surface), neon player rings, glowing tennis ball and
// glassmorphism slip boxes. All randomness is seeded → same match renders
// pixel-identically.

export type PosterSurface = "HARD" | "CLAY" | "GRASS";

export interface PosterPlayer {
  name: string;
  shortName: string;
  flagUrl?: string; // espncdn flag — loaded via same-origin proxy /api/tennis/img
  rank?: number;
  seed?: number;
}

export interface PosterData {
  playerA: PosterPlayer;
  playerB: PosterPlayer;
  tournament: string;
  round: string;
  surface: PosterSurface;
  favorite: "A" | "B";
  slipA?: { textEn: string; odds: number };
  slipB?: { textEn: string; odds: number };
  hashPre?: string; // SHA-256 hex — first 10 chars shown uppercase
  timingLabel?: string; // e.g. "T-30m Pre-Warmup" (English)
  marketProbAFav?: number; // market probability of the favorite (0..1)
  mode: "teaser" | "full"; // teaser = Slip B blurred + padlock
  preview?: boolean; // engineering-review render — draws a MODEL PREVIEW ribbon
}

// ─── Internals ──────────────────────────────────────────────────────────────

const W = 1080;
const H = 1440;
const FLAG_TIMEOUT_MS = 4500;

const FONT_STACK = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const MONO_STACK = '"JetBrains Mono", "SF Mono", Consolas, "Courier New", monospace';

const GOLD = "#ffd166";
const OPTIC = "#dfff4f";

interface CourtPalette {
  surroundTop: string;
  surroundBottom: string;
  courtTop: string;
  courtBottom: string;
  line: string;
  chipColor: string;
}

const PALETTES: Record<PosterSurface, CourtPalette> = {
  HARD: {
    surroundTop: "#1e4d8f",
    surroundBottom: "#12356e",
    courtTop: "#0b1e3a",
    courtBottom: "#123a6b",
    line: "rgba(233,244,255,0.92)",
    chipColor: "#67e8f9",
  },
  CLAY: {
    surroundTop: "#7c2f16",
    surroundBottom: "#511f0e",
    courtTop: "#a63d1e",
    courtBottom: "#c65a2e",
    line: "rgba(250,236,220,0.9)",
    chipColor: "#fb923c",
  },
  GRASS: {
    surroundTop: "#0a4227",
    surroundBottom: "#06301c",
    courtTop: "#0e5c33",
    courtBottom: "#1d7a45",
    line: "rgba(232,255,240,0.9)",
    chipColor: "#34d399",
  },
};

const SURFACE_CHIPS: Record<PosterSurface, { text: string; color: string }> = {
  HARD: { text: "HARD COURT", color: "#67e8f9" },
  CLAY: { text: "CLAY COURT", color: "#fb923c" },
  GRASS: { text: "GRASS COURT", color: "#34d399" },
};

// ─── Deterministic RNG (mulberry32) ────────────────────────────────────────

function hashStringToSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Small canvas helpers ───────────────────────────────────────────────────

function font(weight: string, px: number, mono = false): string {
  return `${weight} ${px}px ${mono ? MONO_STACK : FONT_STACK}`;
}

/** Shrink font size until `text` fits `maxWidth`. Returns the final px size. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startPx: number,
  weight: string,
  mono = false,
  minPx = 13
): number {
  let px = startPx;
  for (;;) {
    ctx.font = font(weight, px, mono);
    if (ctx.measureText(text).width <= maxWidth || px <= minPx) break;
    px -= 2;
  }
  return px;
}

/**
 * v4.5 slip-box text layout — word-wraps the market text into up to `maxLines`
 * large lines instead of shrinking it into unreadable print. Tries the
 * largest size first and only steps down while everything still fits. If no
 * size fits within maxLines, the text is greedily wrapped at the floor size
 * (never drawn as one overflowing line).
 */
function wrapFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startPx: number,
  weight: string,
  minPx: number,
  maxLines = 2
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  for (let px = startPx; px >= minPx; px -= 2) {
    ctx.font = font(weight, px);
    const lines: string[] = [];
    let cur = "";
    let ok = true;
    for (const wd of words) {
      const cand = cur ? `${cur} ${wd}` : wd;
      if (ctx.measureText(cand).width <= maxWidth) {
        cur = cand;
      } else {
        if (cur) lines.push(cur);
        cur = wd;
        if (ctx.measureText(wd).width > maxWidth) {
          ok = false;
          break;
        }
      }
    }
    if (cur) lines.push(cur);
    if (ok && lines.length <= maxLines) return lines;
  }
  // greedy wrap at the floor size — the fallback keeps every word on-canvas
  ctx.font = font(weight, minPx);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const cand = cur ? `${cur} ${wd}` : wd;
    if (!cur || ctx.measureText(cand).width <= maxWidth) {
      cur = cand;
    } else {
      lines.push(cur);
      cur = wd;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines + 1);
}

/** Same as fitText but accounts for letter tracking. */
function fitTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startPx: number,
  weight: string,
  tracking: number,
  mono = false,
  minPx = 12
): number {
  let px = startPx;
  for (;;) {
    ctx.font = font(weight, px, mono);
    if (measureTracked(ctx, text, tracking) <= maxWidth || px <= minPx) break;
    px -= 2;
  }
  return px;
}

function measureTracked(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  if (!text) return 0;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return w - tracking;
}

function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  tracking: number
): void {
  const total = measureTracked(ctx, text, tracking);
  let x = cx - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (const ch of text) {
    ctx.fillText(ch, x, cy);
    x += ctx.measureText(ch).width + tracking;
  }
  ctx.textAlign = prevAlign;
}

function drawTrackedLeft(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  cy: number,
  tracking: number
): void {
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, cy);
    cursor += ctx.measureText(ch).width + tracking;
  }
  ctx.textAlign = prevAlign;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const initials = parts
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join("");
  return initials.toUpperCase() || "?";
}

// ─── Flag loading (same-origin proxy, parallel, timeout fallback) ──────────

function loadFlag(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    let timer = 0;
    const finish = (result: HTMLImageElement | null): void => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      resolve(result);
    };
    timer = window.setTimeout(() => finish(null), FLAG_TIMEOUT_MS);
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = `/api/tennis/img?url=${encodeURIComponent(url)}`;
  });
}

// ─── Court background ───────────────────────────────────────────────────────

function drawCourt(ctx: CanvasRenderingContext2D, pal: CourtPalette): void {
  const cx = W / 2;
  const topY = 520;
  const botY = 1436;
  const topHW = 200; // half width at top baseline
  const botHW = 530; // half width at bottom baseline
  const span = botY - topY;
  const netFrac = 0.4;
  const singlesFrac = 0.75;
  const serviceGapFrac = 18 / 39; // net→service line : service line→baseline

  const halfWAt = (y: number): number => topHW + (botHW - topHW) * ((y - topY) / span);
  const xAt = (side: 1 | -1, y: number, frac: number): number => cx + side * halfWAt(y) * frac;

  // Surround
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, pal.surroundTop);
  bg.addColorStop(1, pal.surroundBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Court trapezoid (wider at bottom → broadcast overhead perspective)
  const netY = topY + span * netFrac;
  const serviceTopY = netY - (netY - topY) * serviceGapFrac;
  const serviceBotY = netY + (botY - netY) * serviceGapFrac;

  ctx.beginPath();
  ctx.moveTo(cx - topHW, topY);
  ctx.lineTo(cx + topHW, topY);
  ctx.lineTo(cx + botHW, botY);
  ctx.lineTo(cx - botHW, botY);
  ctx.closePath();
  const cg = ctx.createLinearGradient(0, topY, 0, botY);
  cg.addColorStop(0, pal.courtTop);
  cg.addColorStop(1, pal.courtBottom);
  ctx.fillStyle = cg;
  ctx.fill();

  // Court shadow edge (subtle 3D depth along top edge)
  const edge = ctx.createLinearGradient(0, topY - 26, 0, topY + 30);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(0.75, "rgba(0,0,0,0.22)");
  edge.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = edge;
  ctx.fillRect(cx - topHW - 60, topY - 26, topHW * 2 + 120, 56);

  // Lines — neon white, width grows toward the viewer
  ctx.save();
  ctx.strokeStyle = pal.line;
  ctx.shadowColor = "rgba(255,255,255,0.55)";
  ctx.shadowBlur = 7;
  ctx.lineCap = "butt";

  const lwAt = (y: number): number => 3 + 3.6 * ((y - topY) / span);
  const seg = (x1: number, y1: number, x2: number, y2: number, yRef: number): void => {
    ctx.lineWidth = lwAt(yRef);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  // Doubles sidelines + baselines
  seg(xAt(-1, topY, 1), topY, xAt(-1, botY, 1), botY, (topY + botY) / 2);
  seg(xAt(1, topY, 1), topY, xAt(1, botY, 1), botY, (topY + botY) / 2);
  seg(xAt(-1, topY, 1), topY, xAt(1, topY, 1), topY, topY);
  seg(xAt(-1, botY, 1), botY, xAt(1, botY, 1), botY, botY);

  // Singles sidelines
  seg(xAt(-1, topY, singlesFrac), topY, xAt(-1, botY, singlesFrac), botY, (topY + botY) / 2);
  seg(xAt(1, topY, singlesFrac), topY, xAt(1, botY, singlesFrac), botY, (topY + botY) / 2);

  // Service lines
  seg(xAt(-1, serviceTopY, singlesFrac), serviceTopY, xAt(1, serviceTopY, singlesFrac), serviceTopY, serviceTopY);
  seg(xAt(-1, serviceBotY, singlesFrac), serviceBotY, xAt(1, serviceBotY, singlesFrac), serviceBotY, serviceBotY);

  // Center service line (net → service line, both halves)
  seg(cx, serviceTopY, cx, serviceBotY, netY);

  // Net: dark band + bright cord, slightly wider than the court
  const netHalfW = halfWAt(netY) * 1.12;
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(2,8,20,0.35)";
  ctx.fillRect(cx - netHalfW, netY - 6, netHalfW * 2, 14);
  ctx.shadowColor = "rgba(255,255,255,0.8)";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - netHalfW, netY);
  ctx.lineTo(cx + netHalfW, netY);
  ctx.stroke();

  // Center marks on both baselines
  ctx.shadowBlur = 4;
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx, topY + 4);
  ctx.lineTo(cx, topY + 20);
  ctx.moveTo(cx, botY - 20);
  ctx.lineTo(cx, botY - 4);
  ctx.stroke();
  ctx.restore();
}

function drawFloodBeams(ctx: CanvasRenderingContext2D, intensity: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  const beam = (x0: number, y0: number, x1: number, x2: number, y1: number): void => {
    const g = ctx.createLinearGradient(x0, y0, (x1 + x2) / 2, y1);
    g.addColorStop(0, `rgba(103,232,249,${(0.2 * intensity).toFixed(3)})`);
    g.addColorStop(1, "rgba(103,232,249,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y1);
    ctx.closePath();
    ctx.fill();
  };
  beam(-40, -40, 170, 640, 780);
  beam(W + 40, -40, W - 170, W - 640, 780);

  const lamp = (x: number, y: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 280);
    g.addColorStop(0, `rgba(224,247,255,${(0.55 * intensity).toFixed(3)})`);
    g.addColorStop(1, "rgba(224,247,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 280, y - 280, 560, 560);
  };
  lamp(24, 10);
  lamp(W - 24, 10);
  ctx.restore();
}

function drawClayDust(ctx: CanvasRenderingContext2D, rng: () => number): void {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 120; i++) {
    const x = 30 + rng() * (W - 60);
    const y = 110 + rng() * 1260;
    const r = 1.2 + rng() * 4.2;
    const a = 0.1 + rng() * 0.38;
    ctx.fillStyle = `rgba(255,207,122,${a.toFixed(3)})`;
    ctx.shadowColor = "rgba(255,190,90,0.85)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGrassHalo(ctx: CanvasRenderingContext2D, cx: number, cy: number, intensity: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 340);
  g.addColorStop(0, `rgba(255,209,102,${(0.28 * intensity).toFixed(3)})`);
  g.addColorStop(0.5, `rgba(255,209,102,${(0.1 * intensity).toFixed(3)})`);
  g.addColorStop(1, "rgba(255,209,102,0)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - 340, cy - 340, 680, 680);
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(W / 2, 640, 260, W / 2, 720, 1000);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Top readability scrim (rings / names area)
  const top = ctx.createLinearGradient(0, 0, 0, 310);
  top.addColorStop(0, "rgba(2,6,16,0.55)");
  top.addColorStop(1, "rgba(2,6,16,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 310);

  // Bottom readability scrim (slips / footer area)
  const bot = ctx.createLinearGradient(0, 1120, 0, H);
  bot.addColorStop(0, "rgba(2,6,16,0)");
  bot.addColorStop(1, "rgba(2,6,16,0.55)");
  ctx.fillStyle = bot;
  ctx.fillRect(0, 1120, W, H - 1120);
}

// ─── Players: neon rings, flags, names, badges ─────────────────────────────

function drawFlagOrInitials(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  cx: number,
  cy: number,
  r: number,
  name: string,
  accent: string
): void {
  ctx.save();
  if (img && img.width > 0 && img.height > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max((2 * r) / img.width, (2 * r) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    // Fallback: dark disc + neon ring + initials
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(4,10,24,0.85)";
    ctx.fill();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    const initials = getInitials(name);
    fitText(ctx, initials, r * 1.25, 46, "800");
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, cx, cy + 2);
  }
  ctx.restore();
}

function drawPlayerRing(
  ctx: CanvasRenderingContext2D,
  player: PosterPlayer,
  img: HTMLImageElement | null,
  cx: number,
  cy: number,
  r: number,
  isFavorite: boolean
): void {
  const accent = isFavorite ? GOLD : "#7dd3fc";
  ctx.save();
  // Main neon ring
  ctx.shadowColor = accent;
  ctx.shadowBlur = isFavorite ? 28 : 14;
  ctx.strokeStyle = isFavorite ? "rgba(255,209,102,0.95)" : "rgba(186,230,253,0.85)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Outer faint ring
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawFlagOrInitials(ctx, img, cx, cy, r - 9, player.name, accent);
}

function drawPlayerLabel(
  ctx: CanvasRenderingContext2D,
  player: PosterPlayer,
  cx: number,
  nameY: number,
  isFavorite: boolean
): void {
  const maxW = 440;
  const name = player.name.toUpperCase();
  fitText(ctx, name, maxW, 42, "800", false, 26);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = isFavorite ? "rgba(255,209,102,0.6)" : "rgba(255,255,255,0.45)";
  ctx.shadowBlur = 14;
  ctx.fillText(name, cx, nameY);
  ctx.shadowBlur = 0;

  // Rank / seed badge
  const badge =
    player.rank !== undefined
      ? `#${player.rank} RANKED`
      : player.seed !== undefined
        ? `SEED #${player.seed}`
        : "UNRANKED";
  ctx.font = font("700", 21, true);
  const tw = measureTracked(ctx, badge, 3);
  const pw = tw + 38;
  const ph = 38;
  const py = nameY + 48;
  roundRectPath(ctx, cx - pw / 2, py - ph / 2, pw, ph, ph / 2);
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fill();
  ctx.strokeStyle = isFavorite ? "rgba(255,209,102,0.45)" : "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  drawTracked(ctx, badge, cx, py + 1, 3);
}

// ─── Tournament header strip ────────────────────────────────────────────────

function drawSurfaceChip(ctx: CanvasRenderingContext2D, surface: PosterSurface, cx: number, cy: number): void {
  const chip = SURFACE_CHIPS[surface];
  ctx.save();
  ctx.font = font("800", 21, true);
  const textW = measureTracked(ctx, chip.text, 3);
  const dotR = 6;
  const dotGap = 12;
  const padX = 22;
  const totalW = padX * 2 + dotR * 2 + dotGap + textW;
  const h = 44;
  const x0 = cx - totalW / 2;
  roundRectPath(ctx, x0, cy - h / 2, totalW, h, h / 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = chip.color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const dotCx = x0 + padX + dotR;
  ctx.fillStyle = chip.color;
  ctx.shadowColor = chip.color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(dotCx, cy, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = chip.color;
  ctx.textBaseline = "middle";
  drawTrackedLeft(ctx, chip.text, dotCx + dotR + dotGap, cy + 1, 3);
  ctx.restore();
}

function drawTournamentStrip(ctx: CanvasRenderingContext2D, data: PosterData): void {
  ctx.textBaseline = "middle";
  const tournament = data.tournament.toUpperCase();
  fitTracked(ctx, tournament, 860, 36, "800", 4, false, 20);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.shadowColor = "rgba(255,255,255,0.4)";
  ctx.shadowBlur = 10;
  drawTracked(ctx, tournament, W / 2, 446, 4);
  ctx.shadowBlur = 0;

  const round = data.round.toUpperCase();
  fitTracked(ctx, round, 720, 26, "700", 4, true, 17);
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  drawTracked(ctx, round, W / 2, 492, 4);

  drawSurfaceChip(ctx, data.surface, W / 2, 542);
}

// ─── Glowing 3D tennis ball ─────────────────────────────────────────────────

function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, glow: number): void {
  // Soft glow halo
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const halo = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 2.1);
  halo.addColorStop(0, `rgba(223,255,79,${(0.35 * glow).toFixed(3)})`);
  halo.addColorStop(1, "rgba(223,255,79,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);
  ctx.restore();

  // Sphere body
  ctx.save();
  ctx.shadowColor = "rgba(223,255,79,0.65)";
  ctx.shadowBlur = 42;
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, "#f7ffbe");
  g.addColorStop(0.35, OPTIC);
  g.addColorStop(0.75, "#c3e02e");
  g.addColorStop(1, "#8fb31c");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;

  // White seam arcs (clipped to sphere)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  ctx.arc(cx - r * 1.18, cy, r * 0.95, -0.62, 0.62);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 1.18, cy, r * 0.95, Math.PI - 0.62, Math.PI + 0.62);
  ctx.stroke();

  // Sphere edge shading
  const sh = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
  sh.addColorStop(0, "rgba(0,0,0,0)");
  sh.addColorStop(1, "rgba(30,50,0,0.35)");
  ctx.fillStyle = sh;
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  ctx.restore();
}

// ─── Chips ──────────────────────────────────────────────────────────────────

function drawModelChip(ctx: CanvasRenderingContext2D, prob: number, cx: number, cy: number): void {
  const text = `MODEL P ${(prob * 100).toFixed(1)}%`;
  ctx.save();
  ctx.font = font("800", 21, true);
  const tw = measureTracked(ctx, text, 3);
  const w = tw + 46;
  const h = 44;
  roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = "rgba(255,209,102,0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,209,102,0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.textBaseline = "middle";
  drawTracked(ctx, text, cx, cy + 1, 3);
  ctx.restore();
}

function drawTimingChip(ctx: CanvasRenderingContext2D, label: string, cx: number, cy: number): void {
  ctx.save();
  ctx.textBaseline = "middle";
  fitText(ctx, label, 760, 22, "700");
  const tw = ctx.measureText(label).width;
  const clockR = 13;
  const gap = 12;
  const totalW = 22 + clockR * 2 + gap + tw + 22;
  const h = 46;
  const x0 = cx - totalW / 2;
  roundRectPath(ctx, x0, cy - h / 2, totalW, h, h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Tiny clock icon
  const ccx = x0 + 22 + clockR;
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ccx, cy, clockR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ccx, cy);
  ctx.lineTo(ccx, cy - 7);
  ctx.moveTo(ccx, cy);
  ctx.lineTo(ccx + 5, cy + 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(label, ccx + clockR + gap, cy + 1);
  ctx.restore();
}

// ─── Slip boxes (glassmorphism — v4.0 readable typography) ────────────────

interface SlipBoxOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  slip: { textEn: string; odds: number };
  blurred: boolean;
}

function drawSlipBox(ctx: CanvasRenderingContext2D, opts: SlipBoxOpts): void {
  const { x, y, w, h, label, slip, blurred } = opts;
  const pad = 32;

  // Glass panel
  roundRectPath(ctx, x, y, w, h, 26);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textBaseline = "middle";

  // Label (always sharp) — v4.5: 24px tracked label
  ctx.font = font("700", 24, true);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.textAlign = "left";
  drawTrackedLeft(ctx, label, x + pad, y + 34, 4);

  // Content (blurred in teaser mode)
  if (blurred) ctx.filter = "blur(7px)";

  // v4.5 FIX — the slip market text renders BIG: up to 3 wrapped lines at
  // 42px → 30px floor (v4.0 capped it at a 26px two-line floor that still
  // read as tiny print on long official market names).
  const maxTextW = w - pad * 2 - 250;
  const lines = wrapFit(ctx, slip.textEn, maxTextW, 42, "800", 30, 3);
  const lineYs = [y + 76, y + 120, y + 164];
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  lines.slice(0, 3).forEach((ln, i) => ctx.fillText(ln, x + pad, lineYs[i]));

  // Odds — v4.5: 52px bold gold in the right column
  ctx.font = font("800", 52, true);
  ctx.textAlign = "right";
  ctx.fillStyle = GOLD;
  ctx.fillText(`@${slip.odds.toFixed(2)}`, x + w - pad, y + 84);
  // implied probability directly under the odds (right column)
  const impliedPct = Math.max(0, Math.min(100, 100 / Math.max(slip.odds, 1.01)));
  ctx.font = font("600", 26, true);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillText(`P ≈ ${impliedPct.toFixed(1)}%`, x + w - pad, y + 136);
  ctx.textAlign = "left";

  ctx.filter = "none";
}

function drawPadlock(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const bw = 62;
  const bh = 48;
  const bodyTop = cy - 12;

  ctx.save();
  ctx.shadowColor = "rgba(255,209,102,0.75)";
  ctx.shadowBlur = 24;

  // Shackle
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, bodyTop, 17, Math.PI, Math.PI * 2);
  ctx.stroke();

  // Body
  roundRectPath(ctx, cx - bw / 2, bodyTop, bw, bh, 10);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Keyhole
  ctx.fillStyle = "rgba(60,40,0,0.85)";
  ctx.beginPath();
  ctx.arc(cx, bodyTop + bh * 0.38, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - 3, bodyTop + bh * 0.38, 6, 14);
  ctx.restore();
}

// ─── Footer telemetry ───────────────────────────────────────────────────────

function drawFooter(ctx: CanvasRenderingContext2D, data: PosterData): void {
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.font = font("700", 23, true);
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  drawTracked(ctx, "NEOBET TENNIS QUANT • @AINEOBET • SHA-256 LOCKED", W / 2, 1318, 5);

  if (data.hashPre) {
    const lock = `LOCK ${data.hashPre.slice(0, 10).toUpperCase()}`;
    ctx.font = font("700", 20, true);
    ctx.fillStyle = "#67e8f9";
    drawTracked(ctx, lock, W / 2, 1362, 4);
  } else if (data.preview) {
    // engineering-review render: amber MODEL PREVIEW ribbon instead of the lock
    ctx.font = font("800", 21, true);
    const label = "MODEL PREVIEW — ENGINEERING REVIEW";
    const tw = ctx.measureText(label).width + 44;
    const bx = W / 2 - tw / 2;
    ctx.fillStyle = "rgba(245,197,66,0.14)";
    ctx.strokeStyle = "rgba(245,197,66,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, 1340, tw, 40, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f5c542";
    ctx.textAlign = "center";
    ctx.fillText(label, W / 2, 1361);
  }
  ctx.restore();
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function drawPoster(canvas: HTMLCanvasElement, data: PosterData): Promise<void> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable");

  // Reset any inherited state
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.textBaseline = "middle";

  // Flags load in parallel through the same-origin proxy; failures fall back
  // to neon-initials rings after the timeout.
  const [flagA, flagB] = await Promise.all([
    data.playerA.flagUrl ? loadFlag(data.playerA.flagUrl) : Promise.resolve(null),
    data.playerB.flagUrl ? loadFlag(data.playerB.flagUrl) : Promise.resolve(null),
  ]);

  // Deterministic per-match RNG: particles / glow variation are seeded from
  // the player names so the same match renders pixel-identically.
  const rng = mulberry32(hashStringToSeed(`${data.playerA.name}${data.playerB.name}`));
  const glowJitter = 0.85 + rng() * 0.3; // 0.85..1.15
  const glow2 = 0.85 + rng() * 0.3;

  const pal = PALETTES[data.surface];

  // 1. Procedural court background
  drawCourt(ctx, pal);
  if (data.surface === "HARD") drawFloodBeams(ctx, glowJitter);
  if (data.surface === "CLAY") {
    // Dust particles are seeded from hashPre so the same match renders identically
    drawClayDust(ctx, mulberry32(hashStringToSeed(data.hashPre ?? `${data.playerA.name} vs ${data.playerB.name}`)));
  }
  if (data.surface === "GRASS") drawGrassHalo(ctx, W / 2, 690, glowJitter);
  drawVignette(ctx);

  // 2. Player rings + names + badges
  const ringY = 190;
  const ringR = 88;
  const cxA = 268;
  const cxB = W - 268;
  drawPlayerRing(ctx, data.playerA, flagA, cxA, ringY, ringR, data.favorite === "A");
  drawPlayerRing(ctx, data.playerB, flagB, cxB, ringY, ringR, data.favorite === "B");
  drawPlayerLabel(ctx, data.playerA, cxA, 320, data.favorite === "A");
  drawPlayerLabel(ctx, data.playerB, cxB, 320, data.favorite === "B");

  // 3. Tournament header strip
  drawTournamentStrip(ctx, data);

  // 4. Center glowing ball
  drawBall(ctx, W / 2, 690, 86, glow2);

  // 5. MODEL P chip
  if (typeof data.marketProbAFav === "number" && Number.isFinite(data.marketProbAFav)) {
    drawModelChip(ctx, Math.max(0, Math.min(1, data.marketProbAFav)), W / 2, 800);
  }

  // 6. Slip boxes — v4.5: 186px-tall boxes so the official market text
  // renders at 30–42px over up to 3 wrapped lines (never shrunken small print)
  const boxX = 90;
  const boxW = W - 180;
  const boxH = 186;
  if (data.slipA) {
    drawSlipBox(ctx, { x: boxX, y: 842, w: boxW, h: boxH, label: "SLIP A", slip: data.slipA, blurred: false });
  }
  if (data.slipB) {
    const teaser = data.mode === "teaser";
    const by = 1046;
    drawSlipBox(ctx, { x: boxX, y: by, w: boxW, h: boxH, label: "SLIP B", slip: data.slipB, blurred: teaser });
    if (teaser) {
      // Dark backing panel + padlock + "UNLOCK IN VIP"
      const panelW = 250;
      const panelH = 118;
      const panelCy = by + boxH / 2 - 2;
      roundRectPath(ctx, W / 2 - panelW / 2, panelCy - panelH / 2, panelW, panelH, 20);
      ctx.fillStyle = "rgba(6,10,22,0.6)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,209,102,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      drawPadlock(ctx, W / 2, panelCy - 12);
      ctx.font = font("800", 19, true);
      ctx.fillStyle = GOLD;
      ctx.textBaseline = "middle";
      drawTracked(ctx, "UNLOCK IN VIP", W / 2, panelCy + 38, 4);
    }
  }

  // 7. Timing chip (aligned under the taller slip boxes)
  if (data.timingLabel) drawTimingChip(ctx, data.timingLabel, W / 2, 1262);

  // 8. Footer telemetry
  drawFooter(ctx, data);
}
