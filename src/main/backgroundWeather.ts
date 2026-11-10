// The tray's weather (v1.9): loaded by the main process about every 10 minutes through the local server's cache,
// whether or not the window is shown. Kept free of Electron imports so it can be unit-tested.
// A failure keeps the last value and says nothing; the next tick tries again.

import type { Place, WeatherData } from '../shared/types';

export const TRAY_INTERVAL_MS = 10 * 60 * 1000;

export type TrayWeather = { place: Place; weather: WeatherData } | null;

export interface BackgroundWeatherOptions {
  /** The tray city and its weather; null when there is no city (then the plain icon shows). */
  load: () => Promise<TrayWeather>;
  onUpdate: (value: TrayWeather) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  intervalMs?: number;
}

export function createBackgroundWeather(opts: BackgroundWeatherOptions) {
  const every = opts.setInterval ?? setInterval;
  let busy: Promise<void> | null = null;
  let again = false;

  async function run(): Promise<void> {
    try {
      opts.onUpdate(await opts.load());
    } catch {
      // keep the old value
    }
  }

  /** Load now (also after a settings or favorites change). Overlapping calls merge into one more run. */
  function refresh(): Promise<void> {
    if (busy) {
      again = true;
      return busy;
    }
    busy = run().finally(() => {
      busy = null;
      if (again) {
        again = false;
        void refresh();
      }
    });
    return busy;
  }

  return {
    refresh,
    start(): void {
      every(() => void refresh(), opts.intervalMs ?? TRAY_INTERVAL_MS);
      void refresh();
    },
  };
}
