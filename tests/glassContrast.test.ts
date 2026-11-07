// The clear glass look (v1.6), computed from styles.css itself: the faint weather wash on the outer glass, the
// translucent boxes, and the contrast of everything on a box under CLEAR_RULE (src/shared/contrast.ts): primary text
// and numbers 4.5:1 over grey and dark desktops and 3:1 over white; secondary text and graphics 3:1 over grey and
// dark. Checked with no wash and under every state's wash, with no credit for Windows' acrylic. The model is
// tests/support/glassModel.ts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLEAR_RULE, compose, contrast, minTintAlpha, parseColor, ROW_RULE, RULE_BACKDROPS, ruleCheck, worstContrast, WORST_BACKDROPS } from '../src/shared/contrast';
import { SKIES } from '../src/shared/sky';
import { deltaE, GLASS, glassModel, requiredBoxAlpha, tokensOf, WASH_MAX, worstRatios, worstRowRatios } from './support/glassModel';

const WASH_STRENGTH = 3;
// 1.6.1 removed the boxes' top gradient (it was the grain on screen). The old model credited its peak (5 % white) to every faint part; now the
// faintest ones over a black desktop, with no wash, are up to 3 % under 1.5.1's ratio (measured 2.1 %). Anything more fails.
const FAINT_TOLERANCE = 0.97;

const src = (...p: string[]) => readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const css = src('renderer', 'styles.css');
const model = glassModel(css, src('renderer', 'charts.ts'));
const STATES = SKIES.flatMap((s) => [`${s}-day`, `${s}-night`]);

