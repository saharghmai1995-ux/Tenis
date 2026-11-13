// ─── Poster engine: pixel-art sprite library ────────────────────────────────
// Every sprite is a grid of chars; each char maps to a palette color.
// '.' = transparent. Drawn with integer fillRect calls for a crisp look.

import type { SKRSContext2D } from "@napi-rs/canvas";

export interface Sprite {
  rows: string[];
  palette: Record<string, string>;
  w: number;
  h: number;
}

function makeSprite(rows: string[], palette: Record<string, string>): Sprite {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const norm = rows.map((r) => r.padEnd(w, "."));
  return { rows: norm, palette, w, h: norm.length };
}

/** Draw a sprite at (x, y) with integer scale. `palette` overrides sprite defaults. */
export function drawSprite(
  ctx: SKRSContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  scale: number,
  palette?: Record<string, string>,
): void {
  const pal = palette ?? sprite.palette;
  const px = Math.round(x);
  const py = Math.round(y);
  const s = Math.max(1, Math.round(scale));
  for (let r = 0; r < sprite.h; r++) {
    const row = sprite.rows[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === "." || ch === " ") continue;
      const color = pal[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(px + c * s, py + r * s, s, s);
    }
  }
}

/** sprite bounding box at a given scale */
export function spriteSize(sprite: Sprite, scale: number): { w: number; h: number } {
  return { w: sprite.w * scale, h: sprite.h * scale };
}

// ─── Sprite definitions ─────────────────────────────────────────────────────

const BALL = makeSprite(
  [
    ".....##oo##.....",
    "...######oo##...",
    "..#########o##..",
    ".###########o##.",
    ".############o#.",
    "#############o#.",
    "##############o.",
    "##############o.",
    "o###############",
    "o###############",
    ".o##############",
    "..o############.",
    "...o##########..",
    "....o########...",
    ".....oo######...",
    "......#oo#......",
  ],
  { "#": "#dfff4f", o: "#fff6e8" },
);

const RACKET = makeSprite(
  [
    "....ffffffff....",
    "..ffs..s..s.ff..",
    ".ffssssssssssff.",
    "ff..s..s....ff..",
    "ffssssssssssssff",
    "ff..s..s....ff..",
    ".ffssssssssssff.",
    "..ffs..s..s.ff..",
    "....ffffffff....",
    ".......hh.......",
    ".......hh.......",
    ".......hh.......",
    ".......hh.......",
    "......gggg......",
    "......gggg......",
    "......gggg......",
  ],
  { f: "#ff5d5d", s: "#fff6e8", h: "#a56a2a", g: "#7c4f1f" },
);

const NET = makeSprite(
  [
    "ppttttttttttttpp",
    "ppttttttttttttpp",
    "pps.s.s.s.s.s.pp",
    "pp.s.s.s.s.s.spp",
    "pps.s.s.s.s.s.pp",
    "pp.s.s.s.s.s.spp",
    "pps.s.s.s.s.s.pp",
    "pp.s.s.s.s.s.spp",
    "pps.s.s.s.s.s.pp",
    "pp.s.s.s.s.s.spp",
    "pps.s.s.s.s.s.pp",
    "pppppppppppppppp",
  ],
  { p: "#cfd6dd", t: "#fff6e8", s: "#8fa0b0" },
);

const MEDKIT = makeSprite(
  [
    "..............",
    "....mmmmmm....",
    "..DDDDDDDDDD..",
    ".DwwwwwwwwwwD.",
    ".DwwwwrrwwwwD.",
    ".DwwwrrrrwwwD.",
    ".DwwwwrrwwwwD.",
    ".DwwrrrrrrwwD.",
    ".DwwwrrrrwwwD.",
    ".DwwwwrrwwwwD.",
    ".DwwwwrrwwwwD.",
    ".DwwwwwwwwwwD.",
    "..DDDDDDDDDD..",
    "..............",
  ],
  { w: "#fff6e8", D: "#c23a3a", r: "#ff5d5d", m: "#9aa7b4" },
);

const PULSE = makeSprite(
  [
    "..............",
    "..............",
    ".......g......",
    ".......gg.....",
    ".......g.g....",
    "gggggggg.g....",
    ".......g..g.g.",
    ".......g..g.g.",
    "........gg.ggg",
    "..............",
    "..............",
  ],
  { g: "#42e282" },
);

const TROPHY = makeSprite(
  [
    "..gggggggggggg..",
    ".gggggggggggggg.",
    ".ggssgggggggggg.",
    ".ggsggggggggggg.",
    "g.gggggggggggg.g",
    "gg.gggggggggg.gg",
    "gg.gggggggggg.gg",
    "g..gggggggggg..g",
    "...gggggggggg...",
    ".....gggggg.....",
    "......gggg......",
    "......gggg......",
    "....gggggggg....",
    "...gggggggggg...",
    "..dddddddddddd..",
    "..dddddddddddd..",
  ],
  { g: "#ffd166", s: "#fff6e8", d: "#8a6a1f" },
);

const COIN = makeSprite(
  [
    "...DDDDDD...",
    "..DggggggD..",
    ".DggggggggD.",
    ".DgggddgggD.",
    "DgggddddgggD",
    "DggddddddggD",
    "DgggddddgggD",
    ".DgggddgggD.",
    ".DggggggggD.",
    "..DggggggD..",
    "...DDDDDD...",
  ],
  { g: "#ffd166", D: "#9c7a1c", d: "#6e5200" },
);

