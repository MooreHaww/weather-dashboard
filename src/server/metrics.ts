// Response-time tracking for the API, split by cache status, so the app can
// report a measured number (served live at /api/stats).

import type { CacheStatus } from '../shared/types';

const WINDOW = 500;

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  mean: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function summarize(samples: number[]): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    count: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    mean: round(mean),
  };
}

export class Metrics {
  private samples: Record<CacheStatus, number[]> = { HIT: [], MISS: [], STALE: [] };

  record(status: CacheStatus, ms: number): void {
    const list = this.samples[status];
    list.push(ms);
    if (list.length > WINDOW) list.shift();
  }

  summary(): Record<CacheStatus, LatencySummary> {
    return {
      HIT: summarize(this.samples.HIT),
      MISS: summarize(this.samples.MISS),
      STALE: summarize(this.samples.STALE),
    };
  }
}
