// How often the hourly strip under the temperature chart shows a label.

import type { TempLabels } from './types';

/** Steps (hours between labels) the strip may use, finest first. Thinning walks this list in order. */
export const LABEL_STEPS = [1, 2, 3, 6, 12] as const;

/** The setting's value as a number of hours: "2h" → 2. */
export function labelHours(setting: TempLabels): number {
  return Number(setting.slice(0, -1));
}

/**
 * The step to actually use: the chosen one if the labels fit, else the next
 * step up the list (hourly → 2 → 3 → 6 → 12), so the labels thin out evenly
 * and every shown label sits a whole number of steps from the first.
 * `spacingPx` is the distance between two neighbouring hours on the chart.
 */
export function effectiveStep(requested: number, spacingPx: number, itemWidthPx: number, gapPx: number): number {
  const need = itemWidthPx + gapPx;
  for (const step of LABEL_STEPS) {
    if (step >= requested && step * spacingPx >= need) return step;
  }
  return LABEL_STEPS[LABEL_STEPS.length - 1];
}

/** Hours (0-based indices) that get a label: every `step`-th one, starting at the first. */
export function labelIndices(count: number, step: number): number[] {
  return Array.from({ length: count }, (_, i) => i).filter((i) => i % step === 0);
}