const HEART = makeSprite(
  [
    ".rr....rr.",
    "rrrr..rrrr",
    "rrwrrrrrrr",
    "rrrrrrrrrr",
    ".rrrrrrrr.",
    "..rrrrrr..",
    "...rrrr...",
    "....rr....",
    ".....r....",
  ],
  { r: "#ff5d5d", w: "#ffb3b3" },
);

const BOOK = makeSprite(
  [
    ".cccccccccc.",
    ".cccccccccc.",
    ".cccccccccc.",
    ".cggggggggc.",
    ".cggggggggc.",
    ".cccccccccc.",
    ".cccccccccc.",
    ".cccccccccc.",
    ".cccccccccc.",
    ".cccccccccc.",
    ".cccccccccc.",
    ".pppppppppp.",
    "..pppppppp..",
  ],
  { c: "#2a8f6a", g: "#ffd166", p: "#fff6e8" },
);

const MORTARBORD = makeSprite(
  [
    ".......bb.......",
    ".....bbbbbb.....",
    "...bbbbbbbbbb...",
    ".bbbbbbbbbbbbbb.",
    "bbbbbbbbbbbbbbbb",
    "....cccccccc..G.",
    "....cccccccc..G.",
    ".....cccccc...G.",
    ".....cccccc...G.",
    "..............GG",
  ],
  { b: "#3a4150", c: "#232833", G: "#ffd166" },
);

const WHISTLE = makeSprite(
  [
    "..........www.",
    ".wwwww.....www",
    ".wwwww.....www",
    ".wwwwwwwwwwww.",
    ".wwwwwddwwwww.",
    ".wwwwwwwwwwww.",
    ".wwwwwwwwwwww.",
    "..wwwwwwwwww..",
  ],
  { w: "#cfd6dd", d: "#20242e" },
);

const STAR = makeSprite(
  [
    ".....#.....",
    "....###....",
    "...#####...",
    "###########",
    ".#########.",
    "..#######..",
    "..#######..",
    ".###...###.",
    ".##.....##.",
    "##.......##",
  ],
  { "#": "#ffd166" },
);

const PADLOCK = makeSprite(
  [
    "....mmmm....",
    "...mm..mm...",
    "...mm..mm...",
    "...mm..mm...",
    ".bbbbbbbbbb.",
    ".bbbbbbbbbb.",
    ".bbbbbbbbbb.",
    ".bbbbkkbbbb.",
    ".bbbkkkkbbb.",
    ".bbbbkkbbbb.",
    ".bbbbbbbbbb.",
    ".bbbbbbbbbb.",
    ".bbbbbbbbbb.",
    "..bbbbbbbb..",
  ],
  { m: "#9aa7b4", b: "#ffd166", k: "#20242e" },
);

const JOYSTICK = makeSprite(
  [
    "......rr......",
    ".....rrrr.....",
    ".....rrrr.....",
    "......rr......",
    "......mm......",
    "......mm......",
    "......mm......",
    "......mm......",
    "....dddddd....",
    "...dddddddd...",
    "...ddddRddd...",
    "..dddddddddd..",
    "..dddddddddd..",
    ".dddddddddddd.",
    ".dddddddddddd.",
    "dddddddddddddd",
  ],
  { r: "#ff5d5d", m: "#9aa7b4", d: "#2a3040", R: "#42e282" },
);

const TV = makeSprite(
  [
    "...m........m...",
    "....m......m....",
    ".dddddddddddddd.",
    ".dssssssssdkkdd.",
    ".dssssssssdkkdd.",
    ".dssssssssddddd.",
    ".dsdsdsdsdddddd.",
    ".dssssssssddddd.",
    ".dddddddddddddd.",
    "..dd........dd..",
    ".dd..........dd.",
  ],
  { d: "#2a3040", s: "#35c4a0", k: "#ffd166", m: "#9aa7b4" },
);

const BELL = makeSprite(
  [
    ".....mm.....",
    "....mmmm....",
    "....gggg....",
    "...gggggg...",
    "..gggggggg..",
    "..gggggggg..",
    ".gggggggggg.",
    ".gggggggggg.",
    ".gggggggggg.",
    "gggggggggggg",
    ".....rr.....",
  ],
  { g: "#ffd166", m: "#9aa7b4", r: "#ff5d5d" },
);

const ARROW_UP = makeSprite(
  [
    "....#....",
    "...###...",
    "..#####..",
    ".#######.",
    "#########",
    "...###...",
    "...###...",
    "...###...",
    "...###...",
    "...###...",
  ],
  { "#": "#ffd166" },
);

const ARROW_DOWN = makeSprite(
  [
    "...###...",
    "...###...",
    "...###...",
    "...###...",
    "...###...",
    "#########",
    ".#######.",
    "..#####..",
    "...###...",
    "....#....",
  ],
  { "#": "#ff5d5d" },
);

const CHECK = makeSprite(
  [
    "..........##",
    ".........###",
    "........###.",
    ".......###..",
    "##....###...",
    ".##..###....",
    "..#####.....",
    "...###......",
    "....#.......",
  ],
  { "#": "#42e282" },
);

const CROSS = makeSprite(
  [
    "##......##",
    ".##....##.",
    "..##..##..",
    "...####...",
    "....##....",
    "...####...",
    "..##..##..",
    ".##....##.",
    "##......##",
  ],
  { "#": "#ff5d5d" },
);

export const SPRITES: Record<string, Sprite> = {
  BALL,
  RACKET,
  NET,
  MEDKIT,
  PULSE,
  TROPHY,
  COIN,
  HEART,
  BOOK,
  MORTARBORD,
  WHISTLE,
  STAR,
  PADLOCK,
  JOYSTICK,
  TV,
  BELL,
  ARROW_UP,
  ARROW_DOWN,
  CHECK,
  CROSS,
};
