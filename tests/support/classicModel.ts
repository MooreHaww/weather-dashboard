// The classic look (v1.7) as layers, read from styles.css: each weather state's opaque page background and what sits on
// it. Used by tests/classicLook.test.ts. The page background is opaque, so contrast is exact: no worst-case desktops.
// Each state's background is checked at its lightest point (--sky-1 under both glows at their peak: light text is
// hardest there) and at its darkest (--sky-2). Text needs 4.5:1; graphics and large text 3:1.
// Left out on purpose, as WCAG does: decorative and deliberately faint parts (DECORATIVE below) and disabled controls.

import { compose, contrast, parseColor, type Layer, type Rgba } from '../../src/shared/contrast';
import { tokensOf } from './glassModel';

export type ClassicKind = 'text' | 'graphic';
export const CLASSIC_NEED: Record<ClassicKind, number> = { text: 4.5, graphic: 3 };

/** Drawn faint on purpose (not information on their own), so not held to 3:1. */
export const DECORATIVE = [
  'dividers and card borders (--divider, --stroke)',
  'chart grid lines',
  'passed hours of the temperature chart (grey copies)',
  'rain bars of low chance and of passed hours',
  'the loading shimmer',
] as const;

export interface ClassicItem {
  name: string;
  color: string;
  kind: ClassicKind;
}
export interface ClassicPlace {
  layers: Layer[];
  items: ClassicItem[];
}
export interface ClassicState {
  sky1: Rgba;
  sky2: Rgba;
  glow: Rgba;
}

/** Everything before the glass block: the classic look. */
export function classicCss(css: string): string {
  return css.slice(0, css.indexOf('/* ---------- glass (v1.6)'));
}

const BLUE_GLOW = 'rgba(59, 130, 246, 0.08)'; // the .backdrop's second glow, the same in every state

export function classicModel(css: string, chartsSource: string) {
  const classic = classicCss(css);
  const root = tokensOf(classic, ':root');
  const states: Record<string, ClassicState> = {};
  for (const m of classic.matchAll(/body\[data-sky='([\w-]+)'\] \{/g)) {
    const t = tokensOf(classic, `body[data-sky='${m[1]}']`);
    states[m[1]!] = { sky1: parseColor(t['--sky-1']!), sky2: parseColor(t['--sky-2']!), glow: parseColor(t['--glow']!) };
  }

  /** The state's background at its lightest point and at its darkest. */
  const backgrounds = (s: ClassicState): { lightest: Rgba; darkest: Rgba } => ({
    lightest: compose(s.sky1, [s.glow, BLUE_GLOW]),
    darkest: s.sky2,
  });

  const series = (key: string) => new RegExp(`\\b${key}: '([^']+)'`).exec(chartsSource)![1]!;
  const axis = /Chart\.defaults\.color = '([^']+)'/.exec(chartsSource)![1]!;
  const T = (name: string, color: string): ClassicItem => ({ name, color, kind: 'text' });
  const G = (name: string, color: string): ClassicItem => ({ name, color, kind: 'graphic' });
  const text = root['--text']!;
  const muted = root['--muted']!;
  const accent = root['--accent']!;
  const link = root['--link'] ?? accent; // text links (1.7: their own token, a step lighter than the accent)
  const words = [T('text and numbers', text), T('muted text', muted)];
  const sat = (n: number): Layer => ({ saturate: n });

  const places: Record<string, ClassicPlace> = {
    'page (app name, sidebar titles, empty lines, footer)': { layers: [], items: [...words, T('"Clear" link and footer links', link)] },
    'sidebar row, hovered': { layers: [root['--card-hover']!], items: words },
    'Recent row, selected': { layers: ['rgba(96, 165, 250, 0.14)'], items: [...words, G('blue bar', accent)] },
    'Favorite row, selected': { layers: ['rgba(251, 191, 36, 0.1)'], items: [...words, G('gold bar', root['--gold']!)] },
    'Your location row, hovered': { layers: ['rgba(167, 139, 250, 0.08)'], items: words },
    'Your location row, selected': { layers: ['rgba(167, 139, 250, 0.1)'], items: [...words, G('purple bar', root['--location']!)] },
    'sidebar row icons': { layers: [], items: [G('sun icon', '#FFC83D'), G('cloud icon', '#E4EAF3')] },
    'search field': { layers: ['rgba(255, 255, 255, 0.06)'], items: [T('typed text', text), T('placeholder', muted), G('search icon', muted)] },
    'search field, hovered': { layers: ['rgba(255, 255, 255, 0.09)'], items: [T('typed text', text), T('placeholder', muted)] },
    'search results': { layers: ['rgba(20, 28, 46, 0.97)'], items: words },
    card: {
      layers: [root['--card']!],
      items: [
        ...words,
        T('link', link),
        T('"likely" rain text', '#9fd1ff'),
        T('chart axis labels', axis),
        G('temperature line', series('temperature')),
        G('feels-like line', series('feelsLike')),
        G('rain bar, highest chance', series('rain')),
        G('current-time dot', root['--temp']!),
        G('purple pin', root['--location']!),
        G('gold star', root['--gold']!),
        G('wind arrow', accent),
        G('sun icon', '#FFC83D'),
        G('cloud icon', '#E4EAF3'),
      ],
    },
    'forecast day, hovered': { layers: [root['--card']!, root['--card-hover']!], items: [...words, T('"wet" rain chance', '#9fd1ff')] },
    'forecast day, selected': {
      layers: [root['--card']!, 'rgba(96, 165, 250, 0.18)'],
      items: [...words, T("today's name", '#bfdbfe'), T('"wet" rain chance', '#9fd1ff')],
    },
    banner: { layers: ['rgba(251, 191, 36, 0.12)'], items: [T('message', '#fde68a')] },
    'consent card': { layers: [sat(1.6), 'rgba(30, 42, 70, 0.55)', 'rgba(255, 255, 255, 0.1)'], items: [...words, T('link', link)] },
    'update note': { layers: [sat(1.6), 'rgba(30, 42, 70, 0.55)'], items: words },
  };

  // The open Settings panel (1.7: its own classic rule, read from styles.css) over the blurred page, or over a card blurred
  // behind it. Its top is the lightest part: the tint's first stop and the sheen's peak both count.
  const sheet = classicSheet(css);
  const sheetWords = [T('text and numbers', text), T('muted text', sheet.muted)];
  for (const [under, behind] of [[[], ''], [[root['--card']!], ', over a card']] as [Layer[], string][]) {
    const base: Layer[] = [...under, sat(1.8), sheet.fill, sheet.tint, sheet.sheen];
    const section = [...base, 'rgba(255, 255, 255, 0.07)']; // .settings-section-body
    places[`Settings panel${behind}`] = { layers: base, items: [...sheetWords, G('close icon', text)] };
    places[`Settings section${behind}`] = { layers: section, items: sheetWords };
    places[`Settings option at rest${behind}`] = { layers: [...section, 'rgba(255, 255, 255, 0.06)'], items: [T('option', sheet.muted)] }; // .segmented
    places[`Settings option hovered${behind}`] = { layers: [...section, 'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.07)'], items: [T('option', text)] };
    places[`Settings button hovered${behind}`] = { layers: [...section, 'rgba(255, 255, 255, 0.14)'], items: [T('label', text)] }; // .button:hover
    places[`Settings "i" button hovered${behind}`] = { layers: [...section, 'rgba(255, 255, 255, 0.16)'], items: [T('"i"', text)] }; // .info-button:hover
  }

  return { states, backgrounds, places };
}

