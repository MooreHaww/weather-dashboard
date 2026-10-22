// Settings panel: opening/closing, focus handling, the full-window glass, the
// Units and Time format settings (live updates, persistence) and layout at every
// tested window size. Uses real mouse clicks and key presses.
// Run with: npm run test:e2e

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, temperaturePainted, waitForDashboard, type AppPage, type LaunchedApp } from '../../scripts/launch';
import { localIsoIn } from '../../src/shared/time';

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, country: 'Japan', countryCode: 'JP' };

let app: LaunchedApp;
let page: AppPage;
/** Page exceptions from app instances that were already closed (the restart test). */
const earlierErrors: string[] = [];

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
  await new Promise((r) => setTimeout(r, 500));
}

/** Wait for the panel to be fully closed (hidden after the slide-out). */
async function waitClosed() {
  await page.waitFor(`document.getElementById('settings').hidden`, 2000);
}

/** Click an option of a settings control with a real click (the panel must be open). */
async function chooseOption(value: string) {
  const [x, y] = await centerOf(`#settings-sections button[data-value="${value}"]`);
  await page.click(x, y);
}

const checkedOptions = () =>
  page.evaluate<string[]>(
    `[...document.querySelectorAll('#settings-sections button[aria-checked="true"]')].map((b) => b.dataset.value)`,
  );
const clockText = () => page.evaluate<string>(`document.getElementById('clock-time').textContent`);
const windUnitIs = (unit: string) =>
  `[...document.querySelectorAll('.stat')].some((s) => s.querySelector('.stat-label span').textContent === 'Wind' && s.querySelector('small')?.textContent === ${JSON.stringify(unit)})`;
const statText = (label: string) =>
  page.evaluate<string>(
    `[...document.querySelectorAll('.stat')].find((s) => s.querySelector('.stat-label span').textContent === ${JSON.stringify(label)}).querySelector('.stat-value').textContent`,
  );
