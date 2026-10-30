// v1.4.6 in the real window: the gear without its box (hover, focus ring, title bar at
// every width), and the "update ready" signals with the "Restart now?" confirmation.
// This build is not packaged, so its updater never runs: the test sends the page the
// same "update-state" and "update-ready" messages the main process sends after a download.
// The main process itself has no downloaded update here, so it must ignore "Restart". The
// real check, download and restart path (and the Updates section in each state) is tested
// in the packaged app (tests/packaged/update.e2e.ts).
// Run with: npm run test:e2e

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type AppPage, type LaunchedApp } from '../../scripts/launch';

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, country: 'Japan', countryCode: 'JP' };

let app: LaunchedApp;
let page: AppPage;

beforeAll(async () => {
  app = await launchApp({ lastPlace: tokyo, favorites: [tokyo], recent: [tokyo], settings: { units: 'metric' } });
  page = app.page;
  await waitForDashboard(page);
});

afterAll(async () => {
  await app?.close();
});

async function centerOf(selector: string): Promise<[number, number]> {
  return page.evaluate<[number, number]>(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
  );
}
async function clickOn(selector: string) {
  const [x, y] = await centerOf(selector);
  await page.click(x, y);
}
const activeId = () => page.evaluate<string>(`document.activeElement?.id || document.activeElement?.dataset?.action || ''`);
const gearStyle = () =>
  page.evaluate<{ bg: string; borderColor: string; shadow: string; outline: string; outlineWidth: number; outlineOffset: number }>(`(() => {
    const s = getComputedStyle(document.getElementById('settings-button'));
    return { bg: s.backgroundColor, borderColor: s.borderTopColor, shadow: s.boxShadow, outline: s.outlineStyle + ' ' + s.outlineColor,
      outlineWidth: parseFloat(s.outlineWidth), outlineOffset: parseFloat(s.outlineOffset) };
  })()`);
const settingsOpen = () => page.evaluate<boolean>(`!document.getElementById('settings').hidden`);