export type ClassicModel = ReturnType<typeof classicModel>;

export const CLASSIC_SHEET = "html:not([data-material='glass']) .settings-sheet";

/** The classic Settings panel's own colours (1.7), from its rule in the Look block at the end of styles.css. */
export function classicSheet(css: string): { muted: string; fill: string; tint: string; sheen: string } {
  const i = css.indexOf(`${CLASSIC_SHEET} {`);
  if (i < 0) throw new Error(`No rule for ${CLASSIC_SHEET}`);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  const one = (re: RegExp) => re.exec(body)?.[1] ?? (() => { throw new Error(`${re} not in ${CLASSIC_SHEET}`); })();
  return {
    muted: one(/--muted:\s*([^;]+);/),
    fill: one(/background-color:\s*([^;]+);/),
    sheen: one(/radial-gradient\([^,]+,\s*(rgba\([^)]+\))/),
    tint: one(/linear-gradient\(180deg,\s*(rgba\([^)]+\))/),
  };
}

export interface ClassicRatio {
  state: string;
  place: string;
  item: string;
  kind: ClassicKind;
  ratio: number;
  where: 'lightest' | 'darkest';
}

/** Every item in every place, per state, at the state's lightest and darkest point: the lower of the two. */
export function classicRatios(m: ClassicModel): ClassicRatio[] {
  const out: ClassicRatio[] = [];
  for (const [state, s] of Object.entries(m.states)) {
    const bg = m.backgrounds(s);
    for (const [place, p] of Object.entries(m.places)) {
      for (const item of p.items) {
        const light = contrast(item.color, compose(bg.lightest, p.layers));
        const dark = contrast(item.color, compose(bg.darkest, p.layers));
        out.push({ state, place, item: item.name, kind: item.kind, ratio: Math.min(light, dark), where: light <= dark ? 'lightest' : 'darkest' });
      }
    }
  }
  return out;
}
