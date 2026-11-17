// ─── Poster engine: Retro 16-Bit Arcade renderer ────────────────────────────
// Self-generating poster system. Renders pixel-art posters as PNG buffers
// with @napi-rs/canvas ONLY (headless, no DOM, no network fetches).
//
// Pipeline: seeded rng -> background(theme) -> kind layout -> HUD -> footer
//           -> CRT overlay -> PNG buffer -> base64.

import {
  createCanvas,
  GlobalFonts,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import type {
  PosterKind,
  PosterRequest,
  PosterRow,
  PosterSlipBox,
  RenderResult,
} from "../types";
import { latinize, latinizeCount } from "./latinize";
import { drawBackground } from "./background";
import { drawCrt } from "./crt";
import { drawSprite, SPRITES, type Sprite } from "./sprites";
import { hashString, makeRng, type Rng } from "./rng";

// ─── palette ────────────────────────────────────────────────────────────────

export const COLORS = {
  gold: "#ffd166",
  optic: "#dfff4f",
  cyan: "#4dd6ff",
  magenta: "#ff4dd6",
  green: "#42e282",
  red: "#ff5d5d",
  cream: "#fff6e8",
  ink: "#0a0a14",
  grey: "#9aa7b4",
  panel: "rgba(8,10,20,0.88)",
  panelSoft: "rgba(10,12,24,0.72)",
} as const;

const GOLD = COLORS.gold;
const OPTIC = COLORS.optic;
const CYAN = COLORS.cyan;
const MAGENTA = COLORS.magenta;
const GREEN = COLORS.green;
const RED = COLORS.red;
const CREAM = COLORS.cream;
const INK = COLORS.ink;
const GREY = COLORS.grey;
const PANEL = COLORS.panel;

const MONO = '"DejaVu Sans Mono"';
const SANS = '"DejaVu Sans"';

const fMono = (size: number, weight = "bold"): string => `${weight} ${size}px ${MONO}`;
const fSans = (size: number, weight = "bold"): string => `${weight} ${size}px ${SANS}`;

// ─── font registration (idempotent) ─────────────────────────────────────────

let fontsRegistered = false;

export function registerFonts(): void {
  if (fontsRegistered) return;
  const candidates: Array<[string, string]> = [
    ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "DejaVu Sans Mono"],
    ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "DejaVu Sans Mono"],
    ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "DejaVu Sans"],
    ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVu Sans"],
  ];
  for (const [path, family] of candidates) {
    try {
      GlobalFonts.registerFromPath(path, family);
    } catch {
      // fontconfig system fonts are used as fallback via ctx.font family names
    }
  }
  fontsRegistered = true;
}

// ─── shared text/border helpers (exported) ──────────────────────────────────

/** manual word-wrap; returns lines */
export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number, font: string): string[] {
  ctx.font = font;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const test = cur ? `${cur} ${wd}` : wd;
    if (ctx.measureText(test).width <= maxWidth || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = wd;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** draw wrapped text; returns the y coordinate BELOW the last line */
export function fillWrapped(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: string,
  color: string,
  opts?: { align?: CanvasTextAlign; lineHeight?: number; maxLines?: number },
): number {
  const lh = opts?.lineHeight ?? 30;
  ctx.font = font;
  let lines = wrapText(ctx, text, maxWidth, font);
  if (opts?.maxLines && lines.length > opts.maxLines) {
    lines = lines.slice(0, opts.maxLines);
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,]$/, "")}...`;
  }
  ctx.fillStyle = color;
  ctx.textAlign = opts?.align ?? "left";
  ctx.textBaseline = "alphabetic";
  let yy = y;
  for (const line of lines) {
    ctx.fillText(line, x, yy);
    yy += lh;
  }
  ctx.textAlign = "left";
  return yy - lh;
}

/** classic 16-bit dialog border: double line with corner notches */
export function drawPixelBorder(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  thick = 2,
): void {
  ctx.fillStyle = color;
  // outer line, notched corners
  ctx.fillRect(x + 4, y, w - 8, thick);
  ctx.fillRect(x + 4, y + h - thick, w - 8, thick);
  ctx.fillRect(x, y + 4, thick, h - 8);
  ctx.fillRect(x + w - thick, y + 4, thick, h - 8);
  // corner step pixels
  ctx.fillRect(x + 2, y + 2, thick, thick);
  ctx.fillRect(x + w - 2 - thick, y + 2, thick, thick);
  ctx.fillRect(x + 2, y + h - 2 - thick, thick, thick);
  ctx.fillRect(x + w - 2 - thick, y + h - 2 - thick, thick, thick);
  // inner line
  const i = 7;
  if (w > 2 * i + 10 && h > 2 * i + 10) {
    ctx.fillRect(x + i + 4, y + i, w - 2 * i - 8, thick);
    ctx.fillRect(x + i + 4, y + h - i - thick, w - 2 * i - 8, thick);
    ctx.fillRect(x + i, y + i + 4, thick, h - 2 * i - 8);
    ctx.fillRect(x + w - i - thick, y + i + 4, thick, h - 2 * i - 8);
  }
}

/** pixel segmented progress bar (0..1) */
export function segmentedBar(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string,
): void {
  const period = 16;
  const nSeg = Math.max(1, Math.floor((w + 4) / period));
  const filled = Math.round(nSeg * Math.min(1, Math.max(0, frac)));
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x, y + h, w, 3);
  for (let i = 0; i < nSeg; i++) {
    ctx.fillStyle = i < filled ? color : "rgba(255,255,255,0.10)";
    ctx.fillRect(x + i * period, y, period - 4, h);
    if (i < filled) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x + i * period, y, period - 4, 3);
    }
  }
}

// ─── painter wrapper (latinize accounting) ──────────────────────────────────

interface ChipOpts {
  font: string;
  fg: string;
  bg?: string;
  border?: string;
  padX?: number;
  h?: number;
}

class Painter {
  ctx: SKRSContext2D;
  w: number;
  h: number;
  rng: Rng;
  latin = 0;

  constructor(ctx: SKRSContext2D, w: number, h: number, rng: Rng) {
    this.ctx = ctx;
    this.w = w;
    this.h = h;
    this.rng = rng;
  }

  /** latinize + count changes */
  l(s: string): string {
    const r = latinizeCount(s);
    this.latin += r.changes;
    return r.text;
  }

  measure(s: string, font: string): number {
    this.ctx.font = font;
    return this.ctx.measureText(latinize(s)).width;
  }

  text(
    s: string,
    x: number,
    y: number,
    font: string,
    color: string,
    align: CanvasTextAlign = "left",
    baseline: CanvasTextBaseline = "alphabetic",
  ): void {
    const t = this.l(s);
    this.ctx.font = font;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = baseline;
    this.ctx.fillText(t, x, y);
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "alphabetic";
  }

  /** letter-spaced text (arcade title style); counted once */
  textSpaced(
    s: string,
    x: number,
    y: number,
    font: string,
    color: string,
    spacing: number,
    align: "left" | "center" | "right" = "left",
  ): void {
    const t = this.l(s);
    this.ctx.font = font;
    let total = 0;
    for (const ch of t) total += this.ctx.measureText(ch).width + spacing;
    total -= spacing;
    let cx = x;
    if (align === "center") cx = x - total / 2;
    if (align === "right") cx = x - total;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "alphabetic";
    for (const ch of t) {
      this.ctx.fillText(ch, cx, y);
      cx += this.ctx.measureText(ch).width + spacing;
    }
  }

  /** wrapped text with latin accounting; returns bottom y of last line */
  wrapped(
    s: string,
    x: number,
    y: number,
    maxW: number,
    font: string,
    color: string,
    lh = 30,
    maxLines?: number,
    align: CanvasTextAlign = "left",
  ): number {
    const t = this.l(s);
    return fillWrapped(this.ctx, t, x, y, maxW, font, color, {
      lineHeight: lh,
      maxLines,
      align,
    });
  }

  /** small labeled chip; returns total width */
  chip(text: string, x: number, y: number, o: ChipOpts): number {
    const t = this.l(text);
    this.ctx.font = o.font;
    const tw = this.ctx.measureText(t).width;
    const padX = o.padX ?? 12;
    const h = o.h ?? 36;
    const w = Math.ceil(tw) + padX * 2;
    if (o.bg) {
      this.ctx.fillStyle = o.bg;
      this.ctx.fillRect(x, y, w, h);
    }
    if (o.border) {
      this.ctx.fillStyle = o.border;
      this.ctx.fillRect(x, y, w, 2);
      this.ctx.fillRect(x, y + h - 2, w, 2);
      this.ctx.fillRect(x, y, 2, h);
      this.ctx.fillRect(x + w - 2, y, 2, h);
    }
    this.ctx.fillStyle = o.fg;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(t, x + padX, y + h / 2 + 1);
    this.ctx.textBaseline = "alphabetic";
    return w;
  }

  /** centered chip; returns width */
  chipCentered(text: string, cx: number, y: number, o: ChipOpts): number {
    this.ctx.font = o.font;
    const tw = this.ctx.measureText(this.l(text)).width;
    const w = Math.ceil(tw) + (o.padX ?? 12) * 2;
    this.chip(text, Math.round(cx - w / 2), y, o);
    return w;
  }

  /** right-aligned chip; x is the RIGHT edge; returns width */
  chipRight(text: string, right: number, y: number, o: ChipOpts): number {
    this.ctx.font = o.font;
    const tw = this.ctx.measureText(this.l(text)).width;
    const w = Math.ceil(tw) + (o.padX ?? 12) * 2;
    this.chip(text, right - w, y, o);
    return w;
  }

  panel(x: number, y: number, w: number, h: number, fill: string = PANEL): void {
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, w, h);
  }

  /** truncate with ellipsis to fit width */
  fit(s: string, maxW: number, font: string): string {
    let t = this.l(s);
    this.ctx.font = font;
    if (this.ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && this.ctx.measureText(`${t}...`).width > maxW) {
      t = t.slice(0, -1);
    }
    return `${t.trimEnd()}...`;
  }
}

// ─── HUD header (every poster) ──────────────────────────────────────────────

const KINDS: PosterKind[] = [
  "FLASHCARD",
  "FREECARD",
  "BRIEFING",
  "AGGREGATE",
  "WEEKLY",
  "NEWS",
  "ACADEMY",
  "BANNER",
  "FTRESULTS",
];

function drawHud(P: Painter, req: PosterRequest): void {
  const { ctx, w } = P;
  ctx.fillStyle = "rgba(5,6,14,0.92)";
  ctx.fillRect(0, 0, w, 72);

  // left 16-BIT badge (gold pixel border)
  drawPixelBorder(ctx, 24, 14, 118, 46, GOLD);
  P.text("16-BIT", 83, 44, fMono(21), GOLD, "center");

  // center title (uppercase mono, white/gold, letter-spaced, auto-fit)
  const title = latinize(req.title).toUpperCase();
  const maxW = w - 430;
  let size = title.length > 18 ? 32 : 40;
  let font = fMono(size);
  while (P.measure(title, font) + (title.length - 1) * 2 > maxW && size > 22) {
    size -= 2;
    font = fMono(size);
  }
  const baseline = size >= 36 ? 48 : 45;
  // drop shadow then main text
  P.textSpaced(title, w / 2 + 3, baseline + 3, font, "rgba(255,93,93,0.55)", 2, "center");
  P.textSpaced(title, w / 2, baseline, font, CREAM, 2, "center");

  // right: INSERT COIN + coin sprite + stage label
  const stage = req.stage ?? `ST ${String(KINDS.indexOf(req.kind) + 1).padStart(2, "0")}`;
  const coinFont = fMono(20);
  const coinTextW = P.measure("INSERT COIN", coinFont);
  P.text("INSERT COIN", w - 24, 34, coinFont, GOLD, "right");
  P.text("_", w - 22, 34, fMono(20), "rgba(255,209,102,0.45)", "left");
  drawSprite(ctx, SPRITES.COIN, w - 24 - coinTextW - 48, 12, 3);
  P.text(stage, w - 24, 58, fMono(15), GREY, "right");

  // neon magenta divider
  ctx.fillStyle = MAGENTA;
  ctx.fillRect(0, 72, w, 3);
  ctx.fillStyle = "rgba(255,168,236,0.8)";
  ctx.fillRect(0, 72, w, 1);
}

// ─── footer bar (every poster) ──────────────────────────────────────────────

function drawFooter(P: Painter, req: PosterRequest, seed: number): void {
  const { ctx, w, h } = P;
  const y0 = h - 64;
  ctx.fillStyle = "rgba(5,6,14,0.92)";
  ctx.fillRect(0, y0, w, 64);
  ctx.fillStyle = "rgba(77,214,255,0.45)";
  ctx.fillRect(0, y0, w, 2);
  ctx.fillStyle = "rgba(77,214,255,0.12)";
  ctx.fillRect(0, y0 + 2, w, 1);

  // lives: 3 hearts
  for (let i = 0; i < 3; i++) {
    drawSprite(ctx, SPRITES.HEART, 24 + i * 38, y0 + 16, 3);
  }
  const rng = makeRng(seed ^ 0xc01a);
  const coins = 50 + (hashString(`${seed}`) % 450);
  P.text(`COINS x${coins}`, 148, y0 + 30, fMono(20), GOLD);
  P.text("CREDIT 01", 148, y0 + 54, fMono(17), CYAN);

  // right: lock hash + footer note
  const hash =
    req.hash ??
    `${(hashString(latinize(req.title)) >>> 0).toString(16)}${(hashString(req.kind) >>> 0).toString(16)}`.slice(0, 10).toUpperCase();
  P.text(`LOCK #${hash}`, w - 24, y0 + 30, fMono(18), GOLD, "right");
  if (req.footerNote) {
    P.text(P.fit(req.footerNote, 520, fMono(16)), w - 24, y0 + 54, fMono(16), GREY, "right");
  }
}

