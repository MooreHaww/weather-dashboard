// The hourly strip under the temperature chart, measured from the real layout:
// equal spacing, nothing overlapping or clipped, and the "Now" label centred on
// the dot, at every window width and for every "Time labels" setting.
// Real Electron window, live Open-Meteo. Run with: npm run test:e2e

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type AppPage, type LaunchedApp } from '../../scripts/launch';
import { LABEL_STEPS } from '../../src/shared/labelStep';
import { localIsoIn } from '../../src/shared/time';
import type { TempLabels } from '../../src/shared/types';

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' };

const WIDTHS = [480, 600, 800, 1000, 1200, 1400];

/**
 * Runs before the app's scripts: the app's own timers are held in window.__timers
 * (fired by the test), and "now" can be shifted with window.__setSkew(ms) so a test
 * can put Tokyo's clock at any time of day.
 */
const INIT_SCRIPT = `(() => {
  const RealDate = Date;
  let skew = 0;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
    static now() { return RealDate.now() + skew; }
  }
  window.Date = FakeDate;
  window.__setSkew = (ms) => { skew = ms; };
  window.__timers = {};
  const realSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...rest) => {
    if (ms === 300000 || ms === 60000) { window.__timers[ms] = fn; return 0; }
    return realSetInterval(fn, ms, ...rest);
  };
})()`;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
interface Measure {
  width: number;
  step: number;
  requested: number;
  shown: { i: number; text: string; cx: number; box: Box; textWidth: number }[];
  now: { visible: boolean; cx: number; box: Box } | null;
  nowX: number | null;
  strip: Box;
  card: Box;
  canvasLeft: number;
}

/** Real positions, in CSS pixels relative to the temperature canvas. */
const MEASURE = `(() => {
  const canvas = document.getElementById('temp-chart');
  const strip = document.getElementById('temp-strip');
  const cl = canvas.getBoundingClientRect().left;
  const rel = (r) => ({ left: r.left - cl, right: r.right - cl, top: r.top, bottom: r.bottom });
  const nowEl = strip.querySelector('.now-label');
  const nr = nowEl.getBoundingClientRect();
  return {
    width: innerWidth,
    step: Number(strip.dataset.step),
    requested: Number(strip.dataset.requestedStep),
    shown: [...strip.querySelectorAll('.hour:not([hidden])')].map((e) => {
      const r = e.getBoundingClientRect();
      return { i: Number(e.dataset.index), text: e.querySelector('.hour-time').textContent, cx: (r.left + r.right) / 2 - cl, box: rel(r), textWidth: e.querySelector('.hour-time').getBoundingClientRect().width };
    }),
    now: { visible: getComputedStyle(nowEl).visibility === 'visible', cx: (nr.left + nr.right) / 2 - cl, box: rel(nr) },
    nowX: canvas.dataset.nowX === undefined ? null : Number(canvas.dataset.nowX),
    strip: rel(strip.getBoundingClientRect()),
    card: rel(strip.closest('.card').getBoundingClientRect()),
    canvasLeft: cl,
  };
})()`;

let app: LaunchedApp;
let page: AppPage;

const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

async function measure(): Promise<Measure> {
  return page.evaluate<Measure>(MEASURE);
}

/** Every check the strip has to pass, whatever the window width, setting or time of day. */
function expectStripIsSound(m: Measure, label: string, opts: { today: boolean }) {
  const ctx = `${label} @${m.width}px`;
  // Only ever a whole-number step from the list, never finer than asked.
  expect(LABEL_STEPS as readonly number[], ctx).toContain(m.step);
  expect(m.step, ctx).toBeGreaterThanOrEqual(m.requested);

  // Every regular label is there: exactly the multiples of the step, none dropped near "now".
  expect(m.shown.map((s) => s.i), ctx).toEqual(Array.from({ length: Math.ceil(24 / m.step) }, (_, k) => k * m.step));

  // Equal spacing: neighbours are the same distance apart (the hours between them are the same).
  const gaps = m.shown.slice(1).map((s, k) => s.cx - m.shown[k]!.cx);
  expect(Math.max(...gaps) - Math.min(...gaps), `${ctx} gaps ${gaps.map((g) => g.toFixed(1))}`).toBeLessThanOrEqual(1);

  // No overlaps, and every label has room for its text.
  m.shown.slice(1).forEach((s, k) => expect(s.box.left, `${ctx} overlap at ${s.text}`).toBeGreaterThanOrEqual(m.shown[k]!.box.right));
  m.shown.forEach((s) => expect(s.textWidth, `${ctx} ${s.text} wider than its box`).toBeLessThanOrEqual(s.box.right - s.box.left));

  // Nothing clipped: every label sits inside the strip, which sits inside the card.
  expect(m.strip.left, ctx).toBeGreaterThanOrEqual(m.card.left);
  expect(m.strip.right, ctx).toBeLessThanOrEqual(m.card.right + 0.5);
  m.shown.forEach((s) => {
    expect(s.box.left, `${ctx} ${s.text} clipped on the left`).toBeGreaterThanOrEqual(m.strip.left - 0.5);
    expect(s.box.right, `${ctx} ${s.text} clipped on the right`).toBeLessThanOrEqual(m.strip.right + 0.5);
  });

  const now = m.now!;
  if (!opts.today) {
    expect(now.visible, ctx).toBe(false);
    expect(m.nowX, ctx).toBeNull();
    return;
  }
  expect(now.visible, ctx).toBe(true);
  expect(m.nowX, ctx).not.toBeNull();
  // "Now" is centred on the dot, within 1 px.
  expect(Math.abs(now.cx - m.nowX!), `${ctx}: Now ${now.cx.toFixed(2)} vs dot ${m.nowX}`).toBeLessThanOrEqual(1);
  // It is on its own row: above the hour labels, never on top of one, and not clipped.
  m.shown.forEach((s) => expect(now.box.bottom, `${ctx} Now overlaps ${s.text}`).toBeLessThanOrEqual(s.box.top + 0.5));
  expect(now.box.left, ctx).toBeGreaterThanOrEqual(m.strip.left - 0.5);
  expect(now.box.right, ctx).toBeLessThanOrEqual(m.strip.right + 0.5);
}

