// v1.7: the classic look changes with the weather and the time of day. One opaque background per skyState (the same 18
// states as the glass wash), in the same colour family as the glass tint. Everything is computed exactly: the page is
// opaque, so there is no unknown desktop behind it. Text 4.5:1, graphics and large text 3:1, on every state; every two
// states at least CIE76 dE 5 apart. The model (tests/support/classicModel.ts) reads the numbers from styles.css.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compose, contrast, type Rgba } from '../src/shared/contrast';
import { SKIES, skyState } from '../src/shared/sky';
import { CLASSIC_NEED, CLASSIC_SHEET, DECORATIVE, classicCss, classicModel, classicRatios, classicSheet } from './support/classicModel';
import { deltaE, glassModel } from './support/glassModel';

const css = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const charts = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'charts.ts'), 'utf8');
const model = classicModel(css, charts);
const ratios = classicRatios(model);
const STATES = SKIES.flatMap((s) => [`${s}-day`, `${s}-night`]);

const luminance = (c: Rgba) => {
  const f = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const hsl = (c: Rgba): [number, number] => {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s];
};

describe('classic: one background per weather state', () => {
  it('has exactly the 18 skyState states, each a rule of its own, and the weather codes map onto them', () => {
    expect(Object.keys(model.states).sort()).toEqual([...STATES].sort());
    expect(skyState(0, true)).toBe('clear-day');
    expect(skyState(2, false)).toBe('partly-night');
    expect(skyState(45, true)).toBe('fog-day');
    expect(skyState(61, true)).toBe('drizzle-day');
    expect(skyState(63, false)).toBe('rain-night');
    expect(skyState(82, true)).toBe('heavy-rain-day');
    expect(skyState(95, false)).toBe('storm-night');
    expect(skyState(73, true)).toBe('snow-day');
    expect(skyState(1234, true)).toBe('overcast-day'); // unknown codes
    for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99]) {
      for (const day of [true, false]) expect(model.states[skyState(code, day)], `${code} ${day}`).toBeDefined();
    }
  });

  it('every state is opaque (only the glow is translucent) and sets nothing but the page gradient', () => {
    for (const [name, s] of Object.entries(model.states)) {
      expect(s.sky1.a, name).toBe(1);
      expect(s.sky2.a, name).toBe(1);
      expect(s.glow.a, name).toBeLessThanOrEqual(0.2);
    }
    for (const m of classicCss(css).matchAll(/body\[data-sky='([\w-]+)'\] \{([^}]*)\}/g)) {
      expect([...m[2]!.matchAll(/(--[\w-]+):/g)].map((x) => x[1]), m[1]).toEqual(['--sky-1', '--sky-2', '--glow']);
    }
    // The .backdrop rule that draws them is the same as before.
    expect(classicCss(css)).toContain('linear-gradient(160deg, var(--sky-1), var(--sky-2) 60%)');
  });

  it('a dark gradient in the same colour family as the glass tint; each night darker than its day', () => {
    const glass = glassModel(css, charts);
    for (const name of STATES) {
      const s = model.states[name]!;
      const { lightest, darkest } = model.backgrounds(s);
      expect(luminance(lightest), name).toBeLessThan(0.05); // dark: white text stays far above 4.5:1
      expect(luminance(darkest), name).toBeLessThan(luminance(s.sky1));
      const tint = glass.states[name]!.tint;
      const [th, ts] = hsl(tint);
      const [ch] = hsl(s.sky1);
      if (ts > 0.15) {
        const diff = Math.min(Math.abs(th - ch), 360 - Math.abs(th - ch));
        expect(diff, `${name}: hue ${ch.toFixed(0)} vs glass ${th.toFixed(0)}`).toBeLessThanOrEqual(15);
      }
      // The glow is the glass tint's own colour.
      expect([s.glow.r, s.glow.g, s.glow.b], name).toEqual([tint.r, tint.g, tint.b]);
      if (name.endsWith('-night')) {
        const day = model.states[name.replace('-night', '-day')]!;
        expect(luminance(model.backgrounds(s).lightest), name).toBeLessThan(luminance(model.backgrounds(day).lightest));
      }
    }
  });

  it('every two states are at least dE 5 apart (CIE76, at the lightest point); the closest pair is printed', () => {
    const pairs: { a: string; b: string; d: number }[] = [];
    for (let i = 0; i < STATES.length; i++) {
      for (let j = i + 1; j < STATES.length; j++) {
        const a = STATES[i]!, b = STATES[j]!;
        pairs.push({ a, b, d: deltaE(model.backgrounds(model.states[a]!).lightest, model.backgrounds(model.states[b]!).lightest) });
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    console.log(`classic: closest states ${pairs[0]!.a} / ${pairs[0]!.b}, dE ${pairs[0]!.d.toFixed(2)} (${pairs.length} pairs)`);
    expect(pairs).toHaveLength(153);
    expect(pairs[0]!.d).toBeGreaterThanOrEqual(5);
  });
});

