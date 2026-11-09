// The classic look changes with the weather and the time of day: one opaque background per look (skyLook in src/shared/sky.ts, the same 54 as the
// glass wash, and the midpoints of the blends), in the same colour family as the glass tint. Everything is computed exactly: the page is opaque, so
// there is no unknown desktop behind it. Text 4.5:1, graphics and large text 3:1, everywhere; every two groups in a phase at least CIE76 dE 5 apart,
// every two phases of a group at least 3. The model is tests/support/classicModel.ts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compose, contrast, type Rgba } from '../src/shared/contrast';
import { PHASES } from '../src/shared/phase';
import { SKIES, skyState } from '../src/shared/sky';
import { CLASSIC_NEED, CLASSIC_SHEET, DECORATIVE, classicCss, classicModel, classicRatios, classicSheet } from './support/classicModel';
import { deltaE, glassModel, lab } from './support/glassModel';

const css = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const charts = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'charts.ts'), 'utf8');
const model = classicModel(css, charts);
const ratios = classicRatios(model);
const LOOKS = SKIES.flatMap((s) => PHASES.map((p) => `${s}-${p}`));
const STATES = Object.keys(model.states); // the 54 looks and the 54 midpoints

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

describe('classic: one opaque background per look', () => {
  it('has the 54 looks and the 54 midpoints, and the weather codes map onto them', () => {
    expect(LOOKS).toHaveLength(54);
    expect(STATES).toHaveLength(108);
    for (const l of LOOKS) expect(model.states[l], l).toBeDefined();
    for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99, 1234]) {
      for (const p of PHASES) expect(model.states[skyState(code, p)], `${code} ${p}`).toBeDefined();
    }
  });

  it('every look is opaque (only the glow is translucent), and the .backdrop rule that draws them is the same as before', () => {
    for (const [name, s] of Object.entries(model.states)) {
      expect(s.sky1.a, name).toBe(1);
      expect(s.sky2.a, name).toBe(1);
      expect(s.glow.a, name).toBeLessThanOrEqual(0.2);
    }
    expect(classicCss(css)).not.toContain('body[data-sky');
    expect(classicCss(css)).toContain('linear-gradient(160deg, var(--sky-1), var(--sky-2) 60%)');
  });

  it('a dark gradient; the same colour family as the glass tint; the glow is the tint; noon is the lightest of a group and night the darkest', () => {
    const glass = glassModel(css, charts);
    for (const name of STATES) {
      const s = model.states[name]!;
      const { lightest, darkest } = model.backgrounds(s);
      expect(luminance(lightest), name).toBeLessThan(0.05); // dark: white text stays far above 4.5:1
      expect(luminance(darkest), name).toBeLessThan(luminance(s.sky1));
      const tint = glass.states[name]!.tint;
      expect([s.glow.r, s.glow.g, s.glow.b], name).toEqual([tint.r, tint.g, tint.b]);
    }
    const skyL = (n: string) => lab(model.states[n]!.sky1)[0];
    for (const sky of SKIES) {
      for (const p of PHASES) {
        if (p !== 'noon') expect(skyL(`${sky}-${p}`), `${sky} ${p}`).toBeLessThan(skyL(`${sky}-noon`));
        if (p !== 'night') expect(skyL(`${sky}-night`), `${sky} ${p}`).toBeLessThan(skyL(`${sky}-${p}`));
      }
      const [th, ts] = hsl(glass.states[`${sky}-noon`]!.tint);
      const [ch] = hsl(model.states[`${sky}-noon`]!.sky1);
      if (ts > 0.15) expect(Math.min(Math.abs(th - ch), 360 - Math.abs(th - ch)), `${sky}: hue ${ch.toFixed(0)} vs glass ${th.toFixed(0)}`).toBeLessThanOrEqual(25);
    }
  });

  it('every two groups in a phase are at least dE 5 apart and every two phases of a group at least 3 (at the lightest point); the closest pairs are printed', () => {
    const d = (x: string, y: string) => deltaE(model.backgrounds(model.states[x]!).lightest, model.backgrounds(model.states[y]!).lightest);
    const groups: { a: string; b: string; d: number }[] = [];
    const phases: { a: string; b: string; d: number }[] = [];
    for (const p of PHASES) SKIES.forEach((x, i) => SKIES.slice(i + 1).forEach((y) => groups.push({ a: `${x}-${p}`, b: `${y}-${p}`, d: d(`${x}-${p}`, `${y}-${p}`) })));
    for (const s of SKIES) PHASES.forEach((x, i) => PHASES.slice(i + 1).forEach((y) => phases.push({ a: `${s}-${x}`, b: `${s}-${y}`, d: d(`${s}-${x}`, `${s}-${y}`) })));
    groups.sort((x, y) => x.d - y.d);
    phases.sort((x, y) => x.d - y.d);
    console.log(`classic: closest groups ${groups[0]!.a} / ${groups[0]!.b} dE ${groups[0]!.d.toFixed(2)}; closest phases ${phases[0]!.a} / ${phases[0]!.b} dE ${phases[0]!.d.toFixed(2)}`);
    expect(groups[0]!.d).toBeGreaterThanOrEqual(5);
    expect(phases[0]!.d).toBeGreaterThanOrEqual(3);
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
    expect(ratios.length).toBeGreaterThan(108 * 50);
    expect(settings.length).toBe(108 * 18); // 18 items in 6 places, page or card behind, on 108 looks
  });

  it('the Settings panel has its own classic colours (1.7), and the glass panel keeps its own', () => {
    expect(classicSheet(css)).toEqual({ muted: '#cbd5e1', fill: 'rgba(13, 17, 27, 0.7)', tint: 'rgba(120, 145, 195, 0.14)', sheen: 'rgba(255, 255, 255, 0.08)' });
    // Scoped to "not glass": the rule is after the glass block, and the glass panel's own rule still sets its scrim.
    expect(css.indexOf(CLASSIC_SHEET)).toBeGreaterThan(css.indexOf('/* ---------- Look (v1.7)'));
    expect(css).toContain("html[data-material='glass'] .settings-sheet {\n    background: var(--settings-scrim);");
  });

  it('the muted text the old clear-day theme drew at 3.6:1 now passes 4.5:1 on every state', () => {
    const muted = ratios.filter((r) => r.item === 'muted text');
    expect(muted.length).toBe(108 * Object.values(model.places).filter((p) => p.items.some((i) => i.name === 'muted text')).length);
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