const chartLabels = (id: string) => page.evaluate<string[]>(`JSON.parse(document.getElementById(${JSON.stringify(id)}).dataset.labels)`);
const stripTimes = () =>
  page.evaluate<string[]>(`[...document.querySelectorAll('#temp-strip .hour:not([hidden]) .hour-time')].map((e) => e.textContent)`);

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
    // Exactly the real sections: no placeholders for startup, close behavior or widget.
    expect(await page.evaluate(`[...document.querySelectorAll('#settings-sections h3')].map((h) => h.textContent)`)).toEqual([
      'Units',
      'Time format',
      'Temperature chart',
    ]);
    expect(await checkedOptions()).toEqual(['metric', 'kmh', '12h', '3h']);
  });

  it('is a full-window liquid-glass layer that blurs the app behind it', async () => {
    const r = await page.evaluate<Record<string, string | number | boolean>>(`(() => {
      const sheet = document.getElementById('settings-sheet');
      const s = getComputedStyle(sheet);
      const b = sheet.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, vw: innerWidth, vh: innerHeight,
        backdrop: s.backdropFilter, bg: s.backgroundImage, shadow: s.boxShadow, radius: s.borderTopLeftRadius,
        noScrim: document.querySelector('.settings-scrim') === null };
    })()`);
    // Covers the whole window (within a pixel: the slide-in easing may still be settling).
    for (const [got, want] of [[r.left, 0], [r.top, 0], [r.right, r.vw], [r.bottom, r.vh]] as [number, number][]) {
      expect(Math.abs(got - want)).toBeLessThan(1);
    }
    const blurPx = Number(/blur\(([\d.]+)px\)/.exec(r.backdrop as string)?.[1] ?? 0);
    expect(blurPx).toBeGreaterThanOrEqual(30); // strong backdrop blur
    expect(r.backdrop).toContain('saturate'); // a bit of saturation
    expect(r.bg).toContain('rgba'); // translucent glass layers
    expect(r.shadow).toContain('inset'); // light edge and inner glow
    expect(parseFloat(r.radius as string)).toBe(0);
    expect(r.noScrim).toBe(true); // the glass itself does the blurring
    // The rest of the app can't be focused or clicked while the panel is open.
    expect(await page.evaluate(`document.querySelector('.layout').inert && document.querySelector('.titlebar').inert`)).toBe(true);
  });

  it('the title bar stays draggable and the window buttons stay clear and visible', async () => {
    const r = await page.evaluate<Record<string, string | number>>(`(() => {
      const header = document.querySelector('.settings-header');
      const close = document.querySelector('.settings-close');
      return { drag: getComputedStyle(header).webkitAppRegion, closeNoDrag: getComputedStyle(close).webkitAppRegion,
        headerHeight: header.getBoundingClientRect().height, closeRight: close.getBoundingClientRect().right, vw: innerWidth };
    })()`);
    expect(r.drag).toBe('drag');
    expect(r.closeNoDrag).toBe('no-drag');
    expect(r.headerHeight).toBe(52);
    expect(r.closeRight).toBeLessThanOrEqual((r.vw as number) - 130); // the right 150 px belong to Windows
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
    expect(await page.evaluate<number>(temperaturePainted())).toBeGreaterThan(150);
  });

  it('Escape closes it and focus returns to the gear', async () => {
    await page.press('Escape');
    await waitClosed();
    expect(await activeId()).toBe('settings-button');
    expect(await page.evaluate(`document.getElementById('settings-button').getAttribute('aria-expanded')`)).toBe('false');
    expect(await page.evaluate(`document.querySelector('.layout').inert`)).toBe(false);
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
  ])('%i×%i: the panel covers the window, content scrolls, nothing overlaps', async (w, h) => {
    await app.resize(w, h);
    await openPanel();
    const r = await page.evaluate<Record<string, number | boolean | string>>(`(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const sheet = box('#settings-sheet'), title = box('#settings-title'), close = box('.settings-close');
      const sections = document.getElementById('settings-sections');
      sections.scrollTop = sections.scrollHeight; // scroll all the way down, like the user would
      const lastRect = sections.lastElementChild.getBoundingClientRect(), area = sections.getBoundingClientRect();
      const out = {
        vw: innerWidth, vh: innerHeight,
        sheetLeft: sheet.left, sheetTop: sheet.top, sheetRight: sheet.right, sheetBottom: sheet.bottom,
        titleRight: title.right, closeLeft: close.left, closeRight: close.right, closeTop: close.top, closeBottom: close.bottom,
        hScroll: document.documentElement.scrollWidth > innerWidth + 1 || sections.scrollWidth > sections.clientWidth + 1,
        overflowY: getComputedStyle(sections).overflowY,
        lastVisible: lastRect.bottom <= area.bottom + 1 && lastRect.top >= area.top - 1,
        bodyScrolls: document.scrollingElement.scrollHeight > innerHeight + 1,
      };
      sections.scrollTop = 0;
      return out;
    })()`);
    for (const [got, want] of [[r.sheetLeft, 0], [r.sheetTop, 0], [r.sheetRight, r.vw], [r.sheetBottom, r.vh]] as [number, number][]) {
      expect(Math.abs(got - want)).toBeLessThan(1);
    }
    expect(r.overflowY).toBe('auto');
    expect(r.lastVisible).toBe(true); // the last section can always be scrolled into view
    expect(r.titleRight).toBeLessThanOrEqual(r.closeLeft as number);
    expect(r.closeRight).toBeLessThanOrEqual((r.vw as number) - 130); // clear of the window controls
    expect(r.closeTop).toBeGreaterThanOrEqual(0);
    expect(r.closeBottom).toBeLessThanOrEqual(52);
    expect(r.hScroll).toBe(false);
    expect(r.bodyScrolls).toBe(false); // only the panel's content area scrolls
    await page.press('Escape');
    await waitClosed();
  });

  it('with reduced motion, it fades instead of sliding', async () => {
    await app.resize(1000, 700);
    await page.emulateReducedMotion(true);
    try {
      await clickGear();
      const now = await page.evaluate<Record<string, string | boolean>>(`(() => {
        const s = getComputedStyle(document.getElementById('settings-sheet'));
        return { open: !document.getElementById('settings').hidden, transform: s.transform, property: s.transitionProperty, duration: s.transitionDuration };
      })()`);
      expect(now.open).toBe(true);
      expect(now.transform).toBe('none'); // no slide
      expect(now.property).toBe('opacity'); // a simple fade
      expect(parseFloat(now.duration as string)).toBeGreaterThan(0);
      expect(parseFloat(now.duration as string)).toBeLessThanOrEqual(0.2);
      await page.press('Escape');
      await waitClosed();
      expect(await activeId()).toBe('settings-button');
    } finally {
      await page.emulateReducedMotion(false);
    }
  });

  it('Units is the only place to change °C/°F: the title bar has no toggle', async () => {
    await app.resize(1000, 700);
    expect(await page.evaluate<number>(`document.querySelectorAll('.titlebar .units, .titlebar [data-units]').length`)).toBe(0);
    expect(await page.evaluate<number>(`document.querySelectorAll('.titlebar button').length`)).toBe(1); // just the gear
    await openPanel();
    await chooseOption('imperial');
    await page.waitFor(`document.querySelector('.hero-temp').textContent.endsWith('°F')`, 8000);
    expect(await page.evaluate<string>(`document.title`)).toContain('°F');
    expect(await checkedOptions()).toContain('imperial');
    await chooseOption('metric');
    await page.waitFor(`document.querySelector('.hero-temp').textContent.endsWith('°C')`, 8000);
    expect(await checkedOptions()).toContain('metric');
    await page.press('Escape');
    await waitClosed();
  });

  it.each([480, 600, 860, 1000, 1360])('%i px wide: search box and gear fit in the title bar, clear of the window buttons', async (w) => {
    await app.resize(w, 700);
    const r = await page.evaluate<Record<string, number>>(`(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const search = box('#search'), gear = box('#settings-button'), brand = box('.brand');
      return { vw: innerWidth, searchLeft: search.left, searchRight: search.right, searchHeight: search.height, gearLeft: gear.left, gearRight: gear.right,
        gearTop: gear.top, gearBottom: gear.bottom, brandRight: brand.right, brandLeft: brand.left };
    })()`);
    expect(r.searchRight).toBeLessThanOrEqual(r.gearLeft! - 4); // search never touches the gear
    expect(r.searchLeft).toBeGreaterThanOrEqual(r.brandRight!);
    expect(r.searchRight! - r.searchLeft!).toBeGreaterThan(120); // still usable
    expect(r.gearRight).toBeLessThanOrEqual(r.vw! - 130); // clear of the Windows buttons
    expect(r.gearTop).toBeGreaterThanOrEqual(0);
    expect(r.gearBottom).toBeLessThanOrEqual(52);
  });

  it('Time format: 24-hour updates the clock, strip, chart labels, sun times and rain line at once', async () => {
    await page.waitFor(`${temperaturePainted()} > 150`, 8000);
    expect(await clockText()).toMatch(/(AM|PM)$/);
    await openPanel();
    await chooseOption('24h');
    // No reload: the same page, updated in place.
    await page.waitFor(`/^\\d{2}:\\d{2}:\\d{2}$/.test(document.getElementById('clock-time').textContent)`, 2000);
    expect(await checkedOptions()).toContain('24h');
    const strip = await stripTimes();
    expect(strip.length).toBeGreaterThan(0);
    expect(strip.every((x) => /^\d{2}:00$/.test(x))).toBe(true);
    const rain = await chartLabels('rain-chart');
    expect(rain.length).toBeGreaterThan(0);
    expect(rain.every((l) => /^\d{2}:00$/.test(l))).toBe(true);
    const temp = await chartLabels('temp-chart');
    expect(temp).toHaveLength(24);
    expect(temp.every((l) => /^\d{2}:00$/.test(l))).toBe(true);
    expect(await statText('Sunrise')).toMatch(/^\d{2}:\d{2}$/);
    expect(await statText('Sunset')).toMatch(/^\d{2}:\d{2}$/);
    const text = await page.evaluate<string>(
      `['rain-summary', 'temp-summary', 'rain-data', 'temp-data'].map((id) => document.getElementById(id).textContent).join(' ')`,
    );
    expect(text).not.toMatch(/\b(AM|PM)\b/);

    await chooseOption('12h');
    await page.waitFor(`/(AM|PM)$/.test(document.getElementById('clock-time').textContent)`, 2000);
    expect((await chartLabels('rain-chart')).every((l) => /^\d{1,2} (AM|PM)$/.test(l))).toBe(true);
    expect(await statText('Sunrise')).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    await page.press('Escape');
    await waitClosed();
  });

  it('Wind speed: choosing m/s or mph changes the Wind stat', async () => {
    await page.waitFor(windUnitIs('km/h'), 5000);
    await openPanel();
    await chooseOption('ms');
    await page.waitFor(windUnitIs('m/s'), 15_000);
    expect(await checkedOptions()).toContain('ms');
    await chooseOption('mph');
    await page.waitFor(windUnitIs('mph'), 15_000);
    await page.press('Escape');
    await waitClosed();
  });

  it('Time format: its own section, with examples from the current time and a line saying where it applies', async () => {
    const info = await page.evaluate<{ title: string; desc: string; labels: string[]; values: string[] }>(`(() => {
      const s = document.getElementById('settings-time-format');
      const b = [...s.querySelectorAll('button')];
      return { title: s.querySelector('h3').textContent, desc: s.querySelector('.settings-section-description').textContent, labels: b.map((x) => x.textContent), values: b.map((x) => x.dataset.value) };
    })()`);
    expect(info.title).toBe('Time format');
    expect(info.desc).toMatch(/clock.*hourly.*sunrise and sunset/i);
    expect(info.values).toEqual(['12h', '24h']);
    const tokyoNow = localIsoIn('Asia/Tokyo');
    const m24 = info.labels[1]!.match(/^24-hour \((\d{2}):(\d{2})\)$/);
    const m12 = info.labels[0]!.match(/^12-hour \((\d{1,2}):(\d{2}) (AM|PM)\)$/);
    expect(m24).not.toBeNull();
    expect(m12).not.toBeNull();
    // The example is Tokyo's current time (the selected city), to within a couple of minutes.
    const shown = Number(m24![1]) * 60 + Number(m24![2]);
    const actual = Number(tokyoNow.slice(11, 13)) * 60 + Number(tokyoNow.slice(14, 16));
    expect(Math.min(Math.abs(shown - actual), 1440 - Math.abs(shown - actual))).toBeLessThanOrEqual(2);
    const h12 = Number(m12![1]) % 12 + (m12![3] === 'PM' ? 12 : 0);
    expect(h12).toBe(Number(m24![1]));
  });

  it('Temperature chart: "Time labels" applies instantly, and thins out when the window is narrow', async () => {
    await app.resize(1360, 900);
    await page.evaluate(`window.__sameDocument = true`);
    const strip = () =>
      page.evaluate<{ requested: string; step: string; shown: number[] }>(`(() => {
        const s = document.getElementById('temp-strip');
        return { requested: s.dataset.requestedStep, step: s.dataset.step, shown: [...s.querySelectorAll('.hour:not([hidden])')].map((e) => Number(e.dataset.index)) };
      })()`);
    const everyNth = (shown: number[], n: number) => shown.every((v, k) => v === k * n) && shown.length === Math.ceil(24 / n);

    await openPanel();
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll('#settings-temperature-chart button')].map((b) => b.textContent)`)).toEqual([
      'Every 3 hours',
      'Every 2 hours',
      'Every hour',
    ]);
    expect(await checkedOptions()).toContain('3h'); // the default
    let s = await strip();
    expect([s.requested, s.step]).toEqual(['3', '3']);
    expect(everyNth(s.shown, 3)).toBe(true);

    await chooseOption('2h');
    await page.waitFor(`document.getElementById('temp-strip').dataset.requestedStep === '2'`, 2000);
    s = await strip();
    expect(Number(s.step)).toBeGreaterThanOrEqual(2);
    expect(everyNth(s.shown, Number(s.step))).toBe(true);

    await chooseOption('1h');
    await page.waitFor(`document.getElementById('temp-strip').dataset.requestedStep === '1'`, 2000);
    s = await strip();
    expect(everyNth(s.shown, Number(s.step))).toBe(true);
    const wideStep = Number(s.step);
    const stripWidth = () => page.evaluate<number>(`document.getElementById('temp-strip').getBoundingClientRect().width`);
    const wideWidth = await stripWidth();

    // At 1000 px the two charts sit side by side and the temperature card is at its narrowest:
    // the labels thin to a coarser step, still every n-th hour. Wide again: back to what fits.
    await page.press('Escape');
    await waitClosed();
    await app.resize(1000, 900);
    await page.waitFor(`Number(document.getElementById('temp-strip').dataset.step) > ${wideStep}`, 3000);
    s = await strip();
    expect(await stripWidth()).toBeLessThan(wideWidth);
    expect(s.requested).toBe('1');
    expect(everyNth(s.shown, Number(s.step))).toBe(true);
    await app.resize(1360, 900);
    await page.waitFor(`Number(document.getElementById('temp-strip').dataset.step) === ${wideStep}`, 3000);
    expect(await page.evaluate<boolean>(`window.__sameDocument === true`)).toBe(true); // never reloaded
    await openPanel();
    await chooseOption('3h');
    await page.waitFor(`document.getElementById('temp-strip').dataset.step === '3'`, 2000);
    await page.press('Escape');
    await waitClosed();
  });

  it('settings persist after a restart', async () => {
    await openPanel();
    await chooseOption('24h');
    await chooseOption('ms');
    await chooseOption('2h');
    await page.press('Escape');
    await waitClosed();

    // The save is fire-and-forget: wait until it reached the file, then quit and relaunch on the same data.
    const file = path.join(app.dataDir, 'weather-dashboard.json');
    const saved = async () => {
      const s = JSON.parse(await readFile(file, 'utf8')).settings;
      return s.timeFormat === '24h' && s.windUnit === 'ms' && s.tempLabels === '2h';
    };
    for (let i = 0; i < 40 && !(await saved().catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
    expect(await saved()).toBe(true);

    earlierErrors.push(...app.errors);
    const dataDir = app.dataDir;
    await app.close({ keepData: true });
    app = await launchApp(undefined, { dataDir });
    page = app.page;
    await waitForDashboard(page);

    await page.waitFor(`/^\\d{2}:\\d{2}:\\d{2}$/.test(document.getElementById('clock-time').textContent)`, 5000);
    await page.waitFor(windUnitIs('m/s'), 15_000);
    await openPanel();
    expect(await checkedOptions()).toEqual(expect.arrayContaining(['24h', 'ms', '2h']));
    expect(await page.evaluate<string>(`document.getElementById('temp-strip').dataset.requestedStep`)).toBe('2');
    await page.press('Escape');
    await waitClosed();
  });

  it('charts are still drawn after all of that', async () => {
    await page.waitFor(`${temperaturePainted()} > 150`, 8000);
  });

  it('threw no errors', () => {
    expect([...earlierErrors, ...app.errors]).toEqual([]);
  });
});