describe('classic contrast, computed exactly on every state', () => {
  for (const place of Object.keys(model.places)) {
    it(`${place}: text 4.5:1, graphics 3:1`, () => {
      for (const r of ratios.filter((x) => x.place === place)) {
        expect(r.ratio, `${r.state}: ${r.item} (${r.kind}, ${r.where})`).toBeGreaterThanOrEqual(CLASSIC_NEED[r.kind]);
      }
    });
  }

  it('the lowest numbers are reported, for the page and for the Settings panel', () => {
    const low = (kind: 'text' | 'graphic', list = ratios) => list.filter((r) => r.kind === kind).sort((a, b) => a.ratio - b.ratio)[0]!;
    const fmt = (r: (typeof ratios)[number]) => `${r.ratio.toFixed(2)} (${r.item}, ${r.place}, ${r.state})`;
    const settings = ratios.filter((r) => r.place.startsWith('Settings'));
    console.log(`classic: lowest text ${fmt(low('text'))}; lowest graphic ${fmt(low('graphic'))}; Settings text lowest ${fmt(low('text', settings))}`);
    expect(ratios.length).toBeGreaterThan(18 * 50);
    expect(settings.length).toBe(18 * 18); // 18 items in 6 places, page or card behind, on 18 states
  });

  it('the Settings panel has its own classic colours (1.7), and the glass panel keeps its own', () => {
    expect(classicSheet(css)).toEqual({ muted: '#cbd5e1', fill: 'rgba(13, 17, 27, 0.7)', tint: 'rgba(120, 145, 195, 0.14)', sheen: 'rgba(255, 255, 255, 0.08)' });
    // Scoped to "not glass": the rule is after the glass block, and the glass panel's own rule still sets its scrim.
    expect(css.indexOf(CLASSIC_SHEET)).toBeGreaterThan(css.indexOf('/* ---------- Look (v1.7)'));
    expect(css).toContain("html[data-material='glass'] .settings-sheet {\n    background: var(--settings-scrim);");
  });

  it('the muted text the old clear-day theme drew at 3.6:1 now passes 4.5:1 on every state', () => {
    const muted = ratios.filter((r) => r.item === 'muted text');
    expect(muted.length).toBe(18 * Object.values(model.places).filter((p) => p.items.some((i) => i.name === 'muted text')).length);
    for (const r of muted) expect(r.ratio, `${r.state} ${r.place}`).toBeGreaterThanOrEqual(4.5);
    // 1.6.1's clear-day page, for the record: muted 0.62 over #1f4f8f under its 0.22 gold glow, on a hovered row.
    const old = compose('#1f4f8f', ['rgba(255, 196, 77, 0.22)', 'rgba(59, 130, 246, 0.08)', 'rgba(255, 255, 255, 0.085)']);
    expect(contrast('rgba(226, 232, 240, 0.62)', old)).toBeLessThan(4.5);
  });

  it('leaves out only the decorative parts, by name', () => {
    expect([...DECORATIVE]).toEqual([
      'dividers and card borders (--divider, --stroke)',
      'chart grid lines',
      'passed hours of the temperature chart (grey copies)',
      'rain bars of low chance and of passed hours',
      'the loading shimmer',
    ]);
  });
});
