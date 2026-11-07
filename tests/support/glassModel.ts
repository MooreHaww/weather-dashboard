// The clear glass look (v1.6) as layers, read from styles.css: what is behind every text and graphic, from the desktop
// up. Used by tests/glassContrast.test.ts. Everything on a box is checked against CLEAR_RULE (src/shared/contrast.ts):
// primary text and numbers 4.5:1 over grey and dark desktops and 3:1 over white, secondary text and graphics 3:1 over
// grey and dark. Each box is checked with no outer wash and under every weather state's wash and glow, with and without
// the boxes' saturate(). Each layer counts at its strongest point (the top of a gradient, the peak of a glow).
// Windows' acrylic gets no credit. Text on the bare glass (app name, sidebar titles, footer) has no box: bareGlass()
// lists it for the report; the rule above is for boxes.

import { compose, contrast, parseColor, ruleCheck, type ItemKind, type Layer, type Rgba } from '../../src/shared/contrast';

/** Custom properties of the first rule whose selector is exactly `selector`. */
export function tokensOf(css: string, selector: string): Record<string, string> {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`No rule for ${selector}`);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

export const GLASS = "html[data-material='glass']";
export const STATE_SELECTOR = (state: string) => `${GLASS} body[data-sky='${state}']`;

export interface Item {
  name: string;
  color: string;
  kind: ItemKind;
}
export interface Place {
  layers: Layer[];
  items: Item[];
}
export interface SkyTokens {
  tint: Rgba;
  /** The state's own --sky-alpha in styles.css. */
  base: number;
  /** What is drawn: base x --wash-strength, at most WASH_MAX (same for the glow's alpha). */
  alpha: number;
  glow: Rgba;
}

/** The cap in the .backdrop rule: no wash or glow alpha above this, whatever --wash-strength says. */
export const WASH_MAX = 0.35;

export interface GlassModel {
  boxFill: Rgba;
  /** 'default' (before any weather) and every state from styles.css, in file order. */
  states: Record<string, SkyTokens>;
  /** The places on a box, built with the box fill at `boxAlpha` (default: the CSS value). */
  places(boxAlpha?: number): Record<string, Place>;
  /** Text and graphics on the bare glass (no box), for the report. */
  bareGlass(): Item[];
  /** What lies between the desktop and the boxes: nothing, or a state's wash and its glow at full strength. */
  outer(state: string | null): Layer[];
}

