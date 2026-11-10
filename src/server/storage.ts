// Local JSON storage for favorites, recent searches and settings.
// The file lives in the app's per-user data folder (%APPDATA%\Weather Dashboard
// when packaged). Writes are atomic: write a temp file, then rename over the old one.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  APPEARANCES,
  CLOSE_BEHAVIORS,
  LOCATION_PLACE_ID,
  LOCATION_SETTINGS,
  TEMP_LABELS,
  TIME_FORMATS,
  WIND_UNITS,
  type AppState,
  type Place,
  type Settings,
} from '../shared/types';

export const MAX_RECENT = 10;
export const MAX_FAVORITES = 50;
const FILE_NAME = 'weather-dashboard.json';

interface StoredFile extends AppState {
  version: 1;
}

export function defaultSettings(): Settings {
  // A fresh install starts classic. A file written before 1.7 has no appearance: it gets 'glass' (see sanitize and load).
  return {
    units: 'metric',
    timeFormat: '12h',
    windUnit: 'kmh',
    tempLabels: '3h',
    location: 'ask',
    appearance: 'classic',
    closeBehavior: 'ask',
    rainAlerts: false,
  };
}

export function defaultState(): AppState {
  return { favorites: [], recent: [], settings: defaultSettings(), lastPlace: null, myLocation: null };
}

/** Keep only valid settings values from untrusted input (a request patch or an older file). */
export function validSettings(raw: unknown): Partial<Settings> {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (o.units === 'metric' || o.units === 'imperial') out.units = o.units;
  if (TIME_FORMATS.includes(o.timeFormat as never)) out.timeFormat = o.timeFormat as Settings['timeFormat'];
  if (WIND_UNITS.includes(o.windUnit as never)) out.windUnit = o.windUnit as Settings['windUnit'];
  if (TEMP_LABELS.includes(o.tempLabels as never)) out.tempLabels = o.tempLabels as Settings['tempLabels'];
  if (LOCATION_SETTINGS.includes(o.location as never)) out.location = o.location as Settings['location'];
  if (APPEARANCES.includes(o.appearance as never)) out.appearance = o.appearance as Settings['appearance'];
  if (CLOSE_BEHAVIORS.includes(o.closeBehavior as never)) out.closeBehavior = o.closeBehavior as Settings['closeBehavior'];
  if (typeof o.rainAlerts === 'boolean') out.rainAlerts = o.rainAlerts;
  return out;
}

/** Validate untrusted input (request bodies, file contents) into a Place, or null. */
export function toPlace(v: unknown): Place | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const str = (x: unknown, max = 120) => (typeof x === 'string' && x.length <= max ? x : undefined);
  const id = num(o.id);
  const latitude = num(o.latitude);
  const longitude = num(o.longitude);
  const name = str(o.name);
  if (id === null || latitude === null || longitude === null || !name) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    id,
    name,
    latitude,
    longitude,
    admin1: str(o.admin1),
    country: str(o.country),
    countryCode: str(o.countryCode, 3),
    timezone: str(o.timezone, 64),
  };
}