// ─── status chips ───────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { color: string; sprite?: Sprite }> = {
  WIN: { color: GREEN, sprite: SPRITES.CHECK },
  LOSS: { color: RED, sprite: SPRITES.CROSS },
  PENDING: { color: GREY, sprite: SPRITES.BELL },
  VETO: { color: MAGENTA, sprite: SPRITES.CROSS },
  INFO: { color: CYAN },
};

function statusChip(P: Painter, cx: number, cy: number, status: string, big = false): number {
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.INFO;
  const font = big ? fMono(22) : fMono(16);
  const padX = big ? 14 : 10;
  const h = big ? 48 : 36;
  const spriteW = st.sprite ? (big ? 30 : 22) : 0;
  P.ctx.font = font;
  const tw = P.ctx.measureText(latinize(status)).width;
  const w = Math.ceil(tw) + padX * 2 + spriteW + (st.sprite ? 8 : 0);
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);
  P.ctx.fillStyle = `${st.color}22`;
  P.ctx.fillRect(x, y, w, h);
  P.ctx.fillStyle = st.color;
  P.ctx.fillRect(x, y, w, 2);
  P.ctx.fillRect(x, y + h - 2, w, 2);
  P.ctx.fillRect(x, y, 2, h);
  P.ctx.fillRect(x + w - 2, y, 2, h);
  let ix = x + padX;
  if (st.sprite) {
    drawSprite(P.ctx, st.sprite, ix, Math.round(cy - (big ? 15 : 11)), big ? 3 : 2, { "#": st.color });
    ix += spriteW + 8;
  }
  P.ctx.fillStyle = st.color;
  P.ctx.textAlign = "left";
  P.ctx.textBaseline = "middle";
  P.ctx.fillText(latinize(status), ix, cy + 1);
  P.ctx.textBaseline = "alphabetic";
  return w;
}

// ─── shared sub-blocks ──────────────────────────────────────────────────────

function drawPlayerPlate(
  P: Painter,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  full: string,
  rank: number | undefined,
  flag: string | undefined,
  accent: string,
  fav = false,
  seed?: number,
  tele: { hold?: number; bps?: number; p?: number } = {},
): void {
  P.panel(x, y, w, h, PANEL);
  drawPixelBorder(P.ctx, x, y, w, h, accent);
  if (rank !== undefined) {
    P.chip(`#${rank}`, x + 18, y + 16, { font: fMono(20), fg: GOLD, border: GOLD, bg: "rgba(255,209,102,0.10)", h: 34, padX: 10 });
  }
  if (seed !== undefined) {
    const seedX = x + 18 + (rank !== undefined ? 76 : 0);
    P.chip(`S${seed}`, seedX, y + 16, { font: fMono(20), fg: CYAN, border: CYAN, bg: "rgba(77,214,255,0.10)", h: 34, padX: 10 });
  }
  if (flag) {
    P.chipRight(flag, x + w - 18, y + 16, { font: fMono(18), fg: GREY, border: "#3d4654", bg: "rgba(61,70,84,0.3)", h: 34, padX: 10 });
  }
  // v10 — per-player DEDICATED telemetry layout: when HOLD/BPS telemetry is
  // present the plate packs [rank][seed][FAV]…[flag] on the top row, the big
  // name at y+88, the full name at y+122 and the two telemetry rows at the
  // bottom — nothing overlaps, every number is THIS player's own.
  const hasTele = tele.hold !== undefined || tele.bps !== undefined;
  const nameY = hasTele ? y + 88 : y + 112;
  const shortFont = fMono(40);
  const short = P.fit(name, w - 60, shortFont);
  P.text(short, x + w / 2 + 3, nameY + 3, shortFont, "rgba(0,0,0,0.5)", "center");
  P.text(short, x + w / 2, nameY, shortFont, CREAM, "center");
  if (full && full !== name) {
    P.text(P.fit(full, w - 60, fSans(20)), x + w / 2, hasTele ? y + 122 : y + 152, fSans(20, "normal"), GREY, "center");
  }
  const microRow = (label: string, value: number | undefined, ry: number) => {
    if (value === undefined || !Number.isFinite(value)) return;
    const pct = Math.max(0, Math.min(1, value));
    P.ctx.font = fMono(15);
    P.text(label, x + 18, ry, fMono(15), GREY, "left");
    const barX = x + 130;
    const barW = w - 218;
    P.ctx.fillStyle = "rgba(255,255,255,0.10)";
    P.ctx.fillRect(barX, ry - 10, barW, 10);
    P.ctx.fillStyle = pct >= 0.8 ? GREEN : pct >= 0.6 ? GOLD : RED;
    P.ctx.fillRect(barX, ry - 10, Math.max(4, Math.round(barW * pct)), 10);
    P.text(`${Math.round(pct * 100)}%`, x + w - 18, ry, fMono(16), CREAM, "right");
  };
  if (hasTele) {
    microRow("HOLD", tele.hold, y + h - 42);
    microRow("BPS", tele.bps, y + h - 18);
    if (fav) {
      const favFont = fMono(16);
      const favX = x + 18 + (rank !== undefined ? 76 : 0) + (seed !== undefined ? 74 : 0);
      P.chip("FAV", favX, y + 16, { font: favFont, fg: INK, bg: GOLD, h: 34, padX: 10 });
    }
  } else if (fav) {
    const favFont = fMono(16);
    P.ctx.font = favFont;
    const tw = P.ctx.measureText("FAV").width;
    P.chip("FAV", x + 18, y + h - 52, { font: favFont, fg: INK, bg: GOLD, h: 32, padX: 10 });
    drawSprite(P.ctx, SPRITES.STAR, x + 28 + tw + 14, y + h - 47, 2, { "#": GOLD });
  }
}

