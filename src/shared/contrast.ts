// WCAG contrast over layered, translucent backgrounds (v1.6 glass look).
//
// In glass mode the page is drawn over the desktop, so what is behind a text can be anything. The rule
// (CLEAR_RULE, the user's choice for the clear look): what sits on a box is composited over a few named
// desktops with Windows' acrylic given no credit. Primary text and numbers: 4.5:1 over mid-grey and over
// dark desktops, 3:1 over white. Secondary text and graphics: 3:1 over grey and dark. Pure white is not a
// guaranteed case for them. WORST_BACKDROPS (white, black and saturated colours) stays for the maths tests:
// white and black are the true extremes for any wallpaper (every layer is a blend, so luminance rises with
// every channel of what is behind it).
//
// Compositing happens in 8-bit sRGB like the browser does it; luminance and the ratio follow WCAG 2.x.

export interface Rgba {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

export const WORST_BACKDROPS: Readonly<Record<string, string>> = {
  white: '#ffffff',
  black: '#000000',
  grey: '#808080',
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
};

/** Parse #rgb, #rrggbb, #rrggbbaa, rgb(...) and rgba(...) (comma or space syntax, alpha as number or %). */
export function parseColor(input: string): Rgba {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) throw new Error(`Bad colour: ${input}`);
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\((.*)\)$/.exec(s);
  if (fn) {
    const parts = fn[1]!.replace('/', ' ').split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) throw new Error(`Bad colour: ${input}`);
    const num = (p: string, scale: number) => (p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p));
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255)) as [number, number, number];
    const a = parts[3] === undefined ? 1 : num(parts[3], 1);
    if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Bad colour: ${input}`);
    return { r, g, b, a };
  }
  // How Chromium serializes a relative colour such as rgb(from var(--x) r g b / 0.5): channels 0-1.
  const srgb = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+%?))?\)$/.exec(s);
  if (srgb) {
    const [r, g, b] = [srgb[1], srgb[2], srgb[3]].map((v) => parseFloat(v!) * 255) as [number, number, number];
    const a = srgb[4] === undefined ? 1 : srgb[4].endsWith('%') ? parseFloat(srgb[4]) / 100 : parseFloat(srgb[4]);
    if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Bad colour: ${input}`);
    return { r, g, b, a };
  }
  throw new Error(`Unsupported colour: ${input}`);
}

const toRgba = (c: Rgba | string): Rgba => (typeof c === 'string' ? parseColor(c) : c);

/** `fg` drawn over an opaque `bg` (source-over), in sRGB. */
export function over(fg: Rgba | string, bg: Rgba | string): Rgba {
  const f = toRgba(fg);
  const b = toRgba(bg);
  const mix = (x: number, y: number) => x * f.a + y * (1 - f.a);
  return { r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b), a: 1 };
}

/** Composite layers bottom to top: `stack(backdrop, layer1, layer2, ...)`. */
export function stack(backdrop: Rgba | string, ...layers: (Rgba | string)[]): Rgba {
  return layers.reduce<Rgba>((acc, l) => over(l, acc), { ...toRgba(backdrop), a: 1 });
}

/** CSS `saturate(amount)` (Filter Effects spec matrix), applied to an opaque colour; channels are clamped like the browser. */
export function saturate(c: Rgba | string, amount: number): Rgba {
  const { r, g, b } = toRgba(c);
  const s = amount;
  const clamp = (x: number) => Math.min(255, Math.max(0, x));
  return {
    r: clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
    g: clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
    b: clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
    a: 1,
  };
}

/** WCAG relative luminance of an opaque colour. */
export function luminance(c: Rgba | string): number {
  const { r, g, b } = toRgba(c);
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of a (possibly translucent) foreground over an opaque background. */
export function contrast(fg: Rgba | string, bg: Rgba | string): number {
  const b = { ...toRgba(bg), a: 1 };
  const f = over(fg, b);
  const [hi, lo] = [luminance(f), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A background between the backdrop and the foreground: plain layers, or a `saturate()` step (backdrop-filter). */
export type Layer = Rgba | string | { saturate: number };

export function compose(backdrop: Rgba | string, layers: readonly Layer[]): Rgba {
  return layers.reduce<Rgba>(
    (acc, l) => (typeof l === 'object' && 'saturate' in l ? saturate(acc, l.saturate) : over(l, acc)),
    { ...toRgba(backdrop), a: 1 },
  );
}

/** The lowest contrast of `fg` over `layers` composited on every backdrop, and which backdrop gave it. */
export function worstContrast(
  fg: Rgba | string,
  layers: readonly Layer[],
  backdrops: Readonly<Record<string, string>> = WORST_BACKDROPS,
): { ratio: number; backdrop: string } {
  let worst = { ratio: Infinity, backdrop: '' };
  for (const [name, color] of Object.entries(backdrops)) {
    const ratio = contrast(fg, compose(color, layers));
    if (ratio < worst.ratio) worst = { ratio, backdrop: name };
  }
  return worst;
}

/**
 * The smallest alpha (0-1, to 0.001) for a `tint` colour, laid directly over the backdrop, that gives `fg` at
 * least `ratio` over every backdrop with `above` (the layers between the tint and the foreground). Returns
 * null if even an opaque tint is not enough. Contrast only grows with the alpha here because the tint is
 * darker than the foregrounds it is checked with.
 */
export function minTintAlpha(
  tint: string,
  fg: Rgba | string,
  ratio: number,
  above: readonly Layer[] = [],
  backdrops: Readonly<Record<string, string>> = WORST_BACKDROPS,
): number | null {
  const t = parseColor(tint);
  const ok = (a: number) => worstContrast(fg, [{ ...t, a }, ...above], backdrops).ratio >= ratio;
  if (!ok(1)) return null;
  let lo = 0;
  let hi = 1;
  while (hi - lo > 0.0005) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi * 1000) / 1000;
}

/** What an item is, for CLEAR_RULE. */
export type ItemKind = 'primary' | 'secondary' | 'graphic';

/** The desktops CLEAR_RULE is checked over: mid-grey, two dark ones (black, and a dark-mode window) and white. */
export const RULE_BACKDROPS: Readonly<Record<string, string>> = {
  grey: '#808080',
  black: '#000000',
  'dark window': '#202020',
  white: '#ffffff',
};

/** The ratio each kind needs over each RULE_BACKDROPS desktop; a missing entry is not checked. */
export const CLEAR_RULE: Readonly<Record<ItemKind, Readonly<Record<string, number>>>> = {
  primary: { grey: 4.5, black: 4.5, 'dark window': 4.5, white: 3 },
  secondary: { grey: 3, black: 3, 'dark window': 3 },
  graphic: { grey: 3, black: 3, 'dark window': 3 },
};

/** The tightest backdrop for `fg` of kind `kind` over `layers`: the lowest ratio / need. */
export function ruleCheck(fg: Rgba | string, layers: readonly Layer[], kind: ItemKind): { ratio: number; need: number; backdrop: string; margin: number } {
  let worst = { ratio: Infinity, need: 0, backdrop: '', margin: Infinity };
  for (const [name, need] of Object.entries(CLEAR_RULE[kind])) {
    const ratio = contrast(fg, compose(RULE_BACKDROPS[name]!, layers));
    if (ratio / need < worst.margin) worst = { ratio, need, backdrop: name, margin: ratio / need };
  }
  return worst;
}
