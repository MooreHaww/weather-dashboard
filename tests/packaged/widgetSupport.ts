// v2.0: shared by the packaged tests. Not a test file (vitest.packaged.config.mts runs *.e2e.ts only).

import { expect } from 'vitest';
import type { LaunchedApp } from '../../scripts/launch';

/**
 * Turn the desktop widget on (v2.0). The packaged exe ignores NODE_OPTIONS, so the wallpaper fake is set up here through
 * the main-process inspector: the wallpaper registry answers "solid colour", so this PC's wallpaper is never read.
 */
export async function openWidget(a: LaunchedApp): Promise<void> {
  await a.evaluateMain(`
    const cp = process.mainModule.require('child_process');
    const real = cp.execFile;
    cp.execFile = function (file, args, opts, cb) {
      const key = Array.isArray(args) ? String(args[1] ?? '') : '';
      if (String(file).toLowerCase() === 'reg.exe' && key.endsWith('Wallpapers')) {
        setImmediate(() => (typeof opts === 'function' ? opts : cb)(null, '    BackgroundType    REG_DWORD    0x1', ''));
        return undefined;
      }
      if (String(file).toLowerCase() === 'reg.exe' && key.endsWith('Control Panel' + String.fromCharCode(92) + 'Desktop')) {
        setImmediate(() => (typeof opts === 'function' ? opts : cb)(null, '', ''));
        return undefined;
      }
      return real.apply(this, arguments);
    };
    return true;`);
  expect(await a.page.evaluate(`fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"widget":true}' }).then((r) => r.status)`)).toBe(200);
  for (const deadline = Date.now() + 15_000; ; await new Promise((r) => setTimeout(r, 150))) {
    const shown = await a.evaluateMain<boolean>(
      `return process.mainModule.require('electron').BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('/widget.html') && w.isVisible());`,
    );
    if (shown) return;
    if (Date.now() > deadline) throw new Error('The widget did not open');
  }
}