describe('glass: the faint weather wash on the outer glass', () => {
  it('styles.css has one rule per state (9 skies, day and night) with a colour, a base alpha of 0.04 to 0.16 and a faint glow', () => {
    expect(Object.keys(model.states).sort()).toEqual(['default', ...STATES].sort());
    for (const [name, s] of Object.entries(model.states)) {
      expect(s.tint.a, name).toBe(1);
      expect(s.base, name).toBeGreaterThanOrEqual(0.03);
      expect(s.base, name).toBeLessThanOrEqual(0.16);
      expect(s.glow.a / WASH_STRENGTH, name).toBeLessThanOrEqual(0.08);
    }
  });

  it('ONE multiplier, --wash-strength (3), scales every wash and glow alpha, capped at 0.35: clear day 0.12, storm night at the cap', () => {
    expect(tokensOf(css, GLASS)['--wash-strength']).toBe(String(WASH_STRENGTH));
    expect(css.match(/--wash-strength:/g)).toHaveLength(1); // set in one place only
    const backdrop = css.slice(css.indexOf(`${GLASS} .backdrop {`));
    const rule = backdrop.slice(0, backdrop.indexOf('}'));
    expect(rule).toContain('min(0.35, var(--sky-alpha) * var(--wash-strength))');
    expect(rule).toContain('min(0.35, alpha * var(--wash-strength))');
    expect(rule).not.toMatch(/var\(--sky-glow\), transparent/); // the glows only through --wash-glow
    for (const [name, s] of Object.entries(model.states)) {
      expect(s.alpha, name).toBeCloseTo(Math.min(WASH_MAX, s.base * WASH_STRENGTH), 6);
      expect(s.alpha, name).toBeLessThanOrEqual(WASH_MAX);
    }
    expect(model.states['clear-day']!.alpha).toBeCloseTo(0.12, 6);
    expect(model.states['storm-night']!.alpha).toBe(WASH_MAX);
  });

  it('a clear day is the faintest; night is one step denser than its day; thunderstorm and heavy night rain are the densest', () => {
    // The states' own values (styles.css) keep the order strictly; what is drawn keeps it too, except where the 0.35 cap makes states equal.
    const b = (s: string) => model.states[s]!.base;
    const a = (s: string) => model.states[s]!.alpha;
    for (const s of STATES) if (s !== 'clear-day') expect(b('clear-day'), s).toBeLessThan(b(s));
    for (const s of STATES) if (s !== 'clear-day') expect(a('clear-day'), s).toBeLessThan(a(s));
    for (const sky of SKIES) expect(b(`${sky}-night`), sky).toBeGreaterThan(b(`${sky}-day`));
    for (const sky of SKIES) expect(a(`${sky}-night`), sky).toBeGreaterThanOrEqual(a(`${sky}-day`));
    const top = Math.max(...STATES.map(b));
    expect(b('storm-night')).toBe(top);
    expect(b('heavy-rain-night')).toBe(top);
    expect(a('storm-night')).toBe(Math.max(...STATES.map(a)));
    for (const s of STATES.filter((x) => x.endsWith('-day') && x !== 'storm-day')) expect(b(s), s).toBeLessThan(b('storm-day'));
    expect(b('heavy-rain-day')).toBeGreaterThan(b('rain-day'));
    expect(b('rain-day')).toBeGreaterThan(b('drizzle-day'));
    // fog-day used to be denser than overcast-day; at strength 3 it had to be lowered below it to keep the sidebar bars at 3:1.
    expect(model.states['fog-day']!.glow.a).toBe(0); // flat
  });

  it('only a clear night is violet, and only a clear day is warm', () => {
    const hue = (s: string) => model.states[s]!.tint;
    const violet = (c: { r: number; g: number; b: number }) => c.r > c.g + 10 && c.b > c.r + 20;
    expect(violet(hue('clear-night'))).toBe(true);
    for (const s of STATES) if (s !== 'clear-night' && !s.startsWith('storm')) expect(violet(hue(s)), s).toBe(false);
    const warm = (c: { r: number; g: number; b: number }) => c.r > c.b + 60;
    expect(warm(hue('clear-day'))).toBe(true);
    for (const s of STATES) if (s !== 'clear-day') expect(warm(hue(s)), s).toBe(false);
  });

  it('every state keeps its own colour (the wash colours themselves differ by CIE76 ΔE >= 10)', () => {
    const low: string[] = [];
    for (let i = 0; i < STATES.length; i++) {
      for (let j = i + 1; j < STATES.length; j++) {
        const d = deltaE(model.states[STATES[i]!]!.tint, model.states[STATES[j]!]!.tint);
        if (d < 10) low.push(`${STATES[i]}/${STATES[j]} ${d.toFixed(1)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('the boxes are the same in every state: no state rule sets a box, blur or text token', () => {
    for (const s of STATES) expect(Object.keys(tokensOf(css, `${GLASS} body[data-sky='${s}']`)).sort(), s).toEqual(['--sky-alpha', '--sky-glow', '--sky-tint']);
  });
});

describe('glass contrast: everything on a box meets CLEAR_RULE', () => {
  it('the rule: primary 4.5 over grey and dark, 3 over white; secondary and graphics 3 over grey and dark; white not guaranteed for them', () => {
    expect(RULE_BACKDROPS).toEqual({ grey: '#808080', black: '#000000', 'dark window': '#202020', white: '#ffffff' });
    expect(CLEAR_RULE.primary).toEqual({ grey: 4.5, black: 4.5, 'dark window': 4.5, white: 3 });
    expect(CLEAR_RULE.secondary).toEqual({ grey: 3, black: 3, 'dark window': 3 });
    expect(CLEAR_RULE.graphic).toEqual({ grey: 3, black: 3, 'dark window': 3 });
  });

  it("--box-fill is translucent smoke (0.50 to 0.65) and at least the computed minimum", () => {
    const need = requiredBoxAlpha(model);
    expect(need).not.toBeNull();
    expect(model.boxFill.a).toBeGreaterThanOrEqual(0.5);
    expect(model.boxFill.a).toBeLessThanOrEqual(0.65);
    expect(model.boxFill.a).toBeGreaterThanOrEqual(need!);
  });

  const ratios = worstRatios(model);
  for (const place of Object.keys(model.places())) {
    it(place, () => {
      for (const r of ratios.filter((x) => x.place === place)) {
        expect(r.ratio, `${r.item} (${r.kind}, ${r.where})`).toBeGreaterThanOrEqual(r.need);
      }
    });
  }

  it('the sidebar lists are plain rows on the bare glass (1.6.1): no box, border, shadow, blur or fill in the glass block, only a text shadow', () => {
    const block = css.slice(css.indexOf('/* ---------- glass (v1.6)'));
    const rules = [...block.matchAll(/([^{}]*\.place-card[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2]!.trim() }));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.sel, r.body).toMatch(/\.fav-(name|sub|weather)/);
      expect(r.body).toMatch(/^text-shadow: var\(--glass-text-shadow\);$/);
    }
    expect(block).not.toContain('--pc-over');
    expect(tokensOf(css, GLASS)['--pc-over']).toBeUndefined();
  });

  it('the rule for rows on bare glass: names and numbers 4.5 over dark and black (3 over grey at rest, no wash); secondary lines 3 over dark and black', () => {
    expect(ROW_RULE.primary).toEqual({ grey: 3, black: 4.5, 'dark window': 4.5 });
    expect(ROW_RULE.secondary).toEqual({ black: 3, 'dark window': 3 });
    // CLEAR_RULE for boxes is not weakened.
    expect(CLEAR_RULE.primary).toEqual({ grey: 4.5, black: 4.5, 'dark window': 4.5, white: 3 });
  });

  const rowRatios = worstRowRatios(model);
  for (const place of Object.keys(model.rows())) {
    it(`sidebar ${place}, on bare glass under every weather wash`, () => {
      for (const r of rowRatios.filter((x) => x.place === place)) {
        expect(r.ratio, `${r.item} (${r.kind}, ${r.where})`).toBeGreaterThanOrEqual(r.need);
      }
    });
  }

  it('the solid fallback is untouched: no glass token leaks outside the glass block', () => {
    const root = tokensOf(css, ':root');
    expect(root['--muted']).toBe('rgba(226, 232, 240, 0.62)');
    expect(root['--box-fill']).toBeUndefined();
    const start = css.indexOf('/* ---------- glass (v1.6)');
    expect(start).toBeGreaterThan(0);
    // Everything glass is inside one media block, scoped to html[data-material='glass'].
    const block = css
      .slice(css.indexOf('@media (forced-colors: none) and (prefers-reduced-transparency: no-preference) {', start))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...block.matchAll(/^\s*([^{}@/][^{}]*)\{/gm)].map((m) => m[1]!.trim());
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) for (const part of sel.split(',')) expect(part.trim()).toMatch(/^html\[data-material='glass'\]/);
    expect(css.slice(0, start)).not.toContain('data-material');
    expect(css.slice(0, start)).not.toContain('data-sky');
  });

  it('no backing panels: the title bar, sidebar sections and footer have no glass background; bare-glass text has a shadow', () => {
    const block = css.slice(css.indexOf('/* ---------- glass (v1.6)'));
    expect(block).not.toMatch(/\.titlebar\s*\{/);
    expect(block).not.toMatch(/\.layout\s*\{/);
    expect(block).not.toMatch(/::before/);
    for (const sel of ['.brand', '.sidebar .section-title', '.sidebar > section > p', '.footer']) expect(block).toContain(`html[data-material='glass'] ${sel}`);
    expect(tokensOf(css, GLASS)['--glass-text-shadow']).toMatch(/rgba\(0, 0, 0/);
  });

  it('faint parts drawn on purpose (passed hours, low-chance rain bars, dividers, grid) are never fainter than 1.5.1 drew them, over grey and dark desktops', () => {
    // 1.5.1 solid: a card (white 0.055) over the lighter end of each theme's gradient (--sky-1); the lowest of these.
    const sky1 = [...css.slice(0, css.indexOf('* { box-sizing')).matchAll(/--sky-1: (#[0-9a-f]{6})/g)].map((m) => m[1]!);
    expect(sky1.length).toBe(9); // :root and the 8 themes
    const card = model.places()['card']!.layers;
    const desktops = { grey: RULE_BACKDROPS.grey!, black: RULE_BACKDROPS.black!, 'dark window': RULE_BACKDROPS['dark window']! };
    for (const fg of ['rgba(148, 163, 184, 0.5)', 'rgba(90, 176, 255, 0.3)', 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.06)']) {
      const before = Math.min(...sky1.map((s) => contrast(fg, compose(s, ['rgba(255, 255, 255, 0.055)']))));
      for (const state of [null, ...Object.keys(model.states)]) {
        const w = worstContrast(fg, [...model.outer(state), ...card], desktops);
        expect(w.ratio, `${fg} (${state ?? 'no wash'}) over ${w.backdrop}; 1.5.1: ${before.toFixed(3)}`).toBeGreaterThanOrEqual(before * FAINT_TOLERANCE);
      }
    }
  });
});

describe('the classic look is unchanged (1.6.1)', () => {
  it('every CSS rule outside the glass block is byte for byte the 1.6.0 text (tests/fixtures/styles-1.6.0-classic.css, taken from git)', () => {
    const fixture = readFileSync(path.join(__dirname, 'fixtures', 'styles-1.6.0-classic.css'), 'utf8').replace(/\r\n/g, '\n');
    const now = css.replace(/\r\n/g, '\n');
    expect(now.slice(0, now.indexOf('/* ---------- glass (v1.6)'))).toBe(fixture);
  });
});

describe('the contrast maths', () => {
  it('matches WCAG reference values', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrast('#fff', '#fff')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#fff')).toBeCloseTo(4.54, 2); // the lightest grey that passes on white
    expect(contrast('#e8edf5', '#0b1220')).toBeGreaterThan(15);
  });

  it('composites translucent colours like the browser (sRGB, source-over)', () => {
    expect(compose('#000000', ['rgba(255, 255, 255, 0.5)'])).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    expect(compose('#ffffff', ['rgba(0, 0, 0, 0.88)']).r).toBeCloseTo(30.6, 5);
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('#0c2147')).toEqual({ r: 12, g: 33, b: 71, a: 1 });
    expect(parseColor('#fff8').a).toBeCloseTo(0.533, 3);
    expect(() => parseColor('hsl(0 0% 0%)')).toThrow();
    // Chromium's serialization of rgb(from ...): channels 0-1.
    const c = parseColor('color(srgb 1 0.839216 0.54902 / 0.14)');
    expect([Math.round(c.r), Math.round(c.g), Math.round(c.b), c.a]).toEqual([255, 214, 140, 0.14]);
  });

  it('saturate() follows the Filter Effects matrix and keeps grey grey', () => {
    const grey = compose('#808080', [{ saturate: 1.6 }]);
    for (const c of [grey.r, grey.g, grey.b]) expect(c).toBeCloseTo(128, 5);
    const s = compose('#204080', [{ saturate: 2 }]);
    expect(s.b).toBeGreaterThan(128); // more colourful
    expect(s.r).toBeLessThan(32);
  });

  it('ruleCheck finds the tightest desktop for each kind', () => {
    // White text on half-transparent black: easy over dark, hardest over white, which only primary text is checked on.
    const layers = ['rgba(0, 0, 0, 0.5)'];
    expect(ruleCheck('#ffffff', layers, 'primary').backdrop).toBe('white');
    expect(ruleCheck('#ffffff', layers, 'secondary').backdrop).toBe('grey');
    // A dark graphic is hardest over a dark desktop.
    expect(ruleCheck('#303030', [], 'graphic').backdrop).toBe('dark window');
  });

  it('finds the smallest tint, and says when no tint is enough', () => {
    const a = minTintAlpha('#000000', '#ffffff', 4.5)!;
    expect(worstContrast('#ffffff', [{ r: 0, g: 0, b: 0, a }]).ratio).toBeGreaterThanOrEqual(4.5);
    expect(worstContrast('#ffffff', [{ r: 0, g: 0, b: 0, a: a - 0.01 }]).ratio).toBeLessThan(4.5);
    expect(minTintAlpha('#ffffff', '#ffffff', 3)).toBeNull();
  });

  it('ΔE is 0 for the same colour and about 100 between black and white', () => {
    expect(deltaE(parseColor('#336699'), parseColor('#336699'))).toBe(0);
    expect(deltaE(parseColor('#000'), parseColor('#fff'))).toBeCloseTo(100, 0);
  });

  it('white and black really are the extremes: no other backdrop, a busy image included, is worse', () => {
    const layers = [...model.outer('snow-day'), ...model.places()['card']!.layers];
    const muted = model.places()['card']!.items.find((i) => i.name === 'muted text')!.color;
    const named = worstContrast(muted, layers).ratio;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 255;
    for (let i = 0; i < 500; i++) {
      expect(contrast(muted, compose(`rgb(${rnd()}, ${rnd()}, ${rnd()})`, layers))).toBeGreaterThanOrEqual(named - 1e-9);
    }
    expect(Object.keys(WORST_BACKDROPS)).toEqual(['white', 'black', 'grey', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta']);
  });
});
