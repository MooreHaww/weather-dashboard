import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_ARG,
  APPEARANCE_CHANNEL,
  createAppearanceWatcher,
  decideAppearance,
  GLASS_MIN_BUILD,
  parseAppearanceArg,
  parseTransparencyQuery,
  readTransparencyEffects,
  TRANSPARENCY_KEY,
  windowsBuild,
  type AppearanceEnv,
} from '../src/main/appearance';

const WIN11_23H2: AppearanceEnv = {
  platform: 'win32',
  release: '10.0.22631',
  transparencyEffects: true,
  reducedTransparency: false,
  forcedColors: false,
  highContrast: false,
};

describe('glass or solid: the decision', () => {
  it('is glass on Windows 11 22H2 and newer with nothing turned off', () => {
    for (const release of ['10.0.22621', '10.0.22631', '10.0.26100', '10.0.26300']) {
      expect(decideAppearance({ ...WIN11_23H2, release })).toEqual({ mode: 'glass', reason: 'ok' });
    }
    expect(GLASS_MIN_BUILD).toBe(22621);
  });

  it('is solid on Windows 10 and on Windows 11 before 22H2', () => {
    for (const release of ['10.0.19045', '10.0.19041', '10.0.22000', '10.0.22620', '6.3.9600', '', 'garbage']) {
      expect(decideAppearance({ ...WIN11_23H2, release })).toEqual({ mode: 'solid', reason: 'windows-too-old' });
    }
  });

  it('is solid on every other platform', () => {
    for (const platform of ['darwin', 'linux', 'freebsd']) {
      expect(decideAppearance({ ...WIN11_23H2, platform })).toEqual({ mode: 'solid', reason: 'not-windows' });
    }
  });

  it('is solid when "Transparency effects" is off, transparency is reduced, or colours are forced / high contrast', () => {
    expect(decideAppearance({ ...WIN11_23H2, transparencyEffects: false })).toEqual({ mode: 'solid', reason: 'transparency-off' });
    expect(decideAppearance({ ...WIN11_23H2, reducedTransparency: true })).toEqual({ mode: 'solid', reason: 'reduced-transparency' });
    expect(decideAppearance({ ...WIN11_23H2, forcedColors: true })).toEqual({ mode: 'solid', reason: 'forced-colors' });
    expect(decideAppearance({ ...WIN11_23H2, highContrast: true })).toEqual({ mode: 'solid', reason: 'high-contrast' });
    // Several at once: still solid.
    expect(decideAppearance({ ...WIN11_23H2, release: '10.0.19045', transparencyEffects: false, forcedColors: true }).mode).toBe('solid');
  });

  it('counts an unreadable "Transparency effects" value as on (Windows default); nativeTheme still decides', () => {
    expect(decideAppearance({ ...WIN11_23H2, transparencyEffects: null }).mode).toBe('glass');
    expect(decideAppearance({ ...WIN11_23H2, transparencyEffects: null, reducedTransparency: true }).mode).toBe('solid');
  });

  it('reads the build number from os.release()', () => {
    expect(windowsBuild('10.0.22631')).toBe(22631);
    expect(windowsBuild(' 10.0.19045 ')).toBe(19045);
    expect(windowsBuild('10.0')).toBeNull();
    expect(windowsBuild('')).toBeNull();
  });
});

