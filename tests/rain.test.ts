import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseColor } from '../src/shared/contrast';
import { dryBarStyle, intensity, RAIN_BLUES, RAIN_DRY, rainHourText, rainHoursForDay, rainSummary } from '../src/shared/rain';
import type { HourlySeries } from '../src/shared/types';

/** 48 hours starting 2026-10-17T00:00, with given probabilities for today's and tomorrow's hours. */
function hourly(today: Record<number, number | null>, tomorrow: Record<number, number> = {}, mm?: Record<number, number>): HourlySeries {
  const time: string[] = [];
  const precipitationProbability: (number | null)[] = [];
  for (let d = 0; d < 2; d++) {
    for (let h = 0; h < 24; h++) {
      time.push(`2026-10-${17 + d}T${String(h).padStart(2, '0')}:00`);
      const p = d === 0 ? today[h] : tomorrow[h];
      precipitationProbability.push(p === undefined ? 0 : p);
    }
  }
  return {
    time,
    precipitationProbability,
    ...(mm ? { precipitation: time.map((_, i) => mm[i] ?? 0) } : {}),
    temperature: time.map(() => 20),
    apparentTemperature: time.map(() => 19),
    weatherCode: time.map(() => 0),
    isDay: time.map(() => true),
  };
}

describe('intensity: from the mm of the hour', () => {
  it.each([
    [0, 'none'], [0.09, 'none'], [0.1, 'light'], [1.2, 'light'], [2.49, 'light'], [2.5, 'moderate'], [7.6, 'moderate'], [7.61, 'heavy'], [40, 'heavy'],
  ])('%f mm is %s', (mm, want) => {
    expect(intensity(mm)).toBe(want);
  });

  it('three blues from light to deep, the same as the legend', () => {
    const css = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
    for (const [k, c] of Object.entries(RAIN_BLUES)) expect(css).toContain(`.swatch-${k} { background: ${c}; }`);
    const lightness = (hex: string) => parseColor(hex).r + parseColor(hex).g + parseColor(hex).b;
    expect(lightness(RAIN_BLUES.light)).toBeGreaterThan(lightness(RAIN_BLUES.moderate));
    expect(lightness(RAIN_BLUES.moderate)).toBeGreaterThan(lightness(RAIN_BLUES.heavy));
  });
});

describe('the bar of a dry hour (amount known, under 0.1 mm)', () => {
  const h = (probability: number, mm: number | null, isPast = false) => ({ time: '2026-10-17T16:00', probability, mm, isPast });

  it('has one fixed faint fill and a 1 px outline, whatever the chance', () => {
    const want = { fill: RAIN_DRY.fill, outline: RAIN_DRY.outline, width: 1 };
    expect(dryBarStyle(h(90, 0))).toEqual(want);
    expect(dryBarStyle(h(5, 0))).toEqual(want);
    expect(dryBarStyle(h(90, 0.09))).toEqual(want);
    expect(parseColor(RAIN_DRY.fill).a).toBeLessThanOrEqual(0.1);
  });

  it('is not a blue: the outline and the fill cannot be read as one of the three', () => {
    for (const c of [RAIN_DRY.outline, RAIN_DRY.fill]) expect(Object.values(RAIN_BLUES)).not.toContain(c);
    const { r, b } = parseColor(RAIN_DRY.outline);
    expect(b - r).toBeLessThan(40);
  });

  it('does not apply to rain or to data with no amount, and those keep their own style', () => {
    expect(dryBarStyle(h(90, 0.1))).toBeNull();
    expect(dryBarStyle(h(90, 9))).toBeNull();
    expect(dryBarStyle(h(90, null))).toBeNull();
  });

  it('a 0% hour has no height, so no outline; a passed hour is fainter', () => {
    expect(dryBarStyle(h(0, 0))!.width).toBe(0);
    const past = dryBarStyle(h(90, 0, true))!;
    expect(parseColor(past.fill).a).toBeLessThan(parseColor(RAIN_DRY.fill).a);
    expect(past.outline).toBe(`${RAIN_DRY.outline}59`);
  });
});

