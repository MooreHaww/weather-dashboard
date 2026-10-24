import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SIZE, loadWindowState, restoreBounds, saveWindowState } from '../src/main/windowState';

// One 1920x1080 monitor (taskbar at the bottom) and, for some tests, a second one to its right.
const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 2560, height: 1400 };

describe('restoreBounds', () => {
  it('keeps a saved window that is on screen', () => {
    expect(restoreBounds({ x: 100, y: 80, width: 1000, height: 700, maximized: false }, [primary])).toEqual({
      x: 100,
      y: 80,
      width: 1000,
      height: 700,
      maximized: false,
    });
  });

  it('keeps a window on a second monitor while that monitor is there', () => {
    expect(restoreBounds({ x: 2200, y: 100, width: 1400, height: 900, maximized: true }, [primary, right])).toEqual({
      x: 2200,
      y: 100,
      width: 1400,
      height: 900,
      maximized: true,
    });
  });

  it('centres (no x/y) a window whose monitor is gone, keeping its size', () => {
    expect(restoreBounds({ x: 2200, y: 100, width: 1400, height: 900, maximized: false }, [primary])).toEqual({
      width: 1400,
      height: 900,
      maximized: false,
    });
  });

  it('centres a window whose title bar would be hidden above or almost off the screen', () => {
    expect(restoreBounds({ x: 100, y: -500, width: 1000, height: 700 }, [primary])).not.toHaveProperty('x');
    expect(restoreBounds({ x: 1900, y: 100, width: 1000, height: 700 }, [primary])).not.toHaveProperty('x'); // only 20 px visible
    expect(restoreBounds({ x: -950, y: 100, width: 1000, height: 700 }, [primary])).not.toHaveProperty('x'); // 50 px
    expect(restoreBounds({ x: -850, y: 100, width: 1000, height: 700 }, [primary])).toHaveProperty('x', -850); // 150 px: enough to grab
  });

  it('enforces the minimum size and fits a too-big window on the largest screen', () => {
    expect(restoreBounds({ x: 10, y: 10, width: 200, height: 100 }, [primary])).toMatchObject({ width: 480, height: 400 });
    expect(restoreBounds({ x: 10, y: 10, width: 9000, height: 9000 }, [primary])).toMatchObject({ width: 1920, height: 1040 });
  });

  it('falls back to the default size for missing or broken data', () => {
    for (const bad of [null, undefined, 'x', 42, [], {}, { width: 'big', height: NaN }, { width: Infinity, height: 700 }]) {
      expect(restoreBounds(bad, [primary])).toEqual({ ...DEFAULT_SIZE, maximized: false });
    }
  });
});

describe('window-state file', () => {
  let dir: string;
  beforeEach(async () => (dir = await mkdtemp(path.join(tmpdir(), 'wd-window-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('saves and loads, leaving no temp file behind', async () => {
    const file = path.join(dir, 'window-state.json');
    const state = { x: 5, y: 6, width: 1000, height: 700, maximized: true };
    saveWindowState(file, state);
    expect(loadWindowState(file)).toEqual(state);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(state);
    expect(await readdir(dir)).toEqual(['window-state.json']);
  });

  it('a missing or corrupt file reads as nothing, and a failed save never throws', async () => {
    expect(loadWindowState(path.join(dir, 'none.json'))).toBeUndefined();
    await writeFile(path.join(dir, 'bad.json'), '{ not json');
    expect(loadWindowState(path.join(dir, 'bad.json'))).toBeUndefined();
    await writeFile(path.join(dir, 'blocker'), 'a file where a folder should be');
    expect(() => saveWindowState(path.join(dir, 'blocker', 'w.json'), { width: 1000, height: 700, maximized: false })).not.toThrow();
  });
});