function sanitize(raw: unknown): AppState {
  const base = defaultState();
  if (typeof raw !== 'object' || raw === null) return base;
  const o = raw as Record<string, unknown>;
  const places = (x: unknown, max: number) =>
    (Array.isArray(x) ? x : []).map(toPlace).filter((p): p is Place => p !== null).slice(0, max);
  // A file that exists is a current user's: without the field it keeps the look it had (glass, 1.6).
  const settings: Settings = { ...defaultSettings(), appearance: 'glass', ...validSettings(o.settings) };
  const myLocation = toPlace(o.myLocation);
  return {
    favorites: places(o.favorites, MAX_FAVORITES),
    recent: places(o.recent, MAX_RECENT),
    settings,
    lastPlace: toPlace(o.lastPlace),
    // Only a place found by the lookup, and only while the user allows it.
    myLocation: settings.location === 'on' && myLocation?.id === LOCATION_PLACE_ID ? myLocation : null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Storage {
  readonly filePath: string;
  private state: AppState | null = null;
  private loading: Promise<AppState> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  /** v1.9: called with a copy of the state after every successful write (the main process applies settings from it). */
  private readonly onChange?: (state: AppState) => void;

  constructor(dataDir: string, onChange?: (state: AppState) => void) {
    this.filePath = path.join(dataDir, FILE_NAME);
    this.onChange = onChange;
  }

  private async load(): Promise<AppState> {
    if (this.state) return this.state;
    this.loading ??= (async () => {
      let text: string;
      try {
        text = await fs.readFile(this.filePath, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return this.decided(defaultState()); // a fresh install: classic
        throw err;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        // Corrupt file: keep a copy for inspection and start fresh rather than crash. A file existed, so the look stays glass.
        await fs.rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => {});
        return this.decided({ ...defaultState(), settings: { ...defaultSettings(), appearance: 'glass' } });
      }
      const state = sanitize(raw);
      const saved = (raw as { settings?: { appearance?: unknown } } | null)?.settings?.appearance;
      return saved === state.settings.appearance ? (this.state = state) : this.decided(state);
    })();
    return this.loading;
  }

  /**
   * The look is decided once, at the first read (v1.7): no file = classic, a file without the field = glass. The decision is
   * written at once, so a later read can never decide differently. A failed write only means it is decided again next time.
   */
  private async decided(state: AppState): Promise<AppState> {
    this.state = state;
    const snapshot: StoredFile = { version: 1, ...structuredClone(state) };
    const write = this.writeChain.then(() => this.writeAtomic(JSON.stringify(snapshot, null, 2)));
    this.writeChain = write.catch(() => {});
    await write.catch(() => {});
    return state;
  }

  async get(): Promise<AppState> {
    return structuredClone(await this.load());
  }

  /** Apply a change and persist it. Writes are serialized so they never interleave. */
  async update(mutate: (s: AppState) => void): Promise<AppState> {
    const state = await this.load();
    mutate(state);
    const snapshot: StoredFile = { version: 1, ...structuredClone(state) };
    const write = this.writeChain.then(() => this.writeAtomic(JSON.stringify(snapshot, null, 2)));
    this.writeChain = write.catch(() => {});
    await write;
    if (this.onChange) {
      try {
        this.onChange(structuredClone(state));
      } catch {
        // A listener's failure never fails the request that saved.
      }
    }
    return structuredClone(state);
  }

  private async writeAtomic(text: string): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    // On Windows, antivirus or indexers can briefly lock the target; retry a few times.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, this.filePath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
        await sleep(50 * (attempt + 1));
      }
    }
  }

  addFavorite(place: Place) {
    return this.update((s) => {
      if (place.id === LOCATION_PLACE_ID) return; // the detected place is not a favorite
      if (s.favorites.some((f) => f.id === place.id)) return;
      s.favorites.push(place);
      s.favorites = s.favorites.slice(0, MAX_FAVORITES);
    });
  }

  removeFavorite(id: number) {
    return this.update((s) => {
      s.favorites = s.favorites.filter((f) => f.id !== id);
    });
  }

  /** Record a viewed city: move it to the front of recent and remember it for next launch. */
  addRecent(place: Place) {
    return this.update((s) => {
      if (place.id === LOCATION_PLACE_ID) return; // not a recent search, and not the next launch's city
      s.recent = [place, ...s.recent.filter((r) => r.id !== place.id)].slice(0, MAX_RECENT);
      s.lastPlace = place;
    });
  }

  clearRecent() {
    return this.update((s) => {
      s.recent = [];
    });
  }

  /** Forget one recent city (the rest keep their order; an unknown id changes nothing). The next launch's city is not touched. */
  removeRecent(id: number) {
    return this.update((s) => {
      s.recent = s.recent.filter((r) => r.id !== id);
    });
  }

  updateSettings(patch: unknown) {
    return this.update((s) => {
      Object.assign(s.settings, validSettings(patch));
      // Turning the setting off (or back to "ask") deletes what the lookup found.
      if (s.settings.location !== 'on') s.myLocation = null;
    });
  }

  /**
   * Store the place the lookup found. Checked again here, inside the update: if the user turned the
   * setting off while the lookup ran, nothing is stored and this returns null.
   */
  async setMyLocation(place: Place): Promise<AppState | null> {
    let stored = false;
    const state = await this.update((s) => {
      if (s.settings.location !== 'on' || place.id !== LOCATION_PLACE_ID) return;
      s.myLocation = place;
      stored = true;
    });
    return stored ? state : null;
  }
}