function drawSlipBox(P: Painter, x: number, y: number, w: number, h: number, slip: PosterSlipBox, accent: string, forFree: boolean): void {
  P.panel(x, y, w, h, PANEL);
  drawPixelBorder(P.ctx, x, y, w, h, slip.locked ? GREY : accent);

  // key chip + wing label — LEGIBILITY FIX (director: slip font too small)
  P.chip(`KEY: ${slip.key}`, x + 20, y + 18, { font: fMono(19), fg: GOLD, border: GOLD, bg: "rgba(255,209,102,0.08)", h: 36 });
  P.chipRight(slip.label, x + w - 20, y + 18, {
    font: fMono(19),
    fg: INK,
    bg: slip.locked ? GREY : accent,
    h: 36,
  });

  if (slip.locked) {
    // static noise
    for (let i = 0; i < 90; i++) {
      const a = P.rng.range(0.05, 0.16);
      P.ctx.fillStyle = `rgba(255,255,255,${a})`;
      P.ctx.fillRect(x + 14 + P.rng.int(0, w - 34), y + 96 + P.rng.int(0, h - 130), P.rng.int(6, 26), P.rng.int(2, 5));
    }
    drawSprite(P.ctx, SPRITES.PADLOCK, x + w / 2 - 36, y + 118, 6);
    // ribbon
    const rbY = y + 250;
    P.ctx.fillStyle = "rgba(255,93,93,0.16)";
    P.ctx.fillRect(x + 22, rbY, w - 44, 52);
    P.ctx.fillStyle = RED;
    P.ctx.fillRect(x + 22, rbY, w - 44, 2);
    P.ctx.fillRect(x + 22, rbY + 50, w - 44, 2);
    P.text("LOCKED - FULL CARD IN VIP", x + w / 2, rbY + 34, fMono(21), CREAM, "center");
    P.text("ODDS HIDDEN", x + w / 2, y + 352, fMono(22), GREY, "center");
    P.text("UNLOCK IN VIP ARENA", x + w / 2, y + 392, fMono(19), GOLD, "center");
    // market name stays visible (teaser) — centered INSIDE the box
    P.wrapped(slip.marketEn, x + w / 2, y + 88, w - 48, fSans(28), CREAM, 36, 1, "center");
    return;
  }

  // market name
  const marketLines = P.wrapped(slip.marketEn, x + 24, y + 88, w - 48, fSans(28), CREAM, 36, 2);
  // detail — bumped 17→20px (director legibility fix), 4 wrap lines stay in band
  const detailY = Math.max(marketLines + 28, y + 146);
  P.wrapped(slip.detail, x + 24, detailY, w - 48, fMono(20, "normal"), GREY, 27, 4);

  // stake + edge chips (director rule: stake per tip must be visible)
  if (slip.stake !== undefined || slip.edge !== undefined) {
    const chipY = y + 262;
    if (slip.stake !== undefined) {
      const stakeText = `STAKE ${slip.stake === Math.floor(slip.stake) ? slip.stake : slip.stake.toFixed(1)}U`;
      P.chip(stakeText, x + 24, chipY, {
        font: fMono(23),
        fg: INK,
        bg: GOLD,
        h: 50,
        padX: 16,
      });
    }
    if (slip.edge !== undefined) {
      const pct = slip.edge * 100;
      const sign = pct >= 0 ? "+" : "−";
      const edgeText = `EDGE ${sign}${Math.abs(pct).toFixed(1)}%`;
      const pos = pct >= 0;
      const col = pos ? GREEN : RED;
      P.chipRight(edgeText, x + w - 24, chipY, {
        font: fMono(23),
        fg: col,
        border: col,
        bg: pos ? "rgba(66,226,130,0.10)" : "rgba(255,93,93,0.10)",
        h: 50,
        padX: 16,
      });
    }
  }

  // odds
  P.text("ODDS", x + w / 2, y + h - 222, fMono(18), GREY, "center");
  P.text(slip.odds.toFixed(2), x + w / 2 + 4, y + h - 138, fMono(88), GOLD, "center");

  // probability bar
  if (!forFree || slip.prob !== undefined) {
    const prob = slip.prob ?? 0.5;
    P.text(`PROB ${Math.round(prob * 100)}%`, x + w - 24, y + h - 76, fMono(18), GREY, "right");
    segmentedBar(P.ctx, x + 24, y + h - 66, w - 48, 18, prob, accent);
  }
}

function drawSectionLabel(P: Painter, x: number, y: number, label: string, color: string): void {
  P.ctx.fillStyle = color;
  P.ctx.fillRect(x - 14, y - 24, 6, 30);
  P.text(label, x, y, fMono(24), color);
}

// ─── FLASHCARD / FREECARD ───────────────────────────────────────────────────

function drawFlashcard(P: Painter, req: PosterRequest): void {
  const { w } = P;
  const free = req.kind === "FREECARD";
  const pl = req.players;
  const intel = req.intel;

  // tour + tournament + round + city (enrichment: venue always visible)
  if (req.tournament || req.round) {
    const tourPart = intel?.tour ? `${intel.tour.toUpperCase()} - ` : "";
    const cityPart = intel?.city ? ` - ${intel.city.toUpperCase()}` : "";
    const line = `${tourPart}${req.tournament ?? ""}${req.round ? ` - ${req.round}` : ""}${cityPart}`.trim();
    P.text(P.fit(line, w - 80, fMono(22)), w / 2, 110, fMono(22), CYAN, "center");
  }

  // player plates (favorite gets the star) — v10: per-player DEDICATED
  // telemetry bars (HOLD% / BPS%) so every card shows ITS OWN two players'
  // numbers, never a shared fixed value
  if (pl) {
    drawPlayerPlate(P, 24, 130, 470, 190, pl.shortA ?? pl.a, pl.a, pl.rankA, pl.flagA, GOLD, intel?.favSide === "A", pl.seedA, {
      hold: pl.holdA,
      bps: pl.bpsA,
      p: pl.markovPA,
    });
    drawPlayerPlate(P, 586, 130, 470, 190, pl.shortB ?? pl.b, pl.b, pl.rankB, pl.flagB, CYAN, intel?.favSide === "B", pl.seedB, {
      hold: pl.holdB,
      bps: pl.bpsB,
      p: pl.markovPB,
    });

    // center VS with ball above
    drawSprite(P.ctx, SPRITES.BALL, 516, 142, 4);
    P.text("VS", 543, 256, fMono(72), "rgba(255,93,93,0.6)", "center");
    P.text("VS", 540, 252, fMono(72), GOLD, "center");
  }

  // surface chip
  if (req.surfaceLabel) {
    P.chipCentered(req.surfaceLabel, w / 2, 344, {
      font: fMono(20),
      fg: OPTIC,
      border: OPTIC,
      bg: "rgba(223,255,79,0.07)",
      h: 40,
      padX: 18,
    });
  }

  // enrichment row: model prediction + ranking gap (fuller English cards)
  const enrich: Array<{ t: string; fg: string; border: string; bg: string }> = [];
  if (intel?.prediction) {
    enrich.push({ t: intel.prediction.toUpperCase(), fg: GOLD, border: GOLD, bg: "rgba(255,209,102,0.10)" });
  }
  if (intel?.rankGap) {
    enrich.push({ t: intel.rankGap.toUpperCase(), fg: MAGENTA, border: MAGENTA, bg: "rgba(255,77,214,0.08)" });
  }
  // v10 — the golden-gate verdict chips (pattern + guaranteed net return)
  if (intel?.patternLabel) {
    enrich.push({ t: intel.patternLabel.toUpperCase(), fg: GREEN, border: GREEN, bg: "rgba(66,226,130,0.10)" });
  }
  if (intel?.overlapNet) {
    enrich.push({ t: `POSITIVE OVERLAP NET ${intel.overlapNet}`, fg: OPTIC, border: OPTIC, bg: "rgba(223,255,79,0.08)" });
  }
  let slipY = 452;
  if (enrich.length > 0) {
    const eH = 32;
    const eGap = 14;
    const eW = enrich.map((c) => {
      P.ctx.font = fMono(15);
      return Math.ceil(P.ctx.measureText(c.t).width) + 24;
    });
    const eTotal = eW.reduce((a, b) => a + b, 0) + eGap * (enrich.length - 1);
    let ex = w / 2 - eTotal / 2;
    enrich.forEach((c, i) => {
      P.chip(c.t, Math.round(ex), 388, { font: fMono(15), fg: c.fg, border: c.border, bg: c.bg, h: eH, padX: 12 });
      ex += eW[i] + eGap;
    });
    slipY = 470; // push slips down so the enrichment row never overlaps
  }

  // section header with side deco lines (baseline = slipY header anchor)
  const header = free ? "OFFICIAL MARKET SLIPS - 1 OF 2 FREE" : "OFFICIAL MARKET SLIPS";
  const hFont = fMono(26);
  const hW = P.measure(header, hFont);
  P.text(header, w / 2, slipY, hFont, GOLD, "center");
  P.ctx.fillStyle = "rgba(255,209,102,0.5)";
  P.ctx.fillRect(w / 2 - hW / 2 - 110, slipY - 8, 86, 3);
  P.ctx.fillRect(w / 2 + hW / 2 + 24, slipY - 8, 86, 3);

  if (free) {
    // FREE TO PLAY green banner strip (below the header, above the slips)
    const by = slipY + 20;
    const bw = 460;
    P.ctx.fillStyle = "rgba(66,226,130,0.14)";
    P.ctx.fillRect(w / 2 - bw / 2, by, bw, 46);
    drawPixelBorder(P.ctx, w / 2 - bw / 2, by, bw, 46, GREEN);
    P.text("FREE TO PLAY - TODAY'S GIFT", w / 2, by + 31, fMono(22), GREEN, "center");
    slipY += 88;
  } else {
    slipY += 24;
  }

  // slip boxes
  const slips = req.slips ?? [];
  const boxH = free ? 520 : 540;
  const bw = 514;
  if (slips[0]) drawSlipBox(P, 24, slipY, bw, boxH, slips[0], GOLD, free);
  if (slips[1]) drawSlipBox(P, w - 24 - bw, slipY, bw, boxH, slips[1], CYAN, free);

  // ── bottom block: intel strip + time + rotating insight panel ──────────
  const infoY = slipY + boxH + 26;
  const hasIntel = !!intel && (intel.favProb !== undefined || intel.coverage !== undefined || intel.archLabel);

  if (hasIntel) {
    // intel chips row (model / coverage / archetype / timing)
    const chips: Array<{ t: string; fg: string; border: string; bg: string }> = [];
    if (intel?.favProb !== undefined) {
      chips.push({ t: `MODEL ${Math.round(intel.favProb * 100)}%`, fg: GOLD, border: GOLD, bg: "rgba(255,209,102,0.10)" });
    }
    if (intel?.coverage !== undefined) {
      chips.push({ t: `COVER ${Math.round(intel.coverage * 100)}%`, fg: OPTIC, border: OPTIC, bg: "rgba(223,255,79,0.08)" });
    }
    if (intel?.archLabel) {
      chips.push({ t: P.fit(`ARCH ${intel.archLabel}`, 230, fMono(16)), fg: CYAN, border: CYAN, bg: "rgba(77,214,255,0.08)" });
    }
    if (intel?.timing) {
      chips.push({ t: P.fit(intel.timing.toUpperCase(), 230, fMono(16)), fg: GREY, border: "#3d4654", bg: "rgba(61,70,84,0.25)" });
    }
    const chipH = 38;
    const gap = 14;
    const widths = chips.map((c) => {
      P.ctx.font = fMono(16);
      return Math.ceil(P.ctx.measureText(c.t).width) + 26;
    });
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1);
    let cx = w / 2 - totalW / 2;
    chips.forEach((c, i) => {
      P.chip(c.t, Math.round(cx), infoY, { font: fMono(16), fg: c.fg, border: c.border, bg: c.bg, h: chipH, padX: 13 });
      cx += widths[i] + gap;
    });

    // time chip
    if (req.timeLabel) {
      P.chipCentered(req.timeLabel, w / 2, infoY + 54, {
        font: fMono(20),
        fg: CREAM,
        border: GREY,
        bg: "rgba(154,167,180,0.10)",
        h: 42,
        padX: 18,
      });
    }

    // rotating insight panel (content changes every pass — anti-repeat)
    if (intel?.insightEn) {
      const py = infoY + 116;
      const ph = intel.totalStake ? 208 : 168;
      P.panel(24, py, w - 48, ph, PANEL);
      drawPixelBorder(P.ctx, 24, py, w - 48, ph, GOLD);
      const angleTitle = intel.angleLabel
        ? `${intel.angleLabel.toUpperCase()} - SUPERVISOR ROTATION`
        : "SUPERVISOR INSIGHT";
      drawSectionLabel(P, 62, py + 44, angleTitle, GOLD);
      drawSprite(P.ctx, SPRITES.STAR, w - 110, py + 26, 3, { "#": GOLD });
      P.wrapped(intel.insightEn, 62, py + 92, w - 190, fMono(19, "normal"), CREAM, 27, 3);
      // enrichment: total position risk + per-tip stake breakdown line
      if (intel.totalStake) {
        P.ctx.fillStyle = "rgba(255,209,102,0.14)";
        P.ctx.fillRect(44, py + ph - 64, w - 88, 44);
        const stakeLine = `${intel.totalStake}${intel.stakeDetail ? `  |  ${intel.stakeDetail}` : ""}`;
        P.ctx.font = fMono(19);
        const sW = P.ctx.measureText(stakeLine).width;
        P.text(stakeLine, w / 2, py + ph - 35, fMono(19), GOLD, "center");
        P.ctx.fillStyle = GOLD;
        P.ctx.fillRect(w / 2 - sW / 2 - 20, py + ph - 64, 3, 44);
        P.ctx.fillRect(w / 2 + sW / 2 + 17, py + ph - 64, 3, 44);
      }
    }
  } else {
    // legacy bottom block
    if (req.timeLabel) {
      P.chipCentered(req.timeLabel, w / 2, infoY, {
        font: fMono(20),
        fg: CREAM,
        border: GREY,
        bg: "rgba(154,167,180,0.10)",
        h: 42,
        padX: 18,
      });
    }
    const decoY = infoY + 74;
    P.ctx.globalAlpha = 0.92;
    drawSprite(P.ctx, SPRITES.RACKET, 110, decoY, 7);
    drawSprite(P.ctx, SPRITES.BALL, 486, decoY + 26, 7);
    drawSprite(P.ctx, SPRITES.JOYSTICK, 860, decoY, 7);
    P.ctx.globalAlpha = 1;
  }
}