describe('the headline: the chance and the amount (today)', () => {
  it('a low chance of light rain, as in the brief', () => {
    const s = rainSummary(hourly({ 6: 20 }, {}, { 6: 0.3 }), '2026-10-17T02:00');
    expect(s.text).toBe('20% chance of light rain around 6 AM · about 0.3 mm');
    expect(s).toMatchObject({ level: 'chance', at: '2026-10-17T06:00', probability: 20 });
  });

  it('dry: still says the highest chance', () => {
    const s = rainSummary(hourly({ 6: 5, 9: 3 }, {}, {}), '2026-10-17T02:00');
    expect(s.text).toBe('No rain expected · highest chance 5% at 6 AM');
    expect(s).toMatchObject({ level: 'none', at: null, probability: 5 });
  });

  it('heavy, and the first likely hour wins over a later bigger one', () => {
    const s = rainSummary(hourly({ 14: 40, 16: 70, 18: 90 }, {}, { 16: 9.4, 18: 20 }), '2026-10-17T10:15');
    expect(s.text).toBe('70% chance of heavy rain around 4 PM · about 9.4 mm');
    expect(s).toMatchObject({ level: 'likely', at: '2026-10-17T16:00', probability: 70 });
  });

  it('moderate, and "now" for the current hour', () => {
    expect(rainSummary(hourly({ 12: 80 }, {}, { 12: 3 }), '2026-10-17T12:45:10').text).toBe('80% chance of moderate rain now · about 3.0 mm');
  });

  it('a dry 90% hour does not count as rain: the dry headline, and it still names the highest chance', () => {
    const s = rainSummary(hourly({ 9: 90 }, {}, {}), '2026-10-17T08:00');
    expect(s.text).toBe('No rain expected · highest chance 90% at 9 AM');
    expect(s).toMatchObject({ level: 'none', at: null, probability: 90 });
  });

  it('0.09 mm is dry and 0.1 mm is rain', () => {
    expect(rainSummary(hourly({ 9: 90 }, {}, { 9: 0.09 }), '2026-10-17T08:00').level).toBe('none');
    expect(rainSummary(hourly({ 9: 90 }, {}, { 9: 0.1 }), '2026-10-17T08:00').text).toBe('90% chance of light rain around 9 AM · about 0.1 mm');
  });

  it('a 60% hour with 1.2 mm counts, also after a dry 90% hour', () => {
    const s = rainSummary(hourly({ 9: 90, 14: 60 }, {}, { 14: 1.2 }), '2026-10-17T08:00');
    expect(s.text).toBe('60% chance of light rain around 2 PM · about 1.2 mm');
    expect(s).toMatchObject({ level: 'likely', at: '2026-10-17T14:00', probability: 60 });
  });

  it('only dry high-chance hours give the dry headline', () => {
    const s = rainSummary(hourly({ 9: 90, 12: 70, 15: 55 }, {}, { 9: 0, 12: 0.05, 15: 0.02 }), '2026-10-17T08:00');
    expect(s.text).toBe('No rain expected · highest chance 90% at 9 AM');
    expect(s.level).toBe('none');
  });

  it('a dry hour with a real chance does not count at lower chances either; a low chance with an amount still does', () => {
    expect(rainSummary(hourly({ 15: 35 }, {}, {}), '2026-10-17T10:00').text).toBe('No rain expected · highest chance 35% at 3 PM');
    const s = rainSummary(hourly({ 11: 40, 15: 20 }, {}, { 15: 0.3 }), '2026-10-17T10:00');
    expect(s.text).toBe('20% chance of light rain around 3 PM · about 0.3 mm');
    expect(s.level).toBe('chance');
  });

  it('the chance alone when the data has no amounts (old data)', () => {
    const old = hourly({ 16: 70 });
    expect(old.precipitation).toBeUndefined();
    expect(rainSummary(old, '2026-10-17T10:15').text).toBe('70% chance of rain around 4 PM');
    expect(rainSummary(hourly({ 15: 35 }), '2026-10-17T10:00').text).toBe('35% chance of rain around 3 PM');
    expect(rainSummary(hourly({ 3: 5 }), '2026-10-17T01:00').text).toBe('No rain expected · highest chance 5% at 3 AM');
    expect(rainSummary(hourly({ 9: 90, 14: 60 }), '2026-10-17T08:00')).toMatchObject({ level: 'likely', at: '2026-10-17T09:00', text: '90% chance of rain around 9 AM' });
  });

  it('12 and 24 hours', () => {
    const wet = hourly({ 16: 70 }, {}, { 16: 1.2 });
    expect(rainSummary(wet, '2026-10-17T10:15', undefined, '24h').text).toBe('70% chance of light rain around 16:00 · about 1.2 mm');
    expect(rainSummary(wet, '2026-10-17T10:15', undefined, '12h').text).toBe('70% chance of light rain around 4 PM · about 1.2 mm');
    expect(rainSummary(hourly({ 6: 5 }, {}, {}), '2026-10-17T02:00', undefined, '24h').text).toBe('No rain expected · highest chance 5% at 06:00');
    const dry = hourly({ 9: 90 }, {}, {});
    expect(rainSummary(dry, '2026-10-17T08:00', undefined, '24h').text).toBe('No rain expected · highest chance 90% at 09:00');
    expect(rainSummary(dry, '2026-10-17T08:00', undefined, '12h').text).toBe('No rain expected · highest chance 90% at 9 AM');
  });

  it('ignores hours that have already passed', () => {
    const s = rainSummary(hourly({ 8: 95, 20: 10 }, {}, { 8: 9 }), '2026-10-17T12:00');
    expect(s.level).toBe('none');
    expect(s.text).toBe('No rain expected · highest chance 10% at 8 PM');
  });

  it('does not look into tomorrow', () => {
    expect(rainSummary(hourly({}, { 3: 100 }), '2026-10-17T22:00').level).toBe('none');
  });

  it('treats missing probabilities as 0', () => {
    expect(rainSummary(hourly({ 13: null, 14: null }), '2026-10-17T12:00').level).toBe('none');
  });

  it('no hours at all', () => {
    expect(rainSummary(hourly({}), '2026-11-01T12:00').text).toBe('No rain expected');
  });
});

