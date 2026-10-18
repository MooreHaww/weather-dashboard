// Local JSON storage for favorites, recent searches and settings.
// The file lives in the app's per-user data folder (%APPDATA%\Weather Dashboard
// when packaged). Writes are atomic: write a temp file, then rename over the old one.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppState, Place, Settings } from '../shared/types';

export const MAX_RECENT = 10;
export const MAX_FAVORITES = 50;
const FILE_NAME = 'weather-dashboard.json';

interface StoredFile extends AppState {
  version: 1;
}

export function defaultState(): AppState {
  return { favorites: [], recent: [], settings: { units: 'metric' }, lastPlace: null };
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
  const settings = o.settings as Partial<Settings> | undefined;
  return {
    favorites: places(o.favorites, MAX_FAVORITES),
    recent: places(o.recent, MAX_RECENT),
    settings: { units: settings?.units === 'imperial' ? 'imperial' : 'metric' },
    lastPlace: toPlace(o.lastPlace),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Storage {
  readonly filePath: string;
  private state: AppState | null = null;
  private loading: Promise<AppState> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, FILE_NAME);
  }

  private async load(): Promise<AppState> {
    if (this.state) return this.state;
    this.loading ??= (async () => {
      let text: string;
      try {
        text = await fs.readFile(this.filePath, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return (this.state = defaultState());
        throw err;
      }
      try {
        return (this.state = sanitize(JSON.parse(text)));
      } catch {
        // Corrupt file: keep a copy for inspection and start fresh rather than crash.
        await fs.rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => {});
        return (this.state = defaultState());
      }
    })();
    return this.loading;
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
      s.recent = [place, ...s.recent.filter((r) => r.id !== place.id)].slice(0, MAX_RECENT);
      s.lastPlace = place;
    });
  }

  clearRecent() {
    return this.update((s) => {
      s.recent = [];
    });
  }

  updateSettings(patch: Partial<Settings>) {
    return this.update((s) => {
      if (patch.units === 'metric' || patch.units === 'imperial') s.settings.units = patch.units;
    });
  }
}
