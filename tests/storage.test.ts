import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_RECENT, Storage, toPlace } from '../src/server/storage';
import type { Place } from '../src/shared/types';

const place = (id: number, name = `City ${id}`): Place => ({ id, name, latitude: 10, longitude: 20 });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wd-storage-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Storage', () => {
  it('starts with defaults when no file exists', async () => {
    const s = new Storage(dir);
    expect(await s.get()).toEqual({ favorites: [], recent: [], settings: { units: 'metric' }, lastPlace: null });
  });

  it('persists favorites and settings across instances', async () => {
    const a = new Storage(dir);
    await a.addFavorite(place(1, 'Tokyo'));
    await a.addFavorite(place(1, 'Tokyo')); // duplicate ignored
    await a.addFavorite(place(2, 'Paris'));
    await a.updateSettings({ units: 'imperial' });

    const b = new Storage(dir);
    const state = await b.get();
    expect(state.favorites.map((f) => f.name)).toEqual(['Tokyo', 'Paris']);
    expect(state.settings.units).toBe('imperial');

    await b.removeFavorite(1);
    expect((await new Storage(dir).get()).favorites.map((f) => f.id)).toEqual([2]);
  });

  it('keeps recent searches de-duplicated, newest first, capped', async () => {
    const s = new Storage(dir);
    for (let i = 1; i <= MAX_RECENT + 3; i++) await s.addRecent(place(i));
    await s.addRecent(place(5));

    const { recent, lastPlace } = await s.get();
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent[0]!.id).toBe(5);
    expect(recent.filter((r) => r.id === 5)).toHaveLength(1);
    expect(lastPlace?.id).toBe(5);
  });

  it('recovers from a corrupt file and keeps a backup', async () => {
    const s = new Storage(dir);
    await writeFile(s.filePath, '{ not json', 'utf8');

    expect((await s.get()).favorites).toEqual([]);
    const files = await readdir(dir);
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true);
  });

  it('drops invalid entries from a hand-edited file', async () => {
    const s = new Storage(dir);
    await writeFile(
      s.filePath,
      JSON.stringify({ favorites: [place(1), { id: 'x' }, { ...place(2), latitude: 999 }], settings: { units: 'kelvin' } }),
    );
    const state = await s.get();
    expect(state.favorites.map((f) => f.id)).toEqual([1]);
    expect(state.settings.units).toBe('metric');
  });

  it('serializes concurrent writes without losing any', async () => {
    const s = new Storage(dir);
    await Promise.all([1, 2, 3, 4, 5].map((i) => s.addFavorite(place(i))));
    const saved = JSON.parse(await readFile(s.filePath, 'utf8'));
    expect(saved.favorites).toHaveLength(5);
    expect(saved.version).toBe(1);
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('toPlace', () => {
  it('rejects malformed input', () => {
    expect(toPlace(null)).toBeNull();
    expect(toPlace({ id: 1, name: 'x', latitude: 'a', longitude: 0 })).toBeNull();
    expect(toPlace({ id: 1, name: '', latitude: 0, longitude: 0 })).toBeNull();
    expect(toPlace({ id: 1, name: 'x'.repeat(500), latitude: 0, longitude: 0 })).toBeNull();
  });

  it('keeps only known fields', () => {
    expect(toPlace({ ...place(1), evil: '<script>', country: 'Japan' })).toEqual({
      ...place(1),
      admin1: undefined,
      country: 'Japan',
      countryCode: undefined,
      timezone: undefined,
    });
  });
});