describe('the headline (another day)', () => {
  it('counts the whole day, including early hours', () => {
    const s = rainSummary(hourly({}, { 3: 60, 16: 90 }, { 27: 0.8 }), '2026-10-17T22:00', '2026-10-18');
    expect(s).toMatchObject({ level: 'likely', at: '2026-10-18T03:00' });
    expect(s.text).toBe('60% chance of light rain around 3 AM · about 0.8 mm');
  });

  it('never says "now" for a future day, even at the same clock hour', () => {
    expect(rainSummary(hourly({}, { 12: 80 }), '2026-10-17T12:30', '2026-10-18').text).toBe('80% chance of rain around 12 PM');
  });

  it('the same rule on another day: its early hours count, dry ones do not', () => {
    // Index 24 + h is hour h of tomorrow.
    const s = rainSummary(hourly({}, { 3: 90, 14: 60 }, { 38: 1.2 }), '2026-10-17T22:00', '2026-10-18');
    expect(s.text).toBe('60% chance of light rain around 2 PM · about 1.2 mm');
    expect(rainSummary(hourly({}, { 3: 90 }, {}), '2026-10-17T22:00', '2026-10-18').text).toBe('No rain expected · highest chance 90% at 3 AM');
  });

  it('dry on another day', () => {
    expect(rainSummary(hourly({ 20: 90 }, { 5: 10 }), '2026-10-17T08:00', '2026-10-18').text).toBe('No rain expected · highest chance 10% at 5 AM');
  });
});

describe('one hour in words (the tooltip)', () => {
  const h = (mm: number | null) => ({ time: '2026-10-17T16:00', probability: 70, mm, isPast: false });
  it('gives the hour, chance, amount and intensity', () => {
    expect(rainHourText(h(1.2))).toBe('4 PM · 70% chance · 1.2 mm · light');
    expect(rainHourText(h(1.2), '24h')).toBe('16:00 · 70% chance · 1.2 mm · light');
    expect(rainHourText(h(0))).toBe('4 PM · 70% chance · 0.0 mm · none');
    expect(rainHourText(h(10))).toBe('4 PM · 70% chance · 10.0 mm · heavy');
  });
  it('gives the chance only without an amount', () => {
    expect(rainHourText(h(null))).toBe('4 PM · 70% chance');
  });
});

describe('rainHoursForDay', () => {
  it('returns today’s 24 hours and marks past ones', () => {
    const hours = rainHoursForDay(hourly({ 5: 20 }), '2026-10-17', '2026-10-17T06:30');
    expect(hours).toHaveLength(24);
    expect(hours[5]).toEqual({ time: '2026-10-17T05:00', probability: 20, mm: null, isPast: true });
    expect(hours[6]!.isPast).toBe(false);
  });

  it('returns another day’s hours with none in the past', () => {
    const hours = rainHoursForDay(hourly({}, { 7: 40 }), '2026-10-18', '2026-10-17T23:00');
    expect(hours).toHaveLength(24);
    expect(hours.every((h) => h.time.startsWith('2026-10-18') && !h.isPast)).toBe(true);
    expect(hours[7]!.probability).toBe(40);
  });
});