async function openSettings() {
  await clickOn('#settings-button');
  await page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 2000);
  await new Promise((r) => setTimeout(r, 500));
}
async function closeSettings() {
  await page.press('Escape');
  await page.waitFor(`document.getElementById('settings').hidden`, 2000);
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

describe('the gear in the title bar', () => {
  it('is only the icon at rest: no background, border or highlight', async () => {
    await app.resize(1000, 700);
    await page.move(500, 400); // away from the gear
    const s = await gearStyle();
    expect(s.bg).toBe(TRANSPARENT);
    expect(s.borderColor).toBe(TRANSPARENT);
    expect(s.shadow).toBe('none');
    expect(await page.evaluate<boolean>(`document.querySelector('#settings-button svg') !== null`)).toBe(true);
  });

  it('has a subtle hover effect', async () => {
    const [x, y] = await centerOf('#settings-button');
    await page.move(x, y);
    await page.waitFor(`getComputedStyle(document.getElementById('settings-button')).backgroundColor !== ${JSON.stringify(TRANSPARENT)}`, 2000);
    const bg = (await gearStyle()).bg;
    const alpha = Number(/rgba\(\d+, \d+, \d+, ([\d.]+)\)/.exec(bg)?.[1] ?? 1);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThanOrEqual(0.12); // subtle
    await page.move(500, 400);
  });

  it('shows a clear focus ring from the keyboard, inside the title bar and clear of the window buttons', async () => {
    await page.evaluate(`document.getElementById('search-input').focus()`);
    await page.press('Tab');
    expect(await activeId()).toBe('settings-button');
    const s = await gearStyle();
    expect(s.outline).toBe('solid rgb(96, 165, 250)'); // --accent
    expect(s.outlineWidth).toBeGreaterThanOrEqual(2);
    const r = await page.evaluate<{ top: number; bottom: number; right: number; vw: number }>(
      `(() => { const r = document.getElementById('settings-button').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, right: r.right, vw: innerWidth }; })()`,
    );
    const ring = s.outlineWidth + s.outlineOffset;
    expect(r.top - ring).toBeGreaterThanOrEqual(0);
    expect(r.bottom + ring).toBeLessThanOrEqual(52);
    expect(r.right + ring).toBeLessThanOrEqual(r.vw - 130);
    await page.evaluate(`document.activeElement.blur()`);
  });

  it('opening Settings still puts the close button exactly where the gear is', async () => {
    const gear = await page.evaluate<number[]>(`(() => { const r = document.getElementById('settings-button').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
    await openSettings();
    const close = await page.evaluate<number[]>(`(() => { const r = document.querySelector('.settings-close').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
    close.forEach((v, i) => expect(Math.abs(v - gear[i]!)).toBeLessThan(1));
    await closeSettings();
  });
});

describe('before an update is ready', () => {
  it('there is no dot, no note and no Update button; the Updates section shows just the version (the updater does not run here)', async () => {
    expect(await page.evaluate<number>(`document.querySelectorAll('.update-dot').length`)).toBe(0);
    expect(await page.evaluate<string>(`document.getElementById('settings-button').getAttribute('aria-label')`)).toBe('Settings');
    expect(await page.evaluate<boolean>(`document.getElementById('update-note').hidden`)).toBe(true);
    await openSettings();
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll('#settings-sections h3')].map((h) => h.textContent)`)).toEqual([
      'Updates',
      'Units',
      'Time format',
      'Temperature chart',
      'Location',
    ]);
    const appVersion = await app.evaluateMain<string>(`return process.mainModule.require('electron').app.getVersion();`);
    expect(await page.evaluate<string>(`document.querySelector('#settings-updates .settings-row-label').textContent`)).toBe(`Version ${appVersion}`);
    expect(await page.evaluate<number>(`document.querySelectorAll('#settings-updates .settings-row-description').length`)).toBe(0);
    expect(await page.evaluate<boolean>(`document.getElementById('update-now') === null`)).toBe(true);
    await closeSettings();
  });

  it('the page can only listen, ask for a restart and ask for a check; it has no other way to reach the main process', async () => {
    expect(await page.evaluate<string[]>(`Object.keys(window.updates).sort()`)).toEqual(['checkNow', 'onReady', 'onState', 'restart']);
    expect(await page.evaluate<string>(`typeof window.require + ' ' + typeof window.ipcRenderer + ' ' + typeof window.process`)).toBe(
      'undefined undefined undefined',
    );
  });
});

describe('the title bar from 480 to 1400 px', () => {
  const widths = Array.from({ length: 24 }, (_, i) => 480 + i * 40); // 480, 520, ... 1400

  it.each(widths)('%i px: brand, search and gear do not overlap and stay clear of the window buttons', async (w) => {
    await app.resize(w, 700);
    const r = await page.evaluate<Record<string, number>>(`(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const brand = box('.brand'), search = box('#search'), gear = box('#settings-button');
      const controls = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--controls'));
      return { vw: innerWidth, controls, brandRight: brand.right, searchLeft: search.left, searchRight: search.right,
        gearLeft: gear.left, gearRight: gear.right, gearTop: gear.top, gearBottom: gear.bottom, gearW: gear.width, gearH: gear.height,
        titlebarScroll: document.querySelector('.titlebar').scrollWidth - document.querySelector('.titlebar').clientWidth };
    })()`);
    expect(r.searchLeft).toBeGreaterThanOrEqual(r.brandRight!);
    expect(r.searchRight).toBeLessThanOrEqual(r.gearLeft! - 4);
    expect(r.searchRight! - r.searchLeft!).toBeGreaterThan(120);
    expect(r.gearRight).toBeLessThanOrEqual(r.vw! - r.controls!); // Windows draws its buttons there
    expect([r.gearW, r.gearH]).toEqual([34, 34]); // same size as before, only the box is gone
    expect(r.gearTop).toBeGreaterThanOrEqual(0);
    expect(r.gearBottom).toBeLessThanOrEqual(52);
    expect(r.titlebarScroll).toBeLessThanOrEqual(0);
  });
});

describe('when an update is ready (message simulated, no update in the main process)', () => {
  it('shows the red dot on the gear, the new note and the Update now button in the Updates section', async () => {
    await app.resize(1000, 700);
    await app.evaluateMain(`
      const { BrowserWindow, app } = process.mainModule.require('electron');
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.send('update-state', { status: 'ready', version: app.getVersion(), next: '9.9.9' });
      wc.send('update-ready', '9.9.9');
    `);
    await page.waitFor(`document.querySelector('#settings-button .update-dot') !== null`, 3000);
    const dot = await page.evaluate<Record<string, number | string>>(`(() => {
      const d = document.querySelector('.update-dot').getBoundingClientRect(), g = document.getElementById('settings-button').getBoundingClientRect();
      const s = getComputedStyle(document.querySelector('.update-dot'));
      return { dl: d.left, dr: d.right, dt: d.top, db: d.bottom, gl: g.left, gr: g.right, gt: g.top, gb: g.bottom, w: d.width,
        bg: s.backgroundColor, animation: s.animationName, label: document.getElementById('settings-button').getAttribute('aria-label') };
    })()`);
    expect(dot.label).toBe('Settings, update ready');
    expect(dot.bg).toBe('rgb(239, 68, 68)'); // red
    expect(dot.animation).toBe('none');
    expect(dot.w).toBeGreaterThanOrEqual(6);
    // In the gear's top-right corner.
    expect(dot.dl as number).toBeGreaterThan(((dot.gl as number) + (dot.gr as number)) / 2);
    expect(dot.db as number).toBeLessThan(((dot.gt as number) + (dot.gb as number)) / 2);
    expect(dot.dr as number).toBeLessThanOrEqual(dot.gr as number);
    expect(dot.dt as number).toBeGreaterThanOrEqual(dot.gt as number);

    expect(await page.evaluate<string>(`document.querySelector('.update-note-title').textContent`)).toBe('New update available: version 9.9.9');
    expect(await page.evaluate<string>(`document.querySelector('.update-note-detail').textContent`)).toBe('Update now in Settings');
    const sizes = await page.evaluate<number[]>(
      `[parseFloat(getComputedStyle(document.querySelector('.update-note-title')).fontSize), parseFloat(getComputedStyle(document.querySelector('.update-note-detail')).fontSize)]`,
    );
    expect(sizes[1]).toBeLessThan(sizes[0]!); // the second line is smaller

    // Dismissing the note keeps the dot.
    await clickOn('.update-note-close');
    await page.waitFor(`document.getElementById('update-note').hidden`, 2000);
    expect(await page.evaluate<number>(`document.querySelectorAll('.update-dot').length`)).toBe(1);

    await openSettings();
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll('#settings-sections h3')].map((h) => h.textContent)`)).toEqual([
      'Updates',
      'Units',
      'Time format',
      'Temperature chart',
      'Location',
    ]);
    expect(await page.evaluate<string>(`document.querySelector('#settings-updates .settings-row-label').textContent`)).toBe('Version 9.9.9 is ready');
    expect(await page.evaluate<string>(`document.getElementById('settings-sections').lastElementChild.id`)).toBe('settings-location');
  });

  it('the title bar still has no overlaps with the dot, at 480 and 1400 px', async () => {
    for (const w of [480, 1400]) {
      await app.resize(w, 700);
      const r = await page.evaluate<Record<string, number>>(`(() => {
        const d = document.querySelector('.update-dot').getBoundingClientRect(), s = document.getElementById('search').getBoundingClientRect();
        return { dotLeft: d.left, dotRight: d.right, searchRight: s.right, vw: innerWidth };
      })()`);
      expect(r.dotLeft).toBeGreaterThan(r.searchRight!);
      expect(r.dotRight).toBeLessThanOrEqual(r.vw! - 140);
    }
    await app.resize(1000, 700);
  });

  it('Update now opens "Restart now?" with focus on Later, and keeps focus inside', async () => {
    await clickOn('#update-now');
    await page.waitFor(`document.getElementById('update-confirm') !== null`, 2000);
    const d = await page.evaluate<Record<string, string | boolean>>(`(() => {
      const box = document.querySelector('#update-confirm [role="alertdialog"]');
      return { modal: box.getAttribute('aria-modal'), title: document.getElementById(box.getAttribute('aria-labelledby')).textContent,
        text: document.getElementById(box.getAttribute('aria-describedby')).textContent,
        buttons: [...box.querySelectorAll('button')].map((b) => b.textContent).join(','),
        sectionsInert: document.getElementById('settings-sections').inert, headerInert: document.querySelector('.settings-header').inert,
        backdrop: getComputedStyle(box).backdropFilter };
    })()`);
    expect(d).toMatchObject({ modal: 'true', title: 'Restart now?', text: 'The app will close, update and reopen.', buttons: 'Restart,Later' });
    expect(d.sectionsInert && d.headerInert).toBe(true);
    expect(d.backdrop).toContain('blur'); // the app's glass
    expect(await activeId()).toBe('later');
    for (const want of ['restart', 'later', 'restart']) {
      await page.press('Tab');
      expect(await activeId()).toBe(want);
    }
    await page.press('Tab', { shift: true });
    expect(await activeId()).toBe('later');
  });

  it('Escape closes only the confirmation and returns focus to Update now', async () => {
    await page.press('Escape');
    await page.waitFor(`document.getElementById('update-confirm') === null`, 2000);
    expect(await settingsOpen()).toBe(true);
    expect(await activeId()).toBe('update-now');
    expect(await page.evaluate<boolean>(`document.getElementById('settings-sections').inert`)).toBe(false);
  });

  it('opens from the keyboard (Enter), and Later closes it and returns focus', async () => {
    await page.press('Enter');
    await page.waitFor(`document.getElementById('update-confirm') !== null`, 2000);
    await clickOn('[data-action="later"]');
    await page.waitFor(`document.getElementById('update-confirm') === null`, 2000);
    expect(await activeId()).toBe('update-now');
    expect(await settingsOpen()).toBe(true);
  });

  it('works with reduced motion: no animation, same behaviour', async () => {
    await page.emulateReducedMotion(true);
    try {
      await page.press(' ');
      await page.waitFor(`document.getElementById('update-confirm') !== null`, 2000);
      expect(await page.evaluate<string>(`getComputedStyle(document.getElementById('update-confirm')).animationName`)).toBe('none');
      expect(await activeId()).toBe('later');
      await page.press('Escape');
      await page.waitFor(`document.getElementById('update-confirm') === null`, 2000);
      expect(await activeId()).toBe('update-now');
    } finally {
      await page.emulateReducedMotion(false);
    }
  });

  it('Restart reaches the main process, which ignores it because no update was downloaded', async () => {
    await app.evaluateMain(`
      globalThis.__restartMessages = 0;
      process.mainModule.require('electron').ipcMain.on('update-restart', (_e, ...args) => { globalThis.__restartMessages++; globalThis.__restartArgs = args.length; });
    `);
    await clickOn('#update-now');
    await page.waitFor(`document.getElementById('update-confirm') !== null`, 2000);
    await clickOn('[data-action="restart"]');
    await page.waitFor(`document.getElementById('update-confirm') === null`, 2000);
    for (const deadline = Date.now() + 3000; (await app.evaluateMain<number>(`return globalThis.__restartMessages;`)) < 1; ) {
      if (Date.now() > deadline) throw new Error('the restart message never reached the main process');
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(await app.evaluateMain<number>(`return globalThis.__restartArgs;`)).toBe(0); // carries nothing
    // Still running: same window, page still answering, dashboard still there.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await app.evaluateMain<number>(`return process.mainModule.require('electron').BrowserWindow.getAllWindows().length;`)).toBe(1);
    expect(await page.evaluate<number>(`document.querySelectorAll('.forecast .day').length`)).toBe(7);
    await closeSettings();
  });

  it('threw no page errors', () => {
    expect(app.errors).toEqual([]);
  });
});
