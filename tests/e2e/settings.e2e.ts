// Settings panel: opening/closing, focus handling, the frosted blur, and layout
// at every tested window size. Uses real mouse clicks and key presses.
// Run with: npm run test:e2e

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLORS, countPixels, launchApp, waitForDashboard, type AppPage, type LaunchedApp } from '../../scripts/launch';

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, country: 'Japan', countryCode: 'JP' };

let app: LaunchedApp;
let page: AppPage;

const isOpen = () => page.evaluate<boolean>(`!document.getElementById('settings').hidden`);
const activeId = () => page.evaluate<string>(`document.activeElement?.id || document.activeElement?.className || ''`);
const focusInPanel = () => page.evaluate<boolean>(`document.getElementById('settings-sheet').contains(document.activeElement)`);

/** Center of an element, for real clicks. */
async function centerOf(selector: string): Promise<[number, number]> {
  return page.evaluate<[number, number]>(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
  );
}

async function clickGear() {
  const [x, y] = await centerOf('#settings-button');
  await page.click(x, y);
}

/** Open with a real click and wait for the slide-in to finish. */
async function openPanel() {
  await clickGear();
  await page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 2000);
  await new Promise((r) => setTimeout(r, 400));
}

/** Wait for the panel to be fully closed (hidden after the slide-out). */
async function waitClosed() {
  await page.waitFor(`document.getElementById('settings').hidden`, 2000);
}

beforeAll(async () => {
  app = await launchApp({ lastPlace: tokyo, favorites: [tokyo], recent: [tokyo], settings: { units: 'metric' } });
  page = app.page;
  await waitForDashboard(page);
});

afterAll(async () => {
  await app?.close();
});