describe('"Transparency effects" from the registry', () => {
  it('parses reg.exe output', () => {
    const out = (v: string) => `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\r\n    EnableTransparency    REG_DWORD    ${v}\r\n\r\n`;
    expect(parseTransparencyQuery(out('0x1'))).toBe(true);
    expect(parseTransparencyQuery(out('0x0'))).toBe(false);
    expect(parseTransparencyQuery('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
    expect(parseTransparencyQuery('')).toBeNull();
  });

  it('runs exactly one local reg.exe query, hidden, with a timeout, and never throws', async () => {
    const execFile = vi.fn((_f: string, _a: string[], _o: object, cb: (e: Error | null, out: string) => void) =>
      cb(null, '    EnableTransparency    REG_DWORD    0x0'),
    );
    await expect(readTransparencyEffects(execFile, 'win32')).resolves.toBe(false);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0]!.slice(0, 3)).toEqual([
      'reg.exe',
      ['query', TRANSPARENCY_KEY, '/v', 'EnableTransparency'],
      { windowsHide: true, timeout: 2000 },
    ]);
    expect(TRANSPARENCY_KEY).toBe('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize');

    const failing = vi.fn((_f: string, _a: string[], _o: object, cb: (e: Error | null, out: string) => void) => cb(new Error('no'), ''));
    await expect(readTransparencyEffects(failing, 'win32')).resolves.toBeNull();
    const throwing = vi.fn(() => {
      throw new Error('spawn failed');
    });
    await expect(readTransparencyEffects(throwing, 'win32')).resolves.toBeNull();
    const notWindows = vi.fn();
    await expect(readTransparencyEffects(notWindows, 'linux')).resolves.toBeNull();
    expect(notWindows).not.toHaveBeenCalled();
  });
});

describe('watching for system changes while the app runs', () => {
  it('reports only real mode changes', async () => {
    let env = { ...WIN11_23H2 };
    const onChange = vi.fn();
    const w = await createAppearanceWatcher({ env: async () => env, onChange });
    expect(w.current()).toEqual({ mode: 'glass', reason: 'ok' });
    await w.refresh();
    expect(onChange).not.toHaveBeenCalled();

    env = { ...env, transparencyEffects: false };
    await w.refresh();
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'solid', reason: 'transparency-off' });
    // Another reason for solid: no new message.
    env = { ...env, highContrast: true };
    await w.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(w.current()).toEqual({ mode: 'solid', reason: 'high-contrast' });

    env = { ...WIN11_23H2 };
    await w.refresh();
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'glass', reason: 'ok' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('merges refreshes that arrive while one runs, and keeps the mode when reading fails', async () => {
    let calls = 0;
    let fail = false;
    const env = vi.fn(async () => {
      calls++;
      if (fail) throw new Error('boom');
      await new Promise((r) => setTimeout(r, 5));
      return WIN11_23H2;
    });
    const log = vi.fn();
    const w = await createAppearanceWatcher({ env, onChange: vi.fn(), log });
    calls = 0;
    await Promise.all([w.refresh(), w.refresh(), w.refresh(), w.refresh()]);
    expect(calls).toBe(2); // the running one, plus one more for everything that came in meanwhile
    fail = true;
    await w.refresh();
    expect(w.current().mode).toBe('glass');
    expect(log).toHaveBeenCalledWith('warn', 'Appearance check failed');
  });
});

describe('the creation-time argument the preload reads', () => {
  it('accepts only "glass" and "solid"', () => {
    expect(parseAppearanceArg(['x', `${APPEARANCE_ARG}glass`])).toBe('glass');
    expect(parseAppearanceArg([`${APPEARANCE_ARG}solid`])).toBe('solid');
    expect(parseAppearanceArg([`${APPEARANCE_ARG}mica`])).toBeNull();
    expect(parseAppearanceArg([`${APPEARANCE_ARG}`])).toBeNull();
    expect(parseAppearanceArg([])).toBeNull();
  });
});

describe('the preload (it cannot import appearance.ts)', () => {
  const preload = readFileSync(new URL('../src/main/preload.ts', import.meta.url), 'utf8');

  it('uses the same argument and channel strings', () => {
    expect(preload).toContain(`'${APPEARANCE_ARG}'`);
    expect(preload).toContain(`ipcRenderer.on('${APPEARANCE_CHANNEL}'`);
  });

  it('sends nothing new: only the two update messages go back', () => {
    const sends = [...preload.matchAll(/ipcRenderer\.(send|invoke|sendSync|postMessage)\(\s*'([^']+)'/g)].map((m) => m[2]);
    expect(sends).toEqual(['update-restart', 'update-check']);
    expect(preload).not.toMatch(/ipcRenderer\.(invoke|sendSync|postMessage|sendTo)/);
  });
});
