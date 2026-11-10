// The tray icon's temperature (v1.9): pure JS, no native modules and no image files. A hand-made 3x7 pixel font
// (digits and minus) is drawn in white on an opaque blue rounded badge, into a raw BGRA bitmap that main.ts turns
// into a nativeImage (nativeImage.createFromBitmap). The opaque badge keeps the digits readable on light and dark
// taskbars alike. 16 px is drawn 1:1; 32 px (scale factor 2) is the same drawing at 2x, so it stays crisp.
// Only fully opaque or fully transparent pixels are written (no premultiplied-alpha questions).

/** Each glyph: 7 rows of 3 bits, left bit first. */
const FONT: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '010', '010', '111'],
  '2': ['111', '001', '001', '111', '100', '100', '111'],
  '3': ['111', '001', '001', '111', '001', '001', '111'],
  '4': ['101', '101', '101', '111', '001', '001', '001'],
  '5': ['111', '100', '100', '111', '001', '001', '111'],
  '6': ['111', '100', '100', '111', '101', '101', '111'],
  '7': ['111', '001', '001', '001', '010', '010', '010'],
  '8': ['111', '101', '101', '111', '101', '101', '111'],
  '9': ['111', '101', '101', '111', '001', '001', '111'],
  '-': ['000', '000', '000', '111', '000', '000', '000'],
};

export const GLYPH_WIDTH = 3;
export const GLYPH_HEIGHT = 7;
/** Badge and digit colours (RGB). White on #1e40af is 8.7:1. */
export const BADGE = [0x1e, 0x40, 0xaf] as const;
export const INK = [0xff, 0xff, 0xff] as const;
/** The base size; the 32 px version is the same drawing at 2x. */
export const BASE = 16;
const RADIUS = 3;

/** The rounded temperature as shown in the icon: "12", "-5", "104", "-130". Kept to 4 characters (fits 16 px). */
export function trayLabel(temperature: number): string {
  const n = Math.max(-199, Math.min(999, Math.round(temperature)));
  return String(n === 0 ? 0 : n); // never "-0"
}

/** Width in base pixels of a label: 3 per glyph, 1 between. */
export function labelWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * (GLYPH_WIDTH + 1) - 1;
}

export interface Bitmap {
  width: number;
  height: number;
  /** BGRA, 4 bytes per pixel, rows top to bottom. */
  bgra: Buffer;
}

function inBadge(x: number, y: number): boolean {
  // Rounded corners: a pixel is outside when it lies beyond the corner circle.
  const r = RADIUS;
  const cx = x < r ? r - 0.5 : x > BASE - 1 - r ? BASE - 1 - r + 0.5 : x;
  const cy = y < r ? r - 0.5 : y > BASE - 1 - r ? BASE - 1 - r + 0.5 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Draw `text` (digits and '-') at `scale` (1 = 16 px, 2 = 32 px). Unknown characters are skipped. */
export function drawTrayBitmap(text: string, scale: 1 | 2 = 1): Bitmap {
  const glyphs = [...text].filter((c) => FONT[c]);
  const label = glyphs.join('');
  const size = BASE * scale;
  const bgra = Buffer.alloc(size * size * 4);
  const ink = new Uint8Array(BASE * BASE); // 1 where a digit pixel is, in base pixels
  const left = Math.floor((BASE - labelWidth(label)) / 2);
  const top = Math.floor((BASE - GLYPH_HEIGHT) / 2);
  glyphs.forEach((c, i) => {
    FONT[c]!.forEach((row, y) => {
      for (let x = 0; x < GLYPH_WIDTH; x++) {
        const px = left + i * (GLYPH_WIDTH + 1) + x;
        if (row[x] === '1' && px >= 0 && px < BASE) ink[(top + y) * BASE + px] = 1;
      }
    });
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bx = Math.floor(x / scale);
      const by = Math.floor(y / scale);
      if (!inBadge(bx, by)) continue; // transparent corner
      const [r, g, b] = ink[by * BASE + bx] ? INK : BADGE;
      const o = (y * size + x) * 4;
      bgra[o] = b;
      bgra[o + 1] = g;
      bgra[o + 2] = r;
      bgra[o + 3] = 255;
    }
  }
  return { width: size, height: size, bgra };
}