// ─── BRIEFING (1080x1920) ───────────────────────────────────────────────────

function drawBriefing(P: Painter, req: PosterRequest): void {
  const { w } = P;
  if (req.subtitle) {
    P.text(req.subtitle, w / 2, 108, fMono(21), CYAN, "center");
  }

  // match table
  const matches = (req.rows ?? []).filter((r) => r.status !== "VETO").slice(0, 8);
  const vetoes = (req.rows ?? []).filter((r) => r.status === "VETO").slice(0, 5);
  const rowH = 84;
  const headH = 42;
  const tx = 24;
  const tw = w - 48;
  const ty = 140;
  const th = headH + matches.length * rowH;

  P.ctx.fillStyle = "rgba(255,209,102,0.10)";
  P.ctx.fillRect(tx, ty, tw, headH);
  P.text("TIME", tx + 24, ty + 28, fMono(18), GOLD);
  P.text("MATCH", tx + 148, ty + 28, fMono(18), GOLD);
  P.text("PICK / ODDS", tx + tw - 24, ty + 28, fMono(18), GOLD, "right");

  matches.forEach((r: PosterRow, i: number) => {
    const ry = ty + headH + i * rowH;
    if (i % 2 === 1) {
      P.ctx.fillStyle = "rgba(255,255,255,0.045)";
      P.ctx.fillRect(tx, ry, tw, rowH);
    }
    const raw = P.l(r.label);
    const isTime = /^\d{1,2}:\d{2}/.test(raw);
    const time = isTime ? raw.slice(0, 5) : "--:--";
    const match = isTime ? raw.slice(5).trim() : raw;
    P.text(time, tx + 24, ry + 52, fMono(24), GOLD);
    P.text(P.fit(match, 560, fSans(21)), tx + 148, ry + 52, fSans(21), CREAM);
    P.text(P.fit(r.value, 300, fMono(19)), tx + tw - 24, ry + 52, fMono(19), CYAN, "right");
  });
  drawPixelBorder(P.ctx, tx, ty, tw, th, GOLD);

  // execution discipline box
  let y = ty + th + 30;
  const bullets = (req.bullets ?? []).slice(0, 4);
  const dbH = 92 + bullets.length * 62;
  P.panel(tx, y, tw, dbH, PANEL);
  drawPixelBorder(P.ctx, tx, y, tw, dbH, GOLD);
  drawSectionLabel(P, tx + 38, y + 52, "EXECUTION DISCIPLINE", GOLD);
  let by = y + 100;
  for (const b of bullets) {
    drawSprite(P.ctx, SPRITES.ARROW_UP, tx + 34, by - 18, 2, { "#": GOLD });
    const endY = P.wrapped(b, tx + 92, by, tw - 130, fMono(19, "normal"), CREAM, 28, 2);
    by += Math.max(62, endY - by + 34);
  }

  // veto transparency box
  y += dbH + 26;
  const vtH = 88 + Math.max(1, vetoes.length) * 56;
  P.panel(tx, y, tw, vtH, "rgba(30,10,16,0.72)");
  drawPixelBorder(P.ctx, tx, y, tw, vtH, MAGENTA);
  drawSectionLabel(P, tx + 38, y + 52, "VETO TRANSPARENCY", MAGENTA);
  let vy = y + 104;
  if (vetoes.length === 0) {
    P.text("NO VETOES TODAY - CLEAN SLATE", tx + 92, vy, fMono(19), GREY);
    vy += 56;
  }
  for (const v of vetoes) {
    drawSprite(P.ctx, SPRITES.CROSS, tx + 36, vy - 18, 2);
    P.text(P.fit(v.label, 480, fSans(19)), tx + 92, vy, fSans(19), CREAM);
    P.text(P.fit(v.value, 380, fMono(17, "normal")), tx + tw - 36, vy, fMono(17, "normal"), GREY, "right");
    vy += 56;
  }

  // stats strip
  y += vtH + 28;
  const stats = (req.stats ?? []).slice(0, 4);
  const cw = 246;
  const gap = (tw - stats.length * cw) / Math.max(1, stats.length - 1);
  stats.forEach((s, i) => {
    const sx = tx + i * (cw + gap);
    P.panel(sx, y, cw, 100, PANEL);
    drawPixelBorder(P.ctx, sx, y, cw, 100, s.accent ? GOLD : "#3d4654");
    P.text(s.value, sx + cw / 2 + 2, y + 52, fMono(36), s.accent ? GOLD : CREAM, "center");
    P.text(s.label, sx + cw / 2, y + 80, fMono(15, "normal"), GREY, "center");
  });
}

// ─── AGGREGATE ──────────────────────────────────────────────────────────────

function drawAggregate(P: Painter, req: PosterRequest): void {
  const { w } = P;
  if (req.subtitle) P.text(req.subtitle, w / 2, 108, fMono(21), CYAN, "center");

  // stats grid 2x3
  const stats = (req.stats ?? []).slice(0, 6);
  const cw = 326;
  const ch = 112;
  const gx = 27;
  const gy = 26;
  stats.forEach((s, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const sx = 24 + col * (cw + gx);
    const sy = 140 + row * (ch + gy);
    P.panel(sx, sy, cw, ch, PANEL);
    drawPixelBorder(P.ctx, sx, sy, cw, ch, s.accent ? GOLD : "#3d4654");
    P.text(s.value, sx + cw / 2 + 2, sy + 60, fMono(40), s.accent ? GOLD : CREAM, "center");
    P.text(s.label, sx + cw / 2, sy + 90, fMono(15, "normal"), GREY, "center");
  });

  // rows table
  const rows = (req.rows ?? []).slice(0, 8);
  const ty = 420;
  const headH = 40;
  const rowH = 78;
  const tx = 24;
  const tw = w - 48;
  P.ctx.fillStyle = "rgba(77,214,255,0.10)";
  P.ctx.fillRect(tx, ty, tw, headH);
  P.text("PICK", tx + 24, ty + 27, fMono(17), CYAN);
  P.text("ODDS", tx + 700, ty + 27, fMono(17), CYAN, "right");
  P.text("RESULT", tx + tw - 24, ty + 27, fMono(17), CYAN, "right");
  rows.forEach((r, i) => {
    const ry = ty + headH + i * rowH;
    if (i % 2 === 1) {
      P.ctx.fillStyle = "rgba(255,255,255,0.045)";
      P.ctx.fillRect(tx, ry, tw, rowH);
    }
    P.text(P.fit(r.label, 560, fSans(21)), tx + 24, ry + 48, fSans(21), CREAM);
    P.text(r.value, tx + 700, ry + 48, fMono(20), GOLD, "right");
    statusChip(P, tx + tw - 110, ry + 39, r.status ?? "INFO");
  });
  drawPixelBorder(P.ctx, tx, ty, tw, headH + rows.length * rowH, CYAN);

  // summary line
  const wins = rows.filter((r) => r.status === "WIN").length;
  const losses = rows.filter((r) => r.status === "LOSS").length;
  const pend = rows.filter((r) => r.status === "PENDING").length;
  const sumY = ty + headH + rows.length * rowH + 46;
  P.text(`PICKS ${rows.length} - WIN ${wins} - LOSS ${losses} - PENDING ${pend}`, w / 2, sumY, fMono(22), GOLD, "center");

  // deco sprites
  P.ctx.globalAlpha = 0.9;
  drawSprite(P.ctx, SPRITES.TROPHY, 130, sumY + 40, 6);
  drawSprite(P.ctx, SPRITES.TV, 850, sumY + 44, 6);
  drawSprite(P.ctx, SPRITES.STAR, 520, sumY + 56, 3);
  P.ctx.globalAlpha = 1;
}

// ─── WEEKLY ─────────────────────────────────────────────────────────────────