describe('settings panel', () => {
  it('starts closed, with an accessible gear button', async () => {
    expect(await isOpen()).toBe(false);
    const gear = await page.evaluate<Record<string, string | null>>(
      `(() => { const g = document.getElementById('settings-button'); return { label: g.getAttribute('aria-label'), expanded: g.getAttribute('aria-expanded'), controls: g.getAttribute('aria-controls'), popup: g.getAttribute('aria-haspopup') }; })()`,
    );
    expect(gear).toEqual({ label: 'Settings', expanded: 'false', controls: 'settings-sheet', popup: 'dialog' });
  });

  it('the gear opens a labelled modal dialog and moves focus into it', async () => {
    await openPanel();
    expect(await isOpen()).toBe(true);
    const dialog = await page.evaluate<Record<string, string | null>>(
      `(() => { const d = document.getElementById('settings-sheet'); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), name: document.getElementById(d.getAttribute('aria-labelledby')).textContent }; })()`,
    );
    expect(dialog).toEqual({ role: 'dialog', modal: 'true', name: 'Settings' });
    expect(await page.evaluate(`document.getElementById('settings-button').getAttribute('aria-expanded')`)).toBe('true');
    expect(await focusInPanel()).toBe(true);
    // Empty for this version: no placeholder text or fake options.
    expect(await page.evaluate(`document.getElementById('settings-sections').children.length`)).toBe(0);
    expect(await page.evaluate(`document.getElementById('settings-sections').textContent.trim()`)).toBe('');
  });

  it('frosts everything behind it, and the sheet itself is glass with rounded bottom corners', async () => {
    const styles = await page.evaluate<Record<string, string>>(`(() => {
      const scrim = getComputedStyle(document.querySelector('.settings-scrim'));
      const sheet = getComputedStyle(document.getElementById('settings-sheet'));
      return { scrim: scrim.backdropFilter, scrimBg: scrim.backgroundColor, sheet: sheet.backdropFilter,
        sheetBg: sheet.backgroundImage, bl: sheet.borderBottomLeftRadius, br: sheet.borderBottomRightRadius, tl: sheet.borderTopLeftRadius };
    })()`);
    const blurPx = (f: string) => Number(/blur\(([\d.]+)px\)/.exec(f)?.[1] ?? 0);
    expect(blurPx(styles.scrim!)).toBeGreaterThan(0);
    expect(blurPx(styles.sheet!)).toBeGreaterThan(0);
    expect(styles.scrimBg).toMatch(/rgba\(4, 8, 18, 0\.3\d*\)/); // slight darkening
    expect(styles.sheetBg).toContain('rgba'); // translucent
    expect(parseFloat(styles.bl!)).toBeGreaterThan(0);
    expect(parseFloat(styles.br!)).toBeGreaterThan(0);
    expect(parseFloat(styles.tl!)).toBe(0);
    // The rest of the app can't be focused or clicked while the panel is open.
    expect(await page.evaluate(`document.querySelector('.layout').inert && document.querySelector('.titlebar').inert`)).toBe(true);
  });

  it('keeps focus inside the panel (Tab and Shift+Tab)', async () => {
    for (let i = 0; i < 3; i++) {
      await page.press('Tab');
      expect(await focusInPanel()).toBe(true);
    }
    await page.press('Tab', { shift: true });
    expect(await focusInPanel()).toBe(true);
  });

  it('the clock and charts keep working while it is open', async () => {
    const before = await page.evaluate<string>(`document.getElementById('clock-time').textContent`);
    await new Promise((r) => setTimeout(r, 1300));
    expect(await page.evaluate<string>(`document.getElementById('clock-time').textContent`)).not.toBe(before);
    expect(await page.evaluate<number>(countPixels('temp-chart', COLORS.temperature))).toBeGreaterThan(150);
  });

  it('Escape closes it and focus returns to the gear', async () => {
    await page.press('Escape');
    await waitClosed();
    expect(await activeId()).toBe('settings-button');
    expect(await page.evaluate(`document.getElementById('settings-button').getAttribute('aria-expanded')`)).toBe('false');
    expect(await page.evaluate(`document.querySelector('.layout').inert`)).toBe(false);
  });

  it('a click on the blurred area outside the panel closes it', async () => {
    await openPanel();
    const [w, h] = await page.evaluate<[number, number]>(`[innerWidth, innerHeight]`);
    await page.click(w / 2, h - 10);
    await waitClosed();
    expect(await activeId()).toBe('settings-button');
  });

  it('a click inside the panel does not close it; the close button does', async () => {
    await openPanel();
    const [x, y] = await centerOf('#settings-sections');
    await page.click(x, y);
    await new Promise((r) => setTimeout(r, 300));
    expect(await isOpen()).toBe(true);

    const [cx, cy] = await centerOf('.settings-close');
    await page.click(cx, cy);
    await waitClosed();
    expect(await activeId()).toBe('settings-button');
  });

  it('the gear toggles: its spot holds the close button while the panel is open', async () => {
    const gear = await centerOf('#settings-button');
    await openPanel();
    const close = await centerOf('.settings-close');
    expect(Math.abs(close[0] - gear[0])).toBeLessThan(2);
    expect(Math.abs(close[1] - gear[1])).toBeLessThan(2);
    await page.click(gear[0], gear[1]); // same spot again
    await waitClosed();
  });

  it.each([
    [1360, 900],
    [1000, 700],
    [800, 600],
    [500, 900],
    [1000, 450],
  ])('%i×%i: the open panel fits, nothing overlaps, no horizontal scroll', async (w, h) => {
    await app.resize(w, h);
    await openPanel();
    const r = await page.evaluate<Record<string, number | boolean>>(`(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const sheet = box('#settings-sheet'), title = box('#settings-title'), close = box('.settings-close');
      return {
        vw: innerWidth, vh: innerHeight,
        sheetLeft: sheet.left, sheetRight: sheet.right, sheetBottom: sheet.bottom,
        titleRight: title.right, closeLeft: close.left, closeRight: close.right, closeTop: close.top,
        hScroll: document.documentElement.scrollWidth > innerWidth + 1,
      };
    })()`);
    expect(r.sheetLeft).toBeGreaterThanOrEqual(0);
    expect(r.sheetRight).toBeLessThanOrEqual(r.vw as number);
    expect(r.sheetBottom).toBeLessThan((r.vh as number) - 20); // blurred strip left to click
    expect(r.titleRight).toBeLessThanOrEqual(r.closeLeft as number);
    expect(r.closeRight).toBeLessThanOrEqual((r.vw as number) - 130); // clear of the window controls
    expect(r.closeTop).toBeGreaterThanOrEqual(0);
    expect(r.hScroll).toBe(false);
    await page.press('Escape');
    await waitClosed();
  });

  it('with reduced motion, it opens and closes instantly without sliding', async () => {
    await app.resize(1000, 700);
    await page.emulateReducedMotion(true);
    try {
      await clickGear();
      const now = await page.evaluate<Record<string, string | boolean>>(`(() => {
        const s = getComputedStyle(document.getElementById('settings-sheet'));
        return { open: !document.getElementById('settings').hidden, transform: s.transform, duration: s.transitionDuration };
      })()`);
      expect(now.open).toBe(true);
      expect(now.transform).toBe('none');
      expect(now.duration).toMatch(/^0s(, 0s)*$/);
      await page.press('Escape');
      expect(await isOpen()).toBe(false); // hidden immediately, no waiting for an animation
      expect(await activeId()).toBe('settings-button');
    } finally {
      await page.emulateReducedMotion(false);
    }
  });

  it('charts are still drawn after opening and closing', async () => {
    await page.waitFor(`${countPixels('temp-chart', COLORS.temperature)} > 150`, 8000);
  });

  it('threw no errors', () => {
    expect(app.errors).toEqual([]);
  });
});