export function glassModel(css: string, chartsSource: string): GlassModel {
  const root = tokensOf(css, ':root');
  const glass = tokensOf(css, GLASS);
  const g = (name: string): string => {
    const v = glass[name] ?? root[name];
    if (v === undefined) throw new Error(`No token ${name}`);
    return v;
  };
  const series = (key: string) => new RegExp(`\\b${key}: '([^']+)'`).exec(chartsSource)![1]!;
  const chartLabel = /Chart\.defaults\.color = '([^']+)'/.exec(chartsSource)![1]!; // unchanged in 1.6
  const sat = (filter: string): Layer => ({ saturate: Number(/saturate\((\d+)%\)/.exec(filter)![1]) / 100 });
  const boxFill = parseColor(g('--box-fill'));

  // What is drawn: each state's alpha and glow times --wash-strength, capped at WASH_MAX (as in the .backdrop rule).
  const strength = Number(g('--wash-strength'));
  const skyOf = (t: Record<string, string>): SkyTokens => {
    const pick = (k: string) => t[k] ?? glass[k]!;
    const base = Number(pick('--sky-alpha'));
    const glow = parseColor(pick('--sky-glow'));
    return {
      tint: parseColor(pick('--sky-tint')),
      base,
      alpha: Math.min(WASH_MAX, base * strength),
      glow: { ...glow, a: Math.min(WASH_MAX, glow.a * strength) },
    };
  };
  const states: Record<string, SkyTokens> = { default: skyOf(glass) };
  for (const m of css.matchAll(/html\[data-material='glass'\] body\[data-sky='([\w-]+)'\] \{/g)) states[m[1]!] = skyOf(tokensOf(css, STATE_SELECTOR(m[1]!)));

  const text = root['--text']!;
  const muted = g('--muted');
  const link = g('--link');
  const wet = glass['--wet'] ?? '#9fd1ff';
  const today = glass['--today'] ?? '#bfdbfe';
  const P = (name: string, color: string): Item => ({ name, color, kind: 'primary' });
  const S = (name: string, color: string): Item => ({ name, color, kind: 'secondary' });
  const G = (name: string, color: string): Item => ({ name, color, kind: 'graphic' });

  const places = (boxAlpha = boxFill.a): Record<string, Place> => {
    const fill: Rgba = { ...boxFill, a: boxAlpha };
    const sheen = g('--box-sheen');
    const BOX: Layer[] = [sat(g('--glass-blur')), fill, sheen]; // cards, sidebar cards, search field, overlays
    // Settings: a fixed dark scrim (not the box fill) over the blurred dashboard; its rows are boxes on it.
    const SHEET: Layer[] = [g('--settings-scrim'), sheen];
    return {
      'search field': {
        layers: [...BOX, 'rgba(255, 255, 255, 0.06)'],
        items: [P('typed text', text), S('placeholder', muted), S('"Ctrl K" hint', muted), G('search icon', muted)],
      },
      'search field, hovered': { layers: [...BOX, 'rgba(255, 255, 255, 0.09)'], items: [P('typed text', text), S('placeholder', muted)] },
      'search results': { layers: ['rgba(20, 28, 46, 0.97)'], items: [P('city', text), S('country', muted)] },
      'sidebar card': {
        layers: BOX,
        items: [P('city name', text), P('temperature', text), S('country', muted), G('sun icon', '#FFC83D'), G('cloud icon', '#E4EAF3'), G('"×"', muted)],
      },
      'sidebar card, hovered': { layers: [...BOX, root['--card-hover']!], items: [P('city name', text), S('country', muted)] },
      'Recent card, active': {
        layers: [...BOX, 'rgba(96, 165, 250, 0.14)'],
        items: [P('city name', text), S('country', muted), G('blue bar', root['--accent']!)],
      },
      'Favorite card, active': {
        layers: [...BOX, 'rgba(251, 191, 36, 0.1)'],
        items: [P('city name', text), S('country', muted), G('gold bar', root['--gold']!)],
      },
      'Your location card, active': {
        layers: [...BOX, 'rgba(167, 139, 250, 0.1)'],
        items: [P('city name', text), S('country', muted), G('purple bar', root['--location']!)],
      },
      card: {
        layers: BOX,
        items: [
          P('text and numbers', text),
          P('"likely" rain text', wet),
          P('link', link),
          S('muted text', muted),
          S('chart axis labels', chartLabel),
          G('temperature line', series('temperature')),
          G('feels-like line', series('feelsLike')),
          G('rain bar, highest chance', series('rain')),
          G('current-time dot', root['--temp']!),
          G('purple pin', root['--location']!),
          G('gold star', root['--gold']!),
          G('wind arrow', root['--accent']!),
          G('sun icon', '#FFC83D'),
          G('cloud icon', '#E4EAF3'),
        ],
      },
      'forecast day, hovered': {
        layers: [...BOX, root['--card-hover']!],
        items: [P('day name and temperatures', text), P('"wet" rain chance', wet), S('date and condition', muted)],
      },
      'forecast day, selected': {
        layers: [...BOX, 'rgba(96, 165, 250, 0.18)'],
        items: [P('day name and temperatures', text), P("today's name", today), P('"wet" rain chance', wet), S('date and condition', muted)],
      },
      'button on a box, hovered (Not now)': { layers: [...BOX, 'rgba(255, 255, 255, 0.14)'], items: [P('label', text)] },
      banner: { layers: [fill, 'rgba(251, 191, 36, 0.12)'], items: [P('message', '#fde68a')] },
      'overlay (consent card, update note, "Restart now?", the "i" popover)': {
        layers: BOX,
        items: [P('text', text), P('link', link), S('muted text', muted)],
      },
      'Settings sheet': { layers: SHEET, items: [P('title and section titles', text), S('muted text', muted)] },
      'Settings, inside a section': {
        layers: [...SHEET, fill, g('--glass-section')],
        items: [P('label', text), S('state line', muted), G('purple', root['--location']!)],
      },
    };
  };

  return {
    boxFill,
    states,
    places,
    bareGlass: () => [
      P('app name', text),
      G('gear', text),
      G("Windows' buttons", '#e8edf5'),
      S('sidebar section titles', muted),
      S('empty lines', muted),
      P('"Clear" link', link),
      S('footer "Updated" line', muted),
      P('footer Open-Meteo links', link),
    ],
    outer(state) {
      if (state === null) return [];
      const s = states[state]!;
      return [{ ...s.tint, a: s.alpha }, s.glow, s.glow]; // the two glows overlap in places: both at full strength
    },
  };
}

const noSaturate = (layers: Layer[]) => layers.filter((l) => !(typeof l === 'object' && 'saturate' in l));

export interface Ratio {
  place: string;
  item: string;
  kind: ItemKind;
  ratio: number;
  need: number;
  /** ratio / need at the tightest point; >= 1 passes. */
  margin: number;
  where: string;
}

/** Every item on a box at its tightest point: over the rule's desktops, with no wash and under each state, with and without saturate(). */
export function worstRatios(m: GlassModel, boxAlpha?: number): Ratio[] {
  const out: Ratio[] = [];
  for (const [place, p] of Object.entries(m.places(boxAlpha))) {
    for (const item of p.items) {
      let worst: Ratio | null = null;
      for (const state of [null, ...Object.keys(m.states)]) {
        for (const layers of [[...m.outer(state), ...p.layers], noSaturate([...m.outer(state), ...p.layers])]) {
          const w = ruleCheck(item.color, layers, item.kind);
          if (!worst || w.margin < worst.margin) {
            worst = { place, item: item.name, kind: item.kind, ratio: w.ratio, need: w.need, margin: w.margin, where: `${state ?? 'no wash'}, over ${w.backdrop}` };
          }
        }
      }
      out.push(worst!);
    }
  }
  return out;
}

/** The smallest --box-fill alpha (to 0.001) at which everything on a box passes; null if even an opaque box is not enough. */
export function requiredBoxAlpha(m: GlassModel): number | null {
  const ok = (a: number) => worstRatios(m, a).every((r) => r.margin >= 1);
  if (!ok(1)) return null;
  let lo = 0;
  let hi = 1;
  while (hi - lo > 0.001) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** A state's wash over flat grey #808080 (the screenshots' backdrop), glow left out. */
export function overGrey(s: SkyTokens): Rgba {
  return compose('#808080', [{ ...s.tint, a: s.alpha }]);
}

/** CIE76 colour difference (sRGB -> Lab, D65). */
export function deltaE(a: Rgba, b: Rgba): number {
  const lab = (c: Rgba) => {
    const [r, g, bl] = [c.r, c.g, c.b].map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1! - l2!, a1! - a2!, b1! - b2!);
}

export { compose, contrast };