function drawWeekly(P: Painter, req: PosterRequest): void {
  const { w } = P;
  if (req.subtitle) P.text(req.subtitle, w / 2, 108, fMono(21), CYAN, "center");

  // 4 stat chips
  const stats = (req.stats ?? []).filter((s) => !s.label.startsWith("DAY:")).slice(0, 4);
  const cw = 246;
  const gap = (w - 48 - stats.length * cw) / Math.max(1, stats.length - 1);
  stats.forEach((s, i) => {
    const sx = 24 + i * (cw + gap);
    P.panel(sx, 130, cw, 100, PANEL);
    drawPixelBorder(P.ctx, sx, 130, cw, 100, s.accent ? GOLD : "#3d4654");
    P.text(s.value, sx + cw / 2 + 2, 182, fMono(34), s.accent ? GOLD : CREAM, "center");
    P.text(s.label, sx + cw / 2, 210, fMono(14, "normal"), GREY, "center");
  });

  // pixel bar chart from DAY: stats
  const dayStats = (req.stats ?? []).filter((s) => s.label.startsWith("DAY:")).slice(0, 7);
  const cx0 = 24;
  const cw2 = w - 48;
  const cy0 = 264;
  const ch2 = 404;
  P.panel(cx0, cy0, cw2, ch2, PANEL);
  drawPixelBorder(P.ctx, cx0, cy0, cw2, ch2, CYAN);
  P.text("DAILY NET UNITS", cx0 + 34, cy0 + 44, fMono(22), GOLD);

  const baseline = cy0 + 300;
  const maxUp = 190;
  const maxDown = 90;
  let maxAbs = 1;
  const vals = dayStats.map((s) => {
    const v = parseFloat(s.value.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(v) ? v : 0;
  });
  for (const v of vals) maxAbs = Math.max(maxAbs, Math.abs(v));
  const ppu = Math.min(maxUp / maxAbs, maxDown / maxAbs);

  // gridlines
  P.ctx.fillStyle = "rgba(255,255,255,0.10)";
  P.ctx.fillRect(cx0 + 24, baseline, cw2 - 48, 2);
  P.ctx.fillStyle = "rgba(255,255,255,0.06)";
  P.ctx.fillRect(cx0 + 24, baseline - 100 * ppu, cw2 - 48, 1);
  P.ctx.fillRect(cx0 + 24, baseline + 100 * ppu, cw2 - 48, 1);

  const slot = (cw2 - 48) / Math.max(1, vals.length);
  vals.forEach((v, i) => {
    const bx = cx0 + 24 + i * slot + slot / 2 - 32;
    const hgt = Math.abs(v) * ppu;
    const col = v >= 0 ? GREEN : RED;
    if (v >= 0) {
      P.ctx.fillStyle = col;
      P.ctx.fillRect(bx, baseline - hgt, 64, hgt);
      P.ctx.fillStyle = "rgba(255,255,255,0.30)";
      P.ctx.fillRect(bx, baseline - hgt, 64, 4);
      P.text((v >= 0 ? "+" : "") + v.toFixed(1), bx + 32, baseline - hgt - 10, fMono(16), v >= 0 ? GREEN : RED, "center");
    } else {
      P.ctx.fillStyle = col;
      P.ctx.fillRect(bx, baseline, 64, hgt);
      P.ctx.fillStyle = "rgba(0,0,0,0.4)";
      P.ctx.fillRect(bx, baseline + hgt - 4, 64, 4);
      P.text(v.toFixed(1), bx + 32, baseline + hgt + 22, fMono(16), RED, "center");
    }
    const day = P.l(dayStats[i].label.replace("DAY:", "").trim());
    P.text(day, bx + 32, baseline + (v >= 0 ? 34 : 52), fMono(15, "normal"), GREY, "center");
  });

  // rows table
  const rows = (req.rows ?? []).slice(0, 7);
  const ty = cy0 + ch2 + 26;
  const headH = 38;
  const rowH = 62;
  P.ctx.fillStyle = "rgba(255,209,102,0.10)";
  P.ctx.fillRect(cx0, ty, cw2, headH);
  P.text("DAY", cx0 + 24, ty + 26, fMono(16), GOLD);
  P.text("ACTIVITY", cx0 + 150, ty + 26, fMono(16), GOLD);
  P.text("NET", cx0 + 760, ty + 26, fMono(16), GOLD, "right");
  P.text("STATUS", cx0 + cw2 - 24, ty + 26, fMono(16), GOLD, "right");
  rows.forEach((r, i) => {
    const ry = ty + headH + i * rowH;
    if (i % 2 === 1) {
      P.ctx.fillStyle = "rgba(255,255,255,0.045)";
      P.ctx.fillRect(cx0, ry, cw2, rowH);
    }
    P.text(P.fit(r.label, 480, fSans(19)), cx0 + 24, ry + 40, fSans(19), CREAM);
    P.text(r.value, cx0 + 760, ry + 40, fMono(18), GOLD, "right");
    statusChip(P, cx0 + cw2 - 118, ry + 31, r.status ?? "INFO");
  });
  drawPixelBorder(P.ctx, cx0, ty, cw2, headH + rows.length * rowH, GOLD);
}

// ─── FTRESULTS ──────────────────────────────────────────────────────────────

function drawFtResults(P: Painter, req: PosterRequest): void {
  const { w } = P;
  if (req.subtitle) P.text(req.subtitle, w / 2, 108, fMono(21), CYAN, "center");

  // hero win-rate chip
  const hero = (req.stats ?? []).find((s) => s.accent) ?? (req.stats ?? [])[0];
  if (hero) {
    const hw = 560;
    const hx = w / 2 - hw / 2;
    P.panel(hx, 130, hw, 170, PANEL);
    drawPixelBorder(P.ctx, hx, 130, hw, 170, GOLD);
    drawSprite(P.ctx, SPRITES.TROPHY, hx + 40, 170, 5);
    P.text(hero.label, w / 2 + 30, 190, fMono(20), GREY, "center");
    P.text(hero.value, w / 2 + 30, 268, fMono(72), GOLD, "center");
  }

  // other stats
  const others = (req.stats ?? []).filter((s) => s !== hero).slice(0, 3);
  const cw = 330;
  const gap = (w - 48 - others.length * cw) / Math.max(1, others.length - 1);
  others.forEach((s, i) => {
    const sx = 24 + i * (cw + gap);
    P.panel(sx, 330, cw, 104, PANEL);
    drawPixelBorder(P.ctx, sx, 330, cw, 104, "#3d4654");
    P.text(s.value, sx + cw / 2 + 2, 388, fMono(36), CREAM, "center");
    P.text(s.label, sx + cw / 2, 414, fMono(14, "normal"), GREY, "center");
  });

  // rows
  const rows = (req.rows ?? []).slice(0, 8);
  const ty = 470;
  const headH = 44;
  const rowH = 84;
  const tx = 24;
  const tw = w - 48;
  P.ctx.fillStyle = "rgba(66,226,130,0.10)";
  P.ctx.fillRect(tx, ty, tw, headH);
  P.text("MATCH", tx + 250, ty + 29, fMono(18), GREEN);
  P.text("SCORE / ODDS", tx + tw - 260, ty + 29, fMono(18), GREEN, "right");
  P.text("FT", tx + tw - 24, ty + 29, fMono(18), GREEN, "right");
  let trophyGiven = false;
  rows.forEach((r, i) => {
    const ry = ty + headH + i * rowH;
    if (i % 2 === 1) {
      P.ctx.fillStyle = "rgba(255,255,255,0.045)";
      P.ctx.fillRect(tx, ry, tw, rowH);
    }
    statusChip(P, tx + 120, ry + 42, r.status ?? "INFO", true);
    if (r.status === "WIN" && !trophyGiven) {
      drawSprite(P.ctx, SPRITES.TROPHY, tx + 214, ry + 20, 3);
      trophyGiven = true;
    }
    P.text(P.fit(r.label, 560, fSans(21)), tx + 250, ry + 52, fSans(21), CREAM);
    P.text(r.value, tx + tw - 260, ry + 52, fMono(20), GOLD, "right");
  });
  drawPixelBorder(P.ctx, tx, ty, tw, headH + rows.length * rowH, GREEN);

  // summary
  const wins = rows.filter((r) => r.status === "WIN").length;
  const losses = rows.filter((r) => r.status === "LOSS").length;
  const net = (req.stats ?? []).find((s) => s.label.includes("NET"))?.value ?? "";
  const sumY = ty + headH + rows.length * rowH + 50;
  P.text(`SETTLED ${rows.length} - WIN ${wins} - LOSS ${losses}${net ? ` - NET ${net}` : ""}`, w / 2, sumY, fMono(22), GOLD, "center");
  P.ctx.globalAlpha = 0.9;
  drawSprite(P.ctx, SPRITES.WHISTLE, 150, sumY + 30, 5);
  drawSprite(P.ctx, SPRITES.BALL, 880, sumY + 26, 5);
  P.ctx.globalAlpha = 1;
}

// ─── NEWS ───────────────────────────────────────────────────────────────────

function drawNews(P: Painter, req: PosterRequest): void {
  const { w, ctx } = P;
  const nw = req.news;
  if (!nw) return;

  // LIVE TENNIS tag
  P.ctx.fillStyle = "rgba(255,93,93,0.18)";
  P.ctx.fillRect(24, 100, 240, 56);
  drawPixelBorder(P.ctx, 24, 100, 240, 56, RED);
  P.text("LIVE", 74, 137, fMono(26), CREAM, "center");
  P.text("TENNIS", 170, 137, fMono(26), RED, "center");
  if (nw.tag) {
    P.chip(nw.tag, 284, 110, { font: fMono(19), fg: GOLD, border: GOLD, bg: "rgba(255,209,102,0.08)", h: 38, padX: 14 });
  }

  // headline
  const headBottom = P.wrapped(nw.headline, 24, 214, w - 48, fSans(50), CREAM, 60, 3);

  // description
  const descY = headBottom + 44;
  const descBottom = P.wrapped(nw.description, 24, descY, w - 48, fMono(21, "normal"), GREY, 33, 5);

  // source chip + date
  const srcY = descBottom + 34;
  P.chip(`SOURCE: ${nw.source}`, 24, srcY, { font: fMono(18), fg: GOLD, border: GOLD, bg: "rgba(255,209,102,0.08)", h: 38 });
  if (nw.published) {
    P.text(nw.published, w - 24, srcY + 27, fMono(18, "normal"), GREY, "right");
  }

  // ── LIVE SCOREBOARD panel ────────────────────────────────────────────────
  const liveRows = (nw.live ?? []).slice(0, 4);
  const sbY = srcY + 96;
  const rowH = 46;
  const sbH = 78 + Math.max(1, liveRows.length) * rowH;
  P.panel(24, sbY, w - 48, sbH, PANEL);
  drawPixelBorder(P.ctx, 24, sbY, w - 48, sbH, CYAN);
  P.text("LIVE SCOREBOARD", 64, sbY + 42, fMono(21), CYAN);
  drawSprite(ctx, SPRITES.PULSE, w - 130, sbY + 22, 4);
  if (liveRows.length === 0) {
    P.text("NO MATCHES ON COURT RIGHT NOW - WATCH FOR UPDATES", 64, sbY + 86, fMono(19, "normal"), GREY);
  }
  liveRows.forEach((r, i) => {
    const ry = sbY + 78 + i * rowH;
    const lamp = r.state === "LIVE" ? RED : r.state === "UPCOMING" ? GOLD : GREEN;
    P.ctx.fillStyle = lamp;
    P.ctx.fillRect(52, ry - 13, 12, 12);
    if (r.state === "LIVE") {
      P.ctx.fillStyle = "rgba(255,93,93,0.35)";
      P.ctx.fillRect(48, ry - 17, 20, 20);
    }
    P.text(P.fit(r.label, 560, fMono(20, "normal")), 78, ry, fMono(20, "normal"), CREAM);
    P.text(P.fit(r.value, 380, fMono(20, "normal")), w - 60, ry, fMono(20), lamp, "right");
    if (i < liveRows.length - 1) {
      P.ctx.fillStyle = "rgba(255,255,255,0.06)";
      P.ctx.fillRect(52, ry + 16, w - 110, 2);
    }
  });

  // ── FITNESS WATCH panel ──────────────────────────────────────────────────
  const fitRows = (nw.fitness ?? []).slice(0, 3);
  const fwY = sbY + sbH + 34;
  const fRowH = 44;
  const fwH = 74 + Math.max(1, fitRows.length) * fRowH;
  P.panel(24, fwY, w - 48, fwH, PANEL);
  drawPixelBorder(P.ctx, 24, fwY, w - 48, fwH, RED);
  P.text("FITNESS WATCH", 112, fwY + 42, fMono(21), RED);
  drawSprite(ctx, SPRITES.MEDKIT, 54, fwY + 20, 4);
  if (fitRows.length === 0) {
    P.text("NO FITNESS ALERTS IN THE CURRENT NEWS CYCLE", 104, fwY + 84, fMono(19, "normal"), GREY);
  }
  fitRows.forEach((r, i) => {
    const ry = fwY + 84 + i * fRowH;
    P.text(P.fit(r.label, 640, fMono(20, "normal")), 104, ry, fMono(20, "normal"), CREAM);
    P.chipRight(r.tag, w - 60, ry - 22, { font: fMono(15), fg: GOLD, border: "#3d4654", bg: "rgba(255,209,102,0.07)", h: 30, padX: 10 });
  });

  // tennis art zone (tennis symbols per director spec)
  const artY = fwY + fwH + 40;
  const artRoom = P.h - artY - 150;
  if (artRoom > 110) {
    P.ctx.globalAlpha = 0.5;
    drawSprite(ctx, SPRITES.RACKET, 120, artY, 9);
    P.ctx.globalAlpha = 0.9;
    drawSprite(ctx, SPRITES.BALL, w / 2 - 64, artY + 24, 8);
    drawSprite(ctx, SPRITES.TV, w - 320, artY + 8, 6);
    P.ctx.globalAlpha = 0.95;
    drawSprite(ctx, SPRITES.STAR, 60, artY + 80, 3);
    drawSprite(ctx, SPRITES.STAR, w - 90, artY + 110, 2);
  }
  P.ctx.globalAlpha = 1;
}

// ─── ACADEMY ────────────────────────────────────────────────────────────────

function drawAcademy(P: Painter, req: PosterRequest): void {
  const { w, ctx } = P;
  const ls = req.lesson;
  if (!ls) return;

  // corner sprites
  drawSprite(ctx, SPRITES.MORTARBORD, 56, 84, 6);
  drawSprite(ctx, SPRITES.BOOK, w - 128, 80, 6);

  // lesson chip
  P.chipCentered(`LESSON ${ls.index}/14`, w / 2, 96, {
    font: fMono(20),
    fg: CYAN,
    border: CYAN,
    bg: "rgba(77,214,255,0.08)",
    h: 40,
    padX: 18,
  });

  // term HUGE
  let size = 64;
  let font = fMono(size);
  while (P.measure(latinize(ls.term), font) > w - 220 && size > 40) {
    size -= 4;
    font = fMono(size);
  }
  const ctx2 = P.ctx;
  ctx2.font = font;
  const termLines = wrapText(ctx2, latinize(ls.term), w - 220, font);
  let termY = 216;
  for (const line of termLines) {
    P.l(line); // count (term already counted? ensure once)
    ctx2.fillStyle = "rgba(255,93,93,0.6)";
    ctx2.textAlign = "center";
    ctx2.fillText(line, w / 2 + 4, termY + 4);
    ctx2.fillStyle = GOLD;
    ctx2.fillText(line, w / 2, termY);
    ctx2.textAlign = "left";
    termY += size + 10;
  }

  // phonetic
  let y = termY + 8;
  if (ls.phonetic) {
    P.text(ls.phonetic, w / 2, y, fMono(24, "normal"), CREAM, "center");
    y += 46;
  }

  // category chip
  P.chipCentered(ls.category, w / 2, y - 8, {
    font: fMono(17),
    fg: GREY,
    border: "#3d4654",
    bg: "rgba(61,70,84,0.30)",
    h: 34,
  });

  // definition
  const defY = y + 74;
  drawSectionLabel(P, 74, defY, "DEFINITION", GOLD);
  const defBottom = P.wrapped(ls.definition, 60, defY + 46, w - 120, fSans(25, "normal"), CREAM, 38, 4);

  // arena example box
  const exY = defBottom + 44;
  const exH = 300;
  P.panel(24, exY, w - 48, exH, PANEL);
  drawPixelBorder(P.ctx, 24, exY, w - 48, exH, CYAN);
  P.text("ARENA EXAMPLE", 60, exY + 48, fMono(21), CYAN);
  P.wrapped(ls.example, 60, exY + 96, w - 200, fMono(23, "normal"), CREAM, 36, 4);
  P.ctx.globalAlpha = 0.9;
  drawSprite(ctx, SPRITES.JOYSTICK, w - 150, exY + exH - 130, 5);
  P.ctx.globalAlpha = 1;

  // bottom deco row
  const dY = exY + exH + 30;
  P.ctx.globalAlpha = 0.92;
  drawSprite(ctx, SPRITES.BOOK, 150, dY, 7);
  drawSprite(ctx, SPRITES.STAR, 520, dY + 14, 3);
  drawSprite(ctx, SPRITES.MORTARBORD, 790, dY, 7);
  P.ctx.globalAlpha = 1;
}

// ─── BANNER ─────────────────────────────────────────────────────────────────

function drawBanner(P: Painter, req: PosterRequest): void {
  const { w, ctx } = P;
  if (req.subtitle) P.text(req.subtitle, w / 2, 110, fMono(24), OPTIC, "center");

  // 3 huge stat boxes
  const stats = (req.stats ?? []).slice(0, 3);
  const bw = 330;
  const gap = (w - 48 - stats.length * bw) / Math.max(1, stats.length - 1);
  stats.forEach((s, i) => {
    const sx = 24 + i * (bw + gap);
    const sy = 150;
    P.panel(sx, sy, bw, 240, PANEL);
    drawPixelBorder(P.ctx, sx, sy, bw, 240, s.accent ? GOLD : "#3d4654");
    let vs = 74;
    let vfont = fMono(vs);
    while (P.measure(s.value, vfont) > bw - 60 && vs > 44) {
      vs -= 4;
      vfont = fMono(vs);
    }
    P.text(s.value, sx + bw / 2 + 3, sy + 132 + 3, vfont, "rgba(0,0,0,0.55)", "center");
    P.text(s.value, sx + bw / 2, sy + 132, vfont, s.accent ? GOLD : CREAM, "center");
    P.text(s.label, sx + bw / 2, sy + 186, fMono(16, "normal"), GREY, "center");
    drawSprite(ctx, SPRITES.STAR, sx + bw - 44, sy + 14, 2, { "#": s.accent ? GOLD : "#3d4654" });
  });

  // slot machine strip 7 7 7
  const mx = w / 2 - 300;
  const my = 428;
  P.panel(mx, my, 600, 252, "rgba(6,7,16,0.94)");
  drawPixelBorder(P.ctx, mx, my, 600, 252, GOLD, 3);
  P.text("JACKPOT", w / 2, my + 48, fMono(26), MAGENTA, "center");
  const cellY = my + 76;
  const cellW = 150;
  const cellH = 132;
  const cells = [mx + 46, mx + 225, mx + 404];
  cells.forEach((cxx, i) => {
    const hot = i === 1;
    P.ctx.fillStyle = hot ? "rgba(255,209,102,0.14)" : "#10131f";
    P.ctx.fillRect(cxx, cellY, cellW, cellH);
    P.ctx.fillStyle = hot ? OPTIC : "#5a6878";
    P.ctx.fillRect(cxx, cellY, cellW, 3);
    P.ctx.fillRect(cxx, cellY + cellH - 3, cellW, 3);
    P.ctx.fillRect(cxx, cellY, 3, cellH);
    P.ctx.fillRect(cxx + cellW - 3, cellY, 3, cellH);
    P.text("7", cxx + cellW / 2, cellY + 100, fMono(84), hot ? OPTIC : GOLD, "center");
  });

  // press start + CTA button
  P.text("PRESS START", w / 2, 764, fMono(26), OPTIC, "center");
  P.text("_", w / 2 + 160, 764, fMono(26), "rgba(223,255,79,0.5)", "center");
  const bx = w / 2 - 250;
  const by = 792;
  const bwid = 500;
  const bh = 100;
  P.ctx.fillStyle = "rgba(66,226,130,0.15)";
  P.ctx.fillRect(bx, by, bwid, bh);
  drawPixelBorder(P.ctx, bx, by, bwid, bh, GREEN, 3);
  P.text("JOIN @aineobet", w / 2 + 3, by + 64 + 3, fMono(42), "rgba(0,0,0,0.6)", "center");
  P.text("JOIN @aineobet", w / 2, by + 64, fMono(42), GREEN, "center");

  // foreground coin fountain
  for (let i = 0; i < 7; i++) {
    const cx2 = w / 2 + (i - 3) * 92;
    const cy2 = 966 + Math.pow(i - 3, 2) * 12;
    P.ctx.globalAlpha = 0.9;
    drawSprite(ctx, SPRITES.COIN, cx2 - 24, cy2, 4);
  }
  P.ctx.globalAlpha = 1;

  // deco row
  const dY = 1148;
  P.ctx.globalAlpha = 0.94;
  drawSprite(ctx, SPRITES.JOYSTICK, 110, dY, 8);
  drawSprite(ctx, SPRITES.TROPHY, 480, dY - 10, 8);
  drawSprite(ctx, SPRITES.TV, 830, dY + 10, 8);
  P.ctx.globalAlpha = 1;
}

// ─── DAILYPROGRAM — professional daily broadcast timetable ─────────────────

const CHANNEL_COLOR: Record<string, string> = {
  PUBLIC: GREEN,
  VIP: GOLD,
  BOTH: CYAN,
};

function drawChannelChip(P: Painter, cx: number, cy: number, channel: string): number {
  const color = CHANNEL_COLOR[channel] ?? GREY;
  const font = fMono(18);
  P.ctx.font = font;
  const tw = P.ctx.measureText(channel).width;
  const w = Math.ceil(tw) + 24;
  const h = 40;
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);
  P.ctx.fillStyle = `${color}22`;
  P.ctx.fillRect(x, y, w, h);
  P.ctx.fillStyle = color;
  P.ctx.fillRect(x, y, w, 2);
  P.ctx.fillRect(x, y + h - 2, w, 2);
  P.ctx.fillRect(x, y, 2, h);
  P.ctx.fillRect(x + w - 2, y, 2, h);
  P.ctx.fillStyle = color;
  P.ctx.textAlign = "center";
  P.ctx.textBaseline = "middle";
  P.ctx.fillText(latinize(channel), cx, cy + 1);
  P.ctx.textBaseline = "alphabetic";
  return w;
}

