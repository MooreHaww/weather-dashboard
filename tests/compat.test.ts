// Files written by 1.4.0 must load unchanged, and what this version writes must
// stay readable by 1.4.0 (same shape, no new fields in weather-dashboard.json).

import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Storage } from '../src/server/storage';

const FIXTURE = path.join(__dirname, 'fixtures', 'state-1.4.0.json');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wd-compat-'));
  await copyFile(FIXTURE, path.join(dir, 'weather-dashboard.json'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('compatibility with 1.4.0 data files', () => {
  it('loads a 1.4.0 file exactly as it was saved', async () => {
    const saved = JSON.parse(await readFile(FIXTURE, 'utf8')) as Record<string, unknown>;
    delete saved.version; // the file format number, not part of the state
    expect(await new Storage(dir).get()).toEqual(saved);
  });

  it('a change writes the same shape back: only the changed value differs', async () => {
    const before = JSON.parse(await readFile(FIXTURE, 'utf8')) as { settings: Record<string, string> };
    await new Storage(dir).updateSettings({ timeFormat: '12h' });
    const after = JSON.parse(await readFile(path.join(dir, 'weather-dashboard.json'), 'utf8')) as typeof before;
    expect(after).toEqual({ ...before, settings: { ...before.settings, timeFormat: '12h' } });
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });
});
