// v1.7: the "Look" setting (classic or glass). Validated on the server, saved with the other settings, and decided
// once at the first read: no file = a fresh install = classic; a file without the field = a current user = glass.
// The decision is written at once, so it never flips. 1.6.1 files load with every value unchanged.

import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import type { FetchLike } from '../src/server/openMeteo';
import { Storage, validSettings } from '../src/server/storage';

const FIXTURE = path.join(__dirname, 'fixtures', 'state-1.6.1.json');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wd-look-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const file = () => path.join(dir, 'weather-dashboard.json');
const onDisk = async () => JSON.parse(await readFile(file(), 'utf8')) as { settings: Record<string, unknown> } & Record<string, unknown>;
const makeApp = () => createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>(), now: () => 1, weatherTtlMs: 600_000 }).app;

describe('the look is decided once, at the first read', () => {
  it('no settings file (a fresh install): classic, and the decision is written at once', async () => {
    expect((await new Storage(dir).get()).settings.appearance).toBe('classic');
    expect((await onDisk()).settings.appearance).toBe('classic');
  });

  it('a file without the field (1.6.1 and older): glass, and the decision is written at once', async () => {
    await copyFile(FIXTURE, file());
    expect((await new Storage(dir).get()).settings.appearance).toBe('glass');
    expect((await onDisk()).settings.appearance).toBe('glass');
    expect((await new Storage(dir).get()).settings.appearance).toBe('glass'); // read again: the same
  });

  it('a saved choice is kept, and the file is not rewritten for it', async () => {
    await writeFile(file(), JSON.stringify({ version: 1, settings: { appearance: 'classic' } }));
    const before = await readFile(file(), 'utf8');
    expect((await new Storage(dir).get()).settings.appearance).toBe('classic');
    expect(await readFile(file(), 'utf8')).toBe(before);
  });

  it('a corrupt file counts as a file that existed: glass', async () => {
    await writeFile(file(), '{ not json');
    expect((await new Storage(dir).get()).settings.appearance).toBe('glass');
    expect((await onDisk()).settings.appearance).toBe('glass');
  });

  it('a 1.6.1 file loads with every saved value unchanged, plus the look', async () => {
    await copyFile(FIXTURE, file());
    const saved = JSON.parse(await readFile(FIXTURE, 'utf8')) as { settings: Record<string, unknown> } & Record<string, unknown>;
    delete saved.version;
    expect(await new Storage(dir).get()).toEqual({ ...saved, settings: { ...saved.settings, appearance: 'glass' } });
    const after = await onDisk();
    expect(after).toEqual({ ...saved, version: 1, settings: { ...saved.settings, appearance: 'glass' } });
  });
});

describe('validation', () => {
  it('validSettings keeps only "classic" or "glass"', () => {
    expect(validSettings({ appearance: 'classic' })).toEqual({ appearance: 'classic' });
    expect(validSettings({ appearance: 'glass' })).toEqual({ appearance: 'glass' });
    for (const bad of ['solid', 'Glass', '', 1, null, ['glass']]) expect(validSettings({ appearance: bad })).toEqual({});
  });

  it('PATCH /api/settings saves the look, rejects anything else with 400, and a restart keeps it', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/settings').expect(200)).body.appearance).toBe('classic');
    const res = await request(app).patch('/api/settings').send({ appearance: 'glass' }).expect(200);
    expect(res.body.appearance).toBe('glass');
    for (const bad of ['solid', 'auto', 3]) await request(app).patch('/api/settings').send({ appearance: bad }).expect(400);
    expect((await request(makeApp()).get('/api/settings').expect(200)).body.appearance).toBe('glass');
    expect((await onDisk()).settings.appearance).toBe('glass');
  });
});