function drawDailyProgram(P: Painter, req: PosterRequest): void {
  const { w } = P;
  if (req.subtitle) P.text(req.subtitle, w / 2, 108, fMono(21), CYAN, "center");

  const rows = (req.rows ?? []).slice(0, 13);

  // ── timetable ──────────────────────────────────────────────────────────
  const ty = 152;
  const headH = 54;
  const rowH = 74;
  const tx = 24;
  const tw = w - 48;
  P.ctx.fillStyle = "rgba(77,214,255,0.10)";
  P.ctx.fillRect(tx, ty, tw, headH);
  P.text("TIME", tx + 16, ty + 35, fMono(19), CYAN);
  P.text("PROGRAM", tx + 148, ty + 35, fMono(19), CYAN);
  P.text("CHANNEL", tx + tw - 16, ty + 35, fMono(19), CYAN, "right");

  rows.forEach((r, i) => {
    const ry = ty + headH + i * rowH;
    if (i % 2 === 1) {
      P.ctx.fillStyle = "rgba(255,255,255,0.045)";
      P.ctx.fillRect(tx, ry, tw, rowH);
    }
    // time column — the time token is the part before the first "·"
    const sep = r.label.indexOf("·");
    const time = sep > 0 ? r.label.slice(0, sep).trim() : "";
    const name = sep > 0 ? r.label.slice(sep + 1).trim() : r.label;
    P.text(P.fit(time, 110, fMono(22)), tx + 16, ry + 46, fMono(22), GOLD);
    P.text(P.fit(name, 620, fSans(22)), tx + 148, ry + 46, fSans(22), CREAM);
    drawChannelChip(P, tx + tw - 96, ry + rowH / 2, r.value);
    if (i < rows.length - 1) {
      P.ctx.fillStyle = "rgba(255,255,255,0.06)";
      P.ctx.fillRect(tx + 16, ry + rowH - 1, tw - 32, 2);
    }
  });
  drawPixelBorder(P.ctx, tx, ty, tw, headH + rows.length * rowH, CYAN);

  // ── discipline strip ───────────────────────────────────────────────────
  const sumY = ty + headH + rows.length * rowH + 54;
  P.text("ALL TIMES TEHRAN (UTC+03:30) - POSTERS EN / CAPTIONS FA", w / 2, sumY, fMono(20), GREY, "center");
  P.text("ONE CARD PER MATCH PER DAY - STANDARD STAKE 100U", w / 2, sumY + 44, fMono(22), GOLD, "center");
  P.ctx.globalAlpha = 0.9;
  drawSprite(P.ctx, SPRITES.BELL, 150, sumY + 26, 5);
  drawSprite(P.ctx, SPRITES.BALL, 880, sumY + 22, 5);
  P.ctx.globalAlpha = 1;
}

