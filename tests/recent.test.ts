// v1.5.1: remove one city from Recent (storage and DELETE /api/recent/:id), and 1.5.0 files load unchanged.

import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import type { FetchLike } from '../src/server/openMeteo';
import { Storage } from '../src/server/storage';

const FIXTURE = path.join(__dirname, 'fixtures', 'state-1.5.0.json');
type Saved = Record<string, unknown> & { recent: { id: number; name: string }[] };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wd-recent-'));
  await copyFile(FIXTURE, path.join(dir, 'weather-dashboard.json'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const saved = async () => JSON.parse(await readFile(FIXTURE, 'utf8')) as Saved;
const onDisk = async () => JSON.parse(await readFile(path.join(dir, 'weather-dashboard.json'), 'utf8')) as Saved;
const names = (list: { name: string }[]) => list.map((p) => p.name);

describe('a 1.5.0 file', () => {
  it('loads unchanged: every saved value kept, the location setting and place too', async () => {
    const before = await saved();
    delete before.version;
    expect(await new Storage(dir).get()).toEqual(before);
  });
});

describe('Storage.removeRecent', () => {
  it('removes only that city and keeps the rest in order', async () => {
    const state = await new Storage(dir).removeRecent(2643743); // London, the middle one
    expect(names(state.recent)).toEqual(['New York', 'Berlin']);
    const before = await saved();
    // Nothing else changes, in memory or in the file (the next start's city stays, even when it was removed from the list).
    expect(await onDisk()).toEqual({ ...before, recent: before.recent.filter((p) => p.id !== 2643743) });
  });

  it('keeps the next start city even when that city is removed from the list', async () => {
    const state = await new Storage(dir).removeRecent(5128581); // New York is also lastPlace
    expect(names(state.recent)).toEqual(['London', 'Berlin']);
    expect(state.lastPlace!.name).toBe('New York');
  });

  it('ignores an unknown city, a favorite that is not recent, and the detected place', async () => {
    const s = new Storage(dir);
    for (const id of [42, 1850147, -1]) {
      expect(names((await s.removeRecent(id)).recent)).toEqual(['New York', 'London', 'Berlin']);
    }
    const state = await s.get();
    expect(state.favorites).toHaveLength(1);
    expect(state.myLocation!.name).toBe('Paris');
  });
});

describe('DELETE /api/recent/:id', () => {
  const makeApp = () => createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>(), now: () => 1, weatherTtlMs: 600_000 }).app;

  it('answers with the new list, which a restart still has', async () => {
    const res = await request(makeApp()).delete('/api/recent/2950159').expect(200);
    expect(names(res.body as { name: string }[])).toEqual(['New York', 'London']);
    expect(names((await request(makeApp()).get('/api/state').expect(200)).body.recent)).toEqual(['New York', 'London']);
  });

  it('refuses an id that is not a number, and leaves "Clear" (DELETE /api/recent) as it was', async () => {
    const app = makeApp();
    await request(app).delete('/api/recent/abc').expect(400);
    expect((await onDisk()).recent).toHaveLength(3);
    expect((await request(app).delete('/api/recent').expect(200)).body).toEqual([]);
  });

  it('makes no network request', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    await request(createApp({ dataDir: dir, fetchImpl, now: () => 1, weatherTtlMs: 600_000 }).app).delete('/api/recent/2643743').expect(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
