// World news of Wednesday 18 November 2026, summed up in one image.
//
// A Node 22 program (standard library only, no network). It draws the image
// itself from code: a newspaper-style digest with the day's six biggest
// stories, each with a small drawn icon, a headline and a one-line summary.
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Output: /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png), 1024x1024,
// deterministic: two runs write byte-identical files.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---- palette: newspaper paper, ink navy, accent colours per story ----
const PAPER = [247, 243, 234, 255];
const INK = [20, 33, 61, 255];
const INK_SOFT = [64, 74, 96, 255];
const GOLD = [201, 162, 39, 255];
const RED = [192, 57, 43, 255];
const WHITE = [255, 255, 255, 255];
const ROW_ALT = [238, 233, 220, 255];

// ---- tiny raster canvas -------------------------------------------------
class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;
  constructor(w: number, h: number, bg: number[]) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      this.px[i * 4] = bg[0];
      this.px[i * 4 + 1] = bg[1];
      this.px[i * 4 + 2] = bg[2];
      this.px[i * 4 + 3] = bg[3];
    }
  }
  set(x: number, y: number, c: number[]): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const o = (yi * this.w + xi) * 4;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
    this.px[o + 3] = c[3];
  }
  fillRect(x: number, y: number, w: number, h: number, c: number[]): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const o = (yy * this.w + xx) * 4;
        this.px[o] = c[0];
        this.px[o + 1] = c[1];
        this.px[o + 2] = c[2];
        this.px[o + 3] = c[3];
      }
    }
  }
  fillCircle(cx: number, cy: number, r: number, c: number[]): void {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, c);
      }
    }
  }
  // Thick line: stamp discs along the segment.
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: number[]): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len * 2));
    const r = width / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.fillCircle(x0 + dx * t, y0 + dy * t, r, c);
    }
  }
  // Circle outline, stamped as a ring of discs.
  circleOutline(cx: number, cy: number, r: number, width: number, c: number[]): void {
    const steps = Math.max(24, Math.ceil(2 * Math.PI * r));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      this.fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, width / 2, c);
    }
  }
  // Even-odd scanline polygon fill. pts: [x, y][].
  fillPolygon(pts: number[][], c: number[]): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y + 0.5 - a[1]) / (b[1] - a[1]);
          xs.push(a[0] + t * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.fillRect(xs[k], y, xs[k + 1] - xs[k], 1, c);
      }
    }
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, c: number[]): void {
    this.fillRect(x + r, y, w - 2 * r, h, c);
    this.fillRect(x, y + r, w, h - 2 * r, c);
    this.fillCircle(x + r, y + r, r, c);
    this.fillCircle(x + w - r, y + r, r, c);
    this.fillCircle(x + r, y + h - r, r, c);
    this.fillCircle(x + w - r, y + h - r, r, c);
  }
}