// ─── sample data (realistic mocks per kind) ─────────────────────────────────

export function samplePoster(kind: PosterKind): PosterRequest {
  switch (kind) {
    case "FLASHCARD":
      return {
        kind,
        title: "MATCH OF THE DAY",
        subtitle: "VIP CARD 01",
        theme: "HARD",
        tournament: "US OPEN 2025",
        round: "QUARTERFINAL",
        surfaceLabel: "HARD COURT - OUTDOOR",
        players: {
          a: "NOVAK DJOKOVIC",
          b: "CARLOS ALCARAZ",
          shortA: "DJOKOVIC",
          shortB: "ALCARAZ",
          rankA: 7,
          rankB: 2,
          flagA: "SRB",
          flagB: "ESP",
        },
        slips: [
          {
            key: "SB-F20",
            label: "TYPE A",
            marketEn: "SET BETTING - FAVORITE 2-0",
            detail: "ALCARAZ TO WIN THE MATCH BY EXACTLY 2 SETS TO 0. VALID FOR FULL MATCH ONLY. VOID IF RETIRED.",
            odds: 1.97,
            prob: 0.51,
            stake: 57.6,
            edge: 0.005,
          },
          {
            key: "TS-O25",
            label: "TYPE B",
            marketEn: "TOTAL GAMES OVER 22.5",
            detail: "MATCH TOTAL GAMES TO FINISH OVER 22.5. TIE-BREAKS IN EITHER SET PUSH THIS PICK GREEN FAST.",
            odds: 2.68,
            prob: 0.38,
            stake: 42.4,
            edge: 0.018,
          },
        ],
        intel: {
          tour: "ATP",
          city: "NEW YORK",
          timing: "T-30M PRE-WARMUP",
          favName: "CARLOS ALCARAZ",
          favProb: 0.62,
          coverage: 0.92,
          archLabel: "DUAL-ENGINE",
          favSide: "B",
          angleLabel: "FULL CARD",
          insightEn:
            "DUAL-WING STRUCTURE ONLINE - TYPE A + TYPE B TOGETHER COVER 92% OF ALL POSSIBLE SCORE ROUTES.",
          prediction: "PREDICTION: CARLOS ALCARAZ 2-0",
          rankGap: "RANK GAP #7 v #2",
          totalStake: "TOTAL RISK 100U",
          stakeDetail: "TIP A 57.6U + TIP B 42.4U",
        },
        timeLabel: "T-30M PRE-WARMUP",
        hash: "A1B2C3D4E5",
        stage: "ST 01-07",
        footerNote: "VIP ONLY - NOT FOR RESHARE - 18+",
      };
    case "FREECARD":
      return {
        kind,
        title: "FREE CARD",
        subtitle: "PUBLIC GIFT PICK",
        theme: "CLAY",
        tournament: "ROLAND GARROS 2025",
        round: "ROUND OF 16",
        surfaceLabel: "CLAY COURT - OUTDOOR",
        players: {
          a: "ARYNA SABALENKA",
          b: "IGA SWIATEK",
          shortA: "SABALENKA",
          shortB: "SWIATEK",
          rankA: 1,
          rankB: 2,
          flagA: "BLR",
          flagB: "POL",
        },
        slips: [
          {
            key: "SB-F18",
            label: "TYPE A",
            marketEn: "MATCH WINNER - SABALENKA",
            detail: "SABALENKA TO WIN THE MATCH IN STRAIGHT OR THREE SETS. VALID FOR FULL MATCH ONLY.",
            odds: 1.85,
            prob: 0.55,
            stake: 64.8,
            edge: 0.017,
          },
          {
            key: "TS-U35",
            label: "TYPE B",
            marketEn: "CORRECT SCORE 2-1",
            detail: "FULL DETAIL UNLOCKED INSIDE VIP ARENA WITH THE COMPLETE 3-PICK CARD.",
            odds: 3.4,
            prob: 0.30,
            locked: true,
          },
        ],
        intel: {
          tour: "WTA",
          city: "PARIS",
          timing: "T-45M PRE-WARMUP",
          favName: "ARYNA SABALENKA",
          favProb: 0.58,
          coverage: 0.88,
          archLabel: "DUAL-ENGINE",
          favSide: "A",
          angleLabel: "FREE CARD",
          insightEn:
            "TYPE A IS THE FREE GIFT TODAY - FULL MARKET DETAIL ON THE POSTER, TYPE B STAYS LOCKED IN THE VIP ARENA.",
        },
        timeLabel: "T-45M PRE-WARMUP",
        hash: "F4E8D2C6B0",
        stage: "ST 02-07",
        footerNote: "FULL 3-PICK CARD INSIDE VIP ARENA",
      };
    case "BRIEFING":
      return {
        kind,
        title: "TODAY'S BATTLE ARENA",
        subtitle: "SATURDAY SLATE - WIMBLEDON DAY 6 - 14 QUALIFIED PICKS",
        theme: "GRASS",
        stage: "ST 03-07",
        rows: [
          { label: "11:30 SINNER x DE MINAUR", value: "GRASS - TN-H15 - 1.72", status: "INFO" },
          { label: "13:00 ALCARAZ x NORRIE", value: "GRASS - TN-O22 - 1.66", status: "INFO" },
          { label: "14:30 DJOKOVIC x KORDA", value: "GRASS - TN-H15 - 1.85", status: "INFO" },
          { label: "16:00 ZVEREV x FRITZ", value: "GRASS - TS-O25 - 2.10", status: "INFO" },
          { label: "17:30 MEDVEDDEV x DIMITROV", value: "GRASS - TN-U21 - 1.95", status: "INFO" },
          { label: "19:00 REAL MADRID x SEVILLA", value: "FOOT - AH-1 - 1.80", status: "INFO" },
          { label: "20:15 ARSENAL x CHELSEA", value: "FOOT - OU3 - 1.90", status: "INFO" },
          { label: "21:30 INTER x NAPOLI", value: "FOOT - BTTS - 1.75", status: "INFO" },
          { label: "12:00 TSITSIPAS x MOUTER", value: "WIND RISK", status: "VETO" },
          { label: "18:45 RUBLEV x BASAVAREDS", value: "ODDS CRASH -0.25", status: "VETO" },
          { label: "21:00 PALMEIRAS x FLAMENGO", value: "LINE UNCLEAR", status: "VETO" },
        ],
        bullets: [
          "MAX 2 UNITS PER PICK - NEVER CHASE A LOSS",
          "FLAT STAKES ONLY - NO PARLAY TODAY",
          "LINE LOCKED AT T-30M - NO LATE MOVES",
          "SKIP ANY MATCH IF ODDS DROP BELOW 1.60",
        ],
        stats: [
          { label: "APPROVED", value: "11", accent: true },
          { label: "VETOED", value: "3" },
          { label: "QUOTA", value: "12 MAX" },
          { label: "BANK RISK", value: "2.0U" },
        ],
        hash: "B7C4D9E2F1",
        footerNote: "FULL CARD IN VIP - 18+ - FLAT STAKES",
      };
    case "AGGREGATE":
      return {
        kind,
        title: "DAILY LEDGER",
        subtitle: "FRIDAY - ALL MARKETS SETTLED",
        theme: "RESULTS",
        stage: "ST 04-07",
        stats: [
          { label: "WIN RATE", value: "73%", accent: true },
          { label: "NET UNITS", value: "+9.75U", accent: true },
          { label: "PICKS", value: "11" },
          { label: "STREAK", value: "W4" },
          { label: "BEST DAY", value: "+4.2U" },
          { label: "ROI", value: "+14.3%" },
        ],
        rows: [
          { label: "SINNER ML - GRASS", value: "1.72", status: "WIN" },
          { label: "ALCARAZ -1.5 SETS", value: "2.05", status: "WIN" },
          { label: "ZVEREV OVER 22.5 GAMES", value: "1.95", status: "LOSS" },
          { label: "REAL MADRID AH -0.75", value: "1.80", status: "WIN" },
          { label: "ARSENAL BTTS YES", value: "1.85", status: "LOSS" },
          { label: "INTER ML", value: "1.75", status: "WIN" },
          { label: "MEDVEDDEV OVER 21.5", value: "2.10", status: "PENDING" },
          { label: "DJOKOVIC ML", value: "1.85", status: "WIN" },
        ],
        hash: "C2D8E4F6A9",
        footerNote: "LEDGER POSTED DAILY 23:30 TEHRAN",
      };
    case "WEEKLY":
      return {
        kind,
        title: "WEEKLY REPORT",
        subtitle: "JUL 28 - AUG 03 - ALL SPORTS",
        theme: "RESULTS",
        stage: "ST 05-07",
        stats: [
          { label: "WIN RATE", value: "68%", accent: true },
          { label: "NET UNITS", value: "+38.5U", accent: true },
          { label: "PICKS", value: "71" },
          { label: "ROI", value: "+11.2%" },
          { label: "DAY: MON", value: "+6.5" },
          { label: "DAY: TUE", value: "-2.0" },
          { label: "DAY: WED", value: "+9.0" },
          { label: "DAY: THU", value: "+3.5" },
          { label: "DAY: FRI", value: "-1.5" },
          { label: "DAY: SAT", value: "+12.0" },
          { label: "DAY: SUN", value: "+11.0" },
        ],
        rows: [
          { label: "MON - 9 PICKS TENNIS ONLY", value: "+6.5U", status: "WIN" },
          { label: "TUE - 8 PICKS TENNIS ONLY", value: "-2.0U", status: "LOSS" },
          { label: "WED - 11 PICKS TENNIS ONLY", value: "+9.0U", status: "WIN" },
          { label: "THU - 10 PICKS TENNIS ONLY", value: "+3.5U", status: "WIN" },
          { label: "FRI - 12 PICKS TENNIS ONLY", value: "-1.5U", status: "LOSS" },
          { label: "SAT - 11 PICKS TENNIS ONLY", value: "+12.0U", status: "WIN" },
          { label: "SUN - 10 PICKS TENNIS ONLY", value: "+11.0U", status: "WIN" },
        ],
        hash: "D9A0B3C5E7",
        footerNote: "FULL HISTORY IN VIP PINNED POST",
      };
    case "NEWS":
      return {
        kind,
        title: "TENNIS NEWSWIRE",
        subtitle: "LIVE DESK - FITNESS RADAR",
        theme: "LIVE",
        stage: "ST 06-07",
        news: {
          tag: "ATP",
          headline: "SINNER OVERRUNS ZVEREV TO CLINCH A SPOT IN THE ATP FINALS SHOWDOWN",
          description:
            "JANNIK SINNER CLOSED THE ROUND-ROBIN STAGE WITH A STRAIGHT-SETS WIN OVER ALEXANDER ZVEREV, 6-4 6-3. THE SERVE HELD AT 78% FIRST-SERVE POINTS AND THE RETURN GAME BROKE THREE TIMES. ZVEREV MUST NOW WAIT FOR THE SECOND COURT TO DECIDE HIS SEMIFINAL FAITH.",
          source: "ESPN",
          published: "NOV 12 2026 - 21:42",
          live: [
            { label: "ALCARAZ v RUNE - ATP FINALS", value: "6-3 4-6 3-2 - SET 3", state: "LIVE" },
            { label: "SINNER v ZVEREV - ATP FINALS", value: "6-4 6-3 - FINAL", state: "FINAL" },
            { label: "SWIATEK v GAAF - WTA FINALS", value: "SCHEDULED 19:30", state: "UPCOMING" },
          ],
          fitness: [
            { label: "ALCARAZ PASSES FITNESS TEST ON ANKLE AHEAD OF SEMIFINAL", tag: "FITNESS" },
            { label: "MEDVEDEV WITHDRAWS FROM STOCKHOLM OPEN WITH SHOULDER STRAIN", tag: "WITHDRAWAL" },
          ],
        },
        footerNote: "MORE AT ESPN.COM/TENNIS",
      };
    case "ACADEMY":
      return {
        kind,
        title: "BET ACADEMY",
        subtitle: "TERMINOLOGY SCHOOL",
        theme: "ACADEMY",
        stage: "ST 07-07",
        lesson: {
          index: 1,
          term: "ASIAN HANDICAP",
          phonetic: "/ey-zhun han-di-kap/",
          category: "MARKET TYPE",
          definition:
            "A FOOTBALL SPREAD MARKET THAT REMOVES THE DRAW. YOUR STAKE IS SPLIT BETWEEN TWO HANDICAP LINES AND REFUNDS ARE POSSIBLE ON EXACT LANDINGS.",
          example: "HOME -0.75: HALF THE STAKE WINS IF THE HOME SIDE WINS BY 1, FULL STAKE WINS BY 2 OR MORE.",
        },
        footerNote: "NEW LESSON DAILY - 14 LESSON SERIES",
      };
    case "BANNER":
      return {
        kind,
        title: "VIP ARCADE ARENA",
        subtitle: "INSERT COIN - JOIN THE WINNING SIDE",
        theme: "MARKETING",
        stage: "ST 08-08",
        stats: [
          { label: "WIN RATE - 30 DAYS", value: "87%", accent: true },
          { label: "NET UNITS - 30 DAYS", value: "+412U", accent: true },
          { label: "ACTIVE MEMBERS", value: "1,240" },
        ],
        footerNote: "JOIN @aineobet - RESPONSIBLE GAMBLING - 18+",
      };
    case "FTRESULTS":
      return {
        kind,
        title: "FULL TIME RESULTS",
        subtitle: "SATURDAY NIGHT CARD - ALL SETTLED",
        theme: "RESULTS",
        stage: "ST 09-09",
        stats: [
          { label: "WIN RATE", value: "75%", accent: true },
          { label: "SETTLED", value: "8" },
          { label: "NET UNITS", value: "+7.4U", accent: true },
          { label: "DAY GRADE", value: "A" },
        ],
        rows: [
          { label: "SINNER ML - SETTLED 2-0", value: "1.72", status: "WIN" },
          { label: "ALCARAZ -1.5 SETS - 2-1", value: "2.05", status: "WIN" },
          { label: "REAL MADRID AH -0.75 - 3-1", value: "1.80", status: "WIN" },
          { label: "ZVEREV OVER 22.5 - 6-7 6-4", value: "1.95", status: "LOSS" },
          { label: "ARSENAL BTTS - 2-1", value: "1.85", status: "LOSS" },
          { label: "INTER ML - 1-0", value: "1.75", status: "WIN" },
          { label: "DJOKOVIC ML - 2-1", value: "1.85", status: "WIN" },
          { label: "SWIATEK ML - 2-0", value: "1.60", status: "WIN" },
        ],
        hash: "E5F1A8C3D7",
        footerNote: "TOMORROW CARD DROPS 10:00 TEHRAN",
      };
    case "DAILYPROGRAM":
      return {
        kind,
        title: "DAILY BROADCAST PROGRAM",
        subtitle: "SATURDAY - ALL TIMES TEHRAN",
        theme: "RESULTS",
        stage: "ST 01-01",
        rows: [
          { label: "08:30 · DAILY BROADCAST PROGRAM", value: "BOTH" },
          { label: "09:30 · TENNIS LIVE NEWS + FITNESS", value: "PUBLIC" },
          { label: "10:00 · VIP MORNING BRIEFING", value: "VIP" },
          { label: "10:30 · FREE CARD OF THE DAY", value: "PUBLIC" },
          { label: "11:30 · BET ACADEMY LESSON", value: "PUBLIC" },
          { label: ":15 · MARKETING BANNER - HOURLY", value: "PUBLIC" },
          { label: "90S · VIP FLASH CARDS - ALL DAY", value: "VIP" },
          { label: "16:30 · TENNIS LIVE NEWS + FITNESS", value: "PUBLIC" },
          { label: "18:30 · BET ACADEMY LESSON", value: "PUBLIC" },
          { label: "20:00 · FT RESULTS + WIN RATE", value: "PUBLIC" },
          { label: "21:00 · VIP DAILY AGGREGATE", value: "VIP" },
          { label: "22:00 · WEEKLY REPORT - FRIDAYS ONLY", value: "BOTH" },
          { label: "23:00 · NIGHTLY PUBLIC LEDGER", value: "PUBLIC" },
        ],
        footerNote: "ONE CARD PER MATCH PER DAY - STAKE 100U",
      };
  }
}