for (const step of ['3h', '2h', '1h'] as TempLabels[]) {
  describe(`hourly strip, "Time labels": ${step}`, () => {
    beforeAll(async () => {
      app = await launchApp({ lastPlace: tokyo, favorites: [tokyo], recent: [tokyo], settings: { units: 'metric', tempLabels: step } });
      page = app.page;
      await page.reloadWithScript(INIT_SCRIPT);
      await waitForDashboard(page);
      await page.waitFor(`document.getElementById('temp-chart').dataset.nowX !== undefined`, 8000);
    });

    afterAll(async () => {
      await app?.close();
    });

    it.each(WIDTHS)('is evenly spaced, unclipped, with "Now" under the dot, at %ipx wide', async (width) => {
      await app.resize(width, 900);
      await settle();
      const m = await measure();
      expect(m.requested).toBe(Number(step[0]));
      expectStripIsSound(m, `${step} today`, { today: true });
    });

    it('other days: the same even strip, and no "Now"', async () => {
      for (const width of [480, 1000]) {
        await app.resize(width, 900);
        await page.evaluate(`document.querySelectorAll('.forecast .day')[2].click()`);
        await settle();
        expectStripIsSound(await measure(), `${step} other day`, { today: false });
      }
      await page.evaluate(`document.querySelectorAll('.forecast .day')[0].click()`);
      await settle();
    });

    it('the step only gets coarser as the strip gets narrower', async () => {
      // The charts sit side by side on wide windows and stack on narrow ones, so compare
      // by the strip's own width, not the window's.
      const seen: { stripWidth: number; step: number }[] = [];
      for (const width of WIDTHS) {
        await app.resize(width, 900);
        await settle();
        const m = await measure();
        seen.push({ stripWidth: m.strip.right - m.strip.left, step: m.step });
      }
      const wideToNarrow = [...seen].sort((a, b) => b.stripWidth - a.stripWidth);
      const steps = wideToNarrow.map((s) => s.step);
      expect(steps, `(strip width, step): ${JSON.stringify(wideToNarrow)}`).toEqual([...steps].sort((a, b) => a - b));
      expect(steps[0]).toBeGreaterThanOrEqual(Number(step[0]));
    });

    it('threw no page exceptions', () => {
      expect(app.errors).toEqual([]);
    });
  });
}

describe('"Now" at the edges of the day (Tokyo clock moved to 00:10, 12:30 and 23:50), every hour shown', () => {
  beforeAll(async () => {
    app = await launchApp({ lastPlace: tokyo, favorites: [tokyo], recent: [tokyo], settings: { units: 'metric', tempLabels: '1h' } });
    page = app.page;
    await page.reloadWithScript(INIT_SCRIPT);
    await waitForDashboard(page);
    await page.waitFor(`document.getElementById('temp-chart').dataset.nowX !== undefined`, 8000);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Make Tokyo's clock read hh:mm today, then let the app's one-minute tick redraw. */
  async function setTokyoTime(hh: number, mm: number) {
    const t = localIsoIn('Asia/Tokyo');
    const nowMin = Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
    await page.evaluate(`window.__setSkew(${(hh * 60 + mm - nowMin) * 60_000})`);
    await page.evaluate(`window.__timers[60000]()`);
    await settle(900);
  }

  for (const [hh, mm] of [
    [0, 10],
    [12, 30],
    [23, 50],
  ] as const) {
    it.each([480, 1400])(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} at %ipx`, async (width) => {
      await app.resize(width, 900);
      await setTokyoTime(hh, mm);
      const m = await measure();
      const label = await page.evaluate<string>(`document.getElementById('clock-time').textContent`);
      expect(label).toBeTruthy();
      expectStripIsSound(m, `${hh}:${mm}`, { today: true });
    });
  }

  it('the label follows the dot when the minute ticks (12:30 then 12:59)', async () => {
    await app.resize(1000, 900);
    await setTokyoTime(12, 30);
    const a = await measure();
    await setTokyoTime(12, 59);
    const b = await measure();
    expect(b.nowX! - a.nowX!).toBeGreaterThan(5); // the dot moved
    expect(Math.abs(b.now!.cx - b.nowX!)).toBeLessThanOrEqual(1); // and the label moved with it
    expect(b.shown.map((s) => s.cx)).toEqual(a.shown.map((s) => s.cx)); // while the hour labels stayed put
  });

  it('threw no page exceptions', () => {
    expect(app.errors).toEqual([]);
  });
});