// Star polygon points (5-point by default), for flags and bursts.
function starPoints(cx: number, cy: number, rOuter: number, rInner: number, points = 5, rot = -Math.PI / 2): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + (i * Math.PI) / points;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// ---- PNG encoder (zlib + CRC32, no dependencies) -----------------------
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function encodePNG(canvas: Canvas): Buffer {
  const raw = Buffer.alloc((canvas.w * 4 + 1) * canvas.h);
  for (let y = 0; y < canvas.h; y++) {
    raw[y * (canvas.w * 4 + 1)] = 0; // filter: none
    Buffer.from(canvas.px.buffer, y * canvas.w * 4, canvas.w * 4).copy(raw, y * (canvas.w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.w, 0);
  ihdr.writeUInt32BE(canvas.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 5x7 bitmap font (all-caps newspaper face) -------------------------
// Each glyph is 7 rows of 5 pixels, '#' = ink. Rendered at a scale factor,
// one pixel becomes a scale x scale block, so the face stays crisp.
const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#..##', '#.#.#', '##..#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '...#.', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '.##..', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '#....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '...#.', '..#..', '.#...', '#....'],
  '(': ['...##', '..#..', '.#...', '.#...', '.#...', '..#..', '...##'],
  ')': ['##...', '..#..', '...#.', '...#.', '...#.', '..#..', '##...'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.#.#.', '.....', '.....', '.....', '.....'],
};
const GLYPH_W = 6; // 5 pixels + 1 pixel tracking
const GLYPH_H = 7;

function textWidth(text: string, scale: number): number {
  return text.length * GLYPH_W * scale - scale; // no trailing tracking
}
function drawText(cv: Canvas, x: number, y: number, text: string, scale: number, c: number[]): void {
  for (let i = 0; i < text.length; i++) {
    const g = FONT[text[i]] ?? FONT[' '];
    const gx = x + i * GLYPH_W * scale;
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === '#') cv.fillRect(gx + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}
// Greedy word wrap to a pixel width; returns lines (never more than maxLines).
function wrapText(text: string, scale: number, maxW: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur === '' ? w : cur + ' ' + w;
    if (textWidth(trial, scale) <= maxW || cur === '') {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur !== '') lines.push(cur);
  return lines;
}

// ---- the day's news (verified against wire briefings of 18 Nov 2026) -----
type Story = {
  tag: string;
  accent: number[];
  headline: string;
  sub: string;
  icon: (cv: Canvas, x: number, y: number, s: number) => void;
};

const DARK = [30, 30, 34, 255];
const ICON_BG = [255, 255, 255, 255];

// 1. Gulf escalation: burst + missile.
function iconGulf(cv: Canvas, x: number, y: number, s: number): void {
  const cx = x + 56 * s;
  const cy = y + 58 * s;
  cv.fillPolygon(starPoints(cx, cy, 46 * s, 20 * s, 8), [230, 126, 34, 255]);
  cv.fillPolygon(starPoints(cx, cy, 30 * s, 13 * s, 8), [241, 196, 15, 255]);
  cv.fillCircle(cx, cy, 11 * s, [192, 57, 43, 255]);
  // missile streaking up-right
  const mx = x + 78 * s;
  const my = y + 26 * s;
  cv.fillPolygon(
    [
      [mx, my - 16 * s], [mx + 7 * s, my - 2 * s], [mx + 7 * s, my + 12 * s],
      [mx + 12 * s, my + 18 * s], [mx + 3 * s, my + 14 * s], [mx - 3 * s, my + 14 * s],
      [mx - 12 * s, my + 18 * s], [mx - 7 * s, my + 12 * s], [mx - 7 * s, my - 2 * s],
    ],
    DARK,
  );
  cv.line(mx - 4 * s, my + 20 * s, mx - 10 * s, my + 30 * s, 3 * s, [192, 57, 43, 255]);
  cv.line(mx + 4 * s, my + 20 * s, mx + 10 * s, my + 30 * s, 3 * s, [192, 57, 43, 255]);
}

// 2. Kerch Bridge: deck with a collapsed middle span over water.
function iconBridge(cv: Canvas, x: number, y: number, s: number): void {
  const y0 = y + 46 * s;
  // intact deck segments
  cv.fillRect(x + 8 * s, y0, 34 * s, 7 * s, DARK);
  cv.fillRect(x + 70 * s, y0, 34 * s, 7 * s, DARK);
  // towers: slim posts with a small cap
  cv.fillRect(x + 23 * s, y + 16 * s, 4 * s, y0 - (y + 16 * s) + 7 * s, DARK);
  cv.fillRect(x + 85 * s, y + 16 * s, 4 * s, y0 - (y + 16 * s) + 7 * s, DARK);
  cv.fillRect(x + 19 * s, y + 12 * s, 12 * s, 4 * s, DARK);
  cv.fillRect(x + 81 * s, y + 12 * s, 12 * s, 4 * s, DARK);
  // cables from tower tops to the deck ends
  cv.line(x + 25 * s, y + 16 * s, x + 40 * s, y0, 2 * s, INK_SOFT);
  cv.line(x + 87 * s, y + 16 * s, x + 72 * s, y0, 2 * s, INK_SOFT);
  // fallen span: a broken piece tilted down into the gap, with a splash
  cv.line(x + 44 * s, y0 + 5 * s, x + 64 * s, y0 + 24 * s, 6 * s, [192, 57, 43, 255]);
  cv.fillCircle(x + 56 * s, y0 + 30 * s, 4 * s, [41, 128, 185, 255]);
  cv.fillCircle(x + 64 * s, y0 + 32 * s, 3 * s, [41, 128, 185, 255]);
  cv.fillCircle(x + 48 * s, y0 + 32 * s, 3 * s, [41, 128, 185, 255]);
  // water
  for (let i = 0; i < 3; i++) {
    cv.line(x + 10 * s + i * 6 * s, y + 84 * s + i * 7 * s, x + 100 * s - i * 6 * s, y + 84 * s + i * 7 * s, 3 * s, [41, 128, 185, 255]);
  }
}

// 3. Xi-Putin summit: two flags on poles (China red + stars, Russia tricolour).
function iconFlags(cv: Canvas, x: number, y: number, s: number): void {
  const pole = (px: number): void => cv.fillRect(px, y + 12 * s, 4 * s, 84 * s, DARK);
  pole(x + 14 * s);
  pole(x + 58 * s);
  // China flag
  cv.fillRect(x + 18 * s, y + 12 * s, 40 * s, 26 * s, [222, 41, 16, 255]);
  cv.fillPolygon(starPoints(x + 28 * s, y + 25 * s, 7 * s, 3 * s), [255, 222, 89, 255]);
  cv.fillPolygon(starPoints(x + 42 * s, y + 18 * s, 3.5 * s, 1.5 * s), [255, 222, 89, 255]);
  cv.fillPolygon(starPoints(x + 48 * s, y + 25 * s, 3.5 * s, 1.5 * s), [255, 222, 89, 255]);
  cv.fillPolygon(starPoints(x + 42 * s, y + 32 * s, 3.5 * s, 1.5 * s), [255, 222, 89, 255]);
  // Russia flag (thin grey frame so the white stripe reads on a white tile)
  cv.fillRect(x + 62 * s, y + 12 * s, 40 * s, 26 * s, [200, 200, 200, 255]);
  cv.fillRect(x + 63 * s, y + 13 * s, 38 * s, 24 * s, [255, 255, 255, 255]);
  cv.fillRect(x + 63 * s, y + 21 * s, 38 * s, 8 * s, [0, 57, 166, 255]);
  cv.fillRect(x + 63 * s, y + 29 * s, 38 * s, 8 * s, [213, 0, 50, 255]);
  cv.circleOutline(x + 18 * s, y + 12 * s, 3 * s, 2 * s, GOLD);
  cv.circleOutline(x + 62 * s, y + 12 * s, 3 * s, 2 * s, GOLD);
  // handshake hint: two joined hands as a simple arc below
  cv.line(x + 30 * s, y + 66 * s, x + 50 * s, y + 78 * s, 5 * s, [39, 174, 96, 255]);
  cv.line(x + 82 * s, y + 66 * s, x + 62 * s, y + 78 * s, 5 * s, [39, 174, 96, 255]);
  cv.fillCircle(x + 56 * s, y + 80 * s, 6 * s, [39, 174, 96, 255]);
}

// 4. Election: ballot box with a slip and a big check mark.
function iconVote(cv: Canvas, x: number, y: number, s: number): void {
  cv.fillRect(x + 18 * s, y + 48 * s, 62 * s, 46 * s, [41, 128, 185, 255]);
  cv.fillRect(x + 12 * s, y + 40 * s, 74 * s, 10 * s, [31, 97, 141, 255]);
  cv.fillRect(x + 40 * s, y + 43 * s, 18 * s, 4 * s, DARK);
  cv.fillPolygon(
    [[x + 42 * s, y + 44 * s], [x + 62 * s, y + 8 * s], [x + 78 * s, y + 14 * s], [x + 58 * s, y + 44 * s]],
    WHITE,
  );
  cv.line(x + 48 * s, y + 18 * s, x + 70 * s, y + 24 * s, 2 * s, INK_SOFT);
  cv.line(x + 46 * s, y + 26 * s, x + 68 * s, y + 32 * s, 2 * s, INK_SOFT);
  // check mark
  cv.line(x + 22 * s, y + 66 * s, x + 38 * s, y + 84 * s, 8 * s, [39, 174, 96, 255]);
  cv.line(x + 38 * s, y + 84 * s, x + 82 * s, y + 34 * s, 8 * s, [39, 174, 96, 255]);
}

// 5. Measles: spiky virus ball.
function iconVirus(cv: Canvas, x: number, y: number, s: number): void {
  const cx = x + 56 * s;
  const cy = y + 56 * s;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * 2 * Math.PI;
    const x1 = cx + Math.cos(a) * 30 * s;
    const y1 = cy + Math.sin(a) * 30 * s;
    const x2 = cx + Math.cos(a) * 46 * s;
    const y2 = cy + Math.sin(a) * 46 * s;
    cv.line(x1, y1, x2, y2, 4 * s, [192, 57, 43, 255]);
    cv.fillCircle(x2, y2, 5 * s, [192, 57, 43, 255]);
  }
  cv.fillCircle(cx, cy, 30 * s, [231, 76, 60, 255]);
  cv.fillCircle(cx - 10 * s, cy - 8 * s, 7 * s, [192, 57, 43, 255]);
  cv.fillCircle(cx + 11 * s, cy + 6 * s, 9 * s, [192, 57, 43, 255]);
  cv.fillCircle(cx + 2 * s, cy + 14 * s, 5 * s, [192, 57, 43, 255]);
  cv.fillCircle(cx - 14 * s, cy + 12 * s, 4 * s, [192, 57, 43, 255]);
}

// 6. Voyager 1: classic deep-space probe — gold body, blue solar panels,
// dish antenna on top, signal waves, stars. All drawing stays inside the
// 112x112 icon tile.
function iconVoyager(cv: Canvas, x: number, y: number, s: number): void {
  const cx = x + 56 * s;
  const cy = y + 70 * s;
  // stars
  cv.fillPolygon(starPoints(x + 14 * s, y + 16 * s, 6 * s, 2.5 * s, 4), [41, 128, 185, 255]);
  cv.fillPolygon(starPoints(x + 96 * s, y + 22 * s, 5 * s, 2 * s, 4), [41, 128, 185, 255]);
  cv.fillPolygon(starPoints(x + 94 * s, y + 96 * s, 5 * s, 2 * s, 4), [41, 128, 185, 255]);
  // signal waves from the dish, upper half only
  const waveY = cy - 30 * s;
  for (const r of [18, 26]) {
    for (let a = Math.PI + 0.35; a <= 2 * Math.PI - 0.35; a += 0.05) {
      cv.fillCircle(cx + Math.cos(a) * r * s, waveY + Math.sin(a) * r * s, 1.5 * s, [41, 128, 185, 255]);
    }
  }
  // solar panels left and right, with grid lines
  cv.fillRect(x + 6 * s, cy - 10 * s, 30 * s, 20 * s, [31, 97, 141, 255]);
  cv.fillRect(x + 76 * s, cy - 10 * s, 30 * s, 20 * s, [31, 97, 141, 255]);
  for (let i = 1; i < 3; i++) {
    cv.fillRect(x + 6 * s + i * 10 * s, cy - 10 * s, 1 * s, 20 * s, [255, 255, 255, 255]);
    cv.fillRect(x + 76 * s + i * 10 * s, cy - 10 * s, 1 * s, 20 * s, [255, 255, 255, 255]);
  }
  cv.fillRect(x + 6 * s, cy - 1 * s, 30 * s, 1 * s, [255, 255, 255, 255]);
  cv.fillRect(x + 76 * s, cy - 1 * s, 30 * s, 1 * s, [255, 255, 255, 255]);
  // booms
  cv.fillRect(x + 36 * s, cy - 2 * s, 8 * s, 4 * s, DARK);
  cv.fillRect(x + 68 * s, cy - 2 * s, 8 * s, 4 * s, DARK);
  // gold body
  cv.fillRect(cx - 12 * s, cy - 14 * s, 24 * s, 28 * s, [212, 172, 13, 255]);
  cv.fillRect(cx - 12 * s, cy - 14 * s, 24 * s, 4 * s, [241, 196, 15, 255]);
  // dish on a mast above the body: a shallow bowl opening upward
  cv.fillRect(cx - 2 * s, cy - 30 * s, 4 * s, 16 * s, DARK);
  for (let t = -1.05; t <= 1.05; t += 0.05) {
    cv.fillCircle(cx + 16 * s * Math.sin(t), cy - 30 * s - 16 * s + 16 * s * Math.cos(t), 3 * s, [212, 172, 13, 255]);
  }
  cv.fillCircle(cx, cy - 42 * s, 3 * s, [212, 172, 13, 255]);
}

const STORIES: Story[] = [
  {
    tag: 'GULF',
    accent: [192, 57, 43, 255],
    headline: 'U.S. STRIKES IRAN ISLAND; IRAN HITS KUWAIT AND BAHRAIN',
    sub: 'U.S. JETS HIT A MISSILE SITE ON QESHM. IRAN HIT BACK AT BASES IN KUWAIT AND BAHRAIN.',
    icon: iconGulf,
  },
  {
    tag: 'UKRAINE',
    accent: [41, 128, 185, 255],
    headline: 'UKRAINE STRIKE PARTLY COLLAPSES KERCH BRIDGE',
    sub: 'AN ARCH OF THE BRIDGE TO CRIMEA FELL INTO THE STRAIT ON THE SECOND DAY OF ATTACKS.',
    icon: iconBridge,
  },
  {
    tag: 'CHINA',
    accent: [142, 68, 173, 255],
    headline: 'XI AND PUTIN MEET IN SHENZHEN BEFORE TRUMP SUMMIT',
    sub: "THE LEADERS DENOUNCED PROTECTIONISM AND SANCTIONS AHEAD OF THURSDAY'S THREE-WAY TALKS.",
    icon: iconFlags,
  },
  {
    tag: 'U.S. POLITICS',
    accent: [39, 174, 96, 255],
    headline: 'PELTOLA WINS ALASKA; DEMOCRATS TAKE SENATE 56-44',
    sub: 'THE NINTH SENATE FLIP OF THE MIDTERMS GIVES DEMOCRATS THEIR LARGEST MAJORITY SINCE 2009.',
    icon: iconVote,
  },
  {
    tag: 'HEALTH',
    accent: [230, 126, 34, 255],
    headline: 'U.S. LOSES MEASLES-FREE STATUS AFTER 26 YEARS',
    sub: 'MORE THAN 5,400 CASES IN 2026, THE MOST SINCE 1991. TEN DEATHS REPORTED.',
    icon: iconVirus,
  },
  {
    tag: 'SPACE',
    accent: [44, 62, 80, 255],
    headline: 'VOYAGER 1 REACHES ONE LIGHT-DAY FROM EARTH',
    sub: '16 BILLION MILES OUT, THE FARTHEST ANY HUMAN-MADE CRAFT HAS EVER FLOWN.',
    icon: iconVoyager,
  },
];

// ---- composition ---------------------------------------------------------
const HEADER_H = 112;
const FOOTER_H = 42;
const ROW_H = (H - HEADER_H - FOOTER_H) / 6; // 145
const TEXT_X = 152;
const TEXT_W = W - TEXT_X - 24;

function drawHeader(cv: Canvas): void {
  cv.fillRect(0, 0, W, HEADER_H, INK);
  const kicker = 'THE WORLD IN ONE IMAGE';
  drawText(cv, (W - textWidth(kicker, 3)) / 2, 12, kicker, 3, GOLD);
  const title = 'WEDNESDAY, 18 NOVEMBER 2026';
  drawText(cv, (W - textWidth(title, 6)) / 2, 40, title, 6, WHITE);
  cv.fillRect(212, 92, W - 424, 3, GOLD);
  const sub = 'SIX STORIES THAT DEFINED THE DAY';
  drawText(cv, (W - textWidth(sub, 2)) / 2, 98, sub, 2, [190, 196, 210, 255]);
}

function drawFooter(cv: Canvas): void {
  const y0 = H - FOOTER_H;
  cv.fillRect(0, y0, W, FOOTER_H, INK);
  const line = 'EVENTS OF 18 NOVEMBER 2026, AS REPORTED BY WIRE SERVICES. DRAWN BY CODE.';
  drawText(cv, (W - textWidth(line, 2)) / 2, y0 + 14, line, 2, [190, 196, 210, 255]);
}

function drawStory(cv: Canvas, story: Story, row: number): void {
  const y0 = HEADER_H + row * ROW_H;
  cv.fillRect(0, y0, W, ROW_H, row % 2 === 0 ? PAPER : ROW_ALT);
  cv.fillRect(0, y0, 10, ROW_H, story.accent);
  // icon tile
  cv.roundRect(24, y0 + 16, 112, 112, 10, ICON_BG);
  cv.fillRect(24, y0 + 16, 112, 4, story.accent); // thin accent cap on the tile
  story.icon(cv, 24, y0 + 16, 1);
  // text block, vertically centred
  const headLines = wrapText(story.headline, 5, TEXT_W, 2);
  const subLines = wrapText(story.sub, 3, TEXT_W, 2);
  const blockH = 14 + 5 + headLines.length * 35 + 4 + subLines.length * 21;
  let y = y0 + (ROW_H - blockH) / 2;
  drawText(cv, TEXT_X, y, story.tag, 2, story.accent);
  y += 14 + 5;
  for (const ln of headLines) {
    drawText(cv, TEXT_X, y, ln, 5, INK);
    y += 35;
  }
  y += 4;
  for (const ln of subLines) {
    drawText(cv, TEXT_X, y, ln, 3, INK_SOFT);
    y += 21;
  }
  // divider
  cv.fillRect(0, y0 + ROW_H - 1, W, 1, [216, 210, 196, 255]);
}

function main(): void {
  const cv = new Canvas(W, H, PAPER);
  drawHeader(cv);
  for (let i = 0; i < STORIES.length; i++) drawStory(cv, STORIES[i], i);
  drawFooter(cv);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), encodePNG(cv));
}

main();