// ─── main renderer ──────────────────────────────────────────────────────────

export function renderPoster(req: PosterRequest): RenderResult {
  const kind = req.kind;
  const w = 1080;
  const h = kind === "BRIEFING" ? 1920 : 1440;
  try {
    registerFonts();
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const seed = hashString(`${latinize(req.title)}|${kind}|${req.seedSalt ?? 0}`);
    const rng = makeRng(seed ^ 0xf00ba11);

    const P = new Painter(ctx, w, h, rng);

    // 1. background
    drawBackground(ctx, req.theme, seed, w, h);

    // 2. kind layout
    switch (kind) {
      case "FLASHCARD":
      case "FREECARD":
        drawFlashcard(P, req);
        break;
      case "BRIEFING":
        drawBriefing(P, req);
        break;
      case "AGGREGATE":
        drawAggregate(P, req);
        break;
      case "WEEKLY":
        drawWeekly(P, req);
        break;
      case "NEWS":
        drawNews(P, req);
        break;
      case "ACADEMY":
        drawAcademy(P, req);
        break;
      case "BANNER":
        drawBanner(P, req);
        break;
      case "FTRESULTS":
        drawFtResults(P, req);
        break;
      case "DAILYPROGRAM":
        drawDailyProgram(P, req);
        break;
    }

    // 3. chrome
    drawHud(P, req);
    drawFooter(P, req, seed);

    // 4. CRT overlay last
    drawCrt(ctx, w, h, 72);

    const buf = canvas.toBuffer("image/png");
    return {
      ok: true,
      kind,
      pngBase64: Buffer.from(buf).toString("base64"),
      width: w,
      height: h,
      latinized: P.latin,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, kind, pngBase64: "", width: 0, height: 0, latinized: 0, error: msg };
  }
}
