import { describe, expect, it } from 'vitest';
import { effectiveStep, labelHours, labelIndices, LABEL_STEPS } from '../src/shared/labelStep';

// Test sizes: a label 40 px wide with a 4 px gap needs 44 px between neighbours (the app uses its own sizes).
const fit = (requested: number, spacing: number) => effectiveStep(requested, spacing, 40, 4);

describe('labelHours', () => {
  it('reads the setting as a number of hours', () => {
    expect([labelHours('3h'), labelHours('2h'), labelHours('1h')]).toEqual([3, 2, 1]);
  });
});

describe('effectiveStep (thinning)', () => {
  it('keeps the chosen step when the labels fit', () => {
    expect(fit(1, 44)).toBe(1);
    expect(fit(2, 22)).toBe(2);
    expect(fit(3, 15)).toBe(3);
  });

  it('is exact at the threshold: 44 px per label fits, 43.9 does not', () => {
    expect(fit(1, 44)).toBe(1);
    expect(fit(1, 43.9)).toBe(2);
    expect(fit(2, 22)).toBe(2);
    expect(fit(2, 21.9)).toBe(3);
    expect(fit(3, 14.67)).toBe(3);
    expect(fit(3, 14.6)).toBe(6);
  });

  it('hourly thins to every 2 hours, then every 3, then 6, then 12 as the card narrows', () => {
    const seen = [60, 40, 30, 20, 14, 10, 5, 1].map((spacing) => fit(1, spacing));
    expect(seen).toEqual([1, 2, 2, 3, 6, 6, 12, 12]);
  });

  it('never goes finer than the chosen step', () => {
    expect(fit(3, 1000)).toBe(3);
    expect(fit(2, 1000)).toBe(2);
  });

  it('only ever returns a listed step, and the step never shrinks as the card narrows', () => {
    for (const requested of [1, 2, 3]) {
      let last = 0;
      for (let spacing = 80; spacing > 0; spacing -= 0.5) {
        const step = fit(requested, spacing);
        expect(LABEL_STEPS as readonly number[]).toContain(step);
        expect(step).toBeGreaterThanOrEqual(last);
        last = step;
      }
    }
  });

  it('settles on the coarsest step when nothing fits', () => {
    expect(fit(1, 0)).toBe(12);
  });
});

describe('labelIndices', () => {
  it('is every n-th hour from the first, so spacing is always equal', () => {
    expect(labelIndices(24, 3)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    expect(labelIndices(24, 2)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
    expect(labelIndices(24, 1)).toHaveLength(24);
    expect(labelIndices(24, 12)).toEqual([0, 12]);
  });

  it('keeps every regular label: nothing near "now" is ever dropped', () => {
    for (const step of LABEL_STEPS) {
      const idx = labelIndices(24, step);
      expect(idx.every((i, k) => i === k * step)).toBe(true);
      expect(idx).toHaveLength(Math.ceil(24 / step));
    }
  });

  it('works on a short day (a DST day has 23 points)', () => {
    expect(labelIndices(23, 3)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
  });
});
