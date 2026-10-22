// The hourly strip under the temperature chart, measured from the real layout:
// one row, equal spacing, nothing overlapping or clipped, at every window width and
// for every "Time labels" setting; and the current-time dot sitting at the right x.
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
  /** The dot over the chart: its centre (CSS px from the canvas's left), whether it is shown, and the x the chart reports. */
  dot: { visible: boolean; cx: number; cy: number };
  nowX: number | null;
  noNowLabel: boolean;
  strip: Box;
  card: Box;
}

/** Real positions, in CSS pixels relative to the temperature canvas. */
const MEASURE = `(() => {
  const canvas = document.getElementById('temp-chart');
  const strip = document.getElementById('temp-strip');
  const cr = canvas.getBoundingClientRect();
  const cl = cr.left;
  const rel = (r) => ({ left: r.left - cl, right: r.right - cl, top: r.top, bottom: r.bottom });
  const dotEl = document.getElementById('now-dot');
  const core = dotEl.querySelector('.core').getBoundingClientRect();
  return {
    width: innerWidth,
    step: Number(strip.dataset.step),
    requested: Number(strip.dataset.requestedStep),
    shown: [...strip.querySelectorAll('.hour:not([hidden])')].map((e) => {
      const r = e.getBoundingClientRect();
      return { i: Number(e.dataset.index), text: e.querySelector('.hour-time').textContent, cx: (r.left + r.right) / 2 - cl, box: rel(r), textWidth: e.querySelector('.hour-time').getBoundingClientRect().width };
    }),
    dot: { visible: getComputedStyle(dotEl).display !== 'none', cx: (core.left + core.right) / 2 - cl, cy: (core.top + core.bottom) / 2 - cr.top },
    nowX: canvas.dataset.nowX === undefined ? null : Number(canvas.dataset.nowX),
    noNowLabel: strip.querySelector('.now-label, .now-row') === null,
    strip: rel(strip.getBoundingClientRect()),
    card: rel(strip.closest('.card').getBoundingClientRect()),
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

  // One row: no "Now" label, and every label at the same height.
  expect(m.noNowLabel, ctx).toBe(true);
  expect(new Set(m.shown.map((x) => Math.round(x.box.top))).size, `${ctx} one row`).toBe(1);

  if (!opts.today) {
    expect(m.dot.visible, ctx).toBe(false);
    expect(m.nowX, ctx).toBeNull();
    return;
  }
  expect(m.dot.visible, ctx).toBe(true);
  expect(m.nowX, ctx).not.toBeNull();
  // The visible dot is where the chart says "now" is.
  expect(Math.abs(m.dot.cx - m.nowX!), `${ctx}: dot ${m.dot.cx.toFixed(2)} vs chart ${m.nowX}`).toBeLessThanOrEqual(0.6);
}

/**
 * The dot sits at the x of the city's time on the hour labels' own scale: the first and last
 * labels give hours-to-pixels, so the expected x for hour + minutes can be computed from them.
 * The line ends at 11 PM, so the dot rests there during the last hour.
 */
function expectDotAtTime(m: Measure, hh: number, mm: number, label: string) {
  const first = m.shown[0]!;
  const last = m.shown[m.shown.length - 1]!;
  const perHour = (last.cx - first.cx) / (last.i - first.i);
  const expected = first.cx + (Math.min(hh + mm / 60, 23) - first.i) * perHour;
  expect(Math.abs(m.dot.cx - expected), `${label}: dot ${m.dot.cx.toFixed(2)} expected ${expected.toFixed(2)}`).toBeLessThanOrEqual(1.5);
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

    it.each(WIDTHS)('is one evenly spaced, unclipped row, with the dot where the chart says, at %ipx wide', async (width) => {
      await app.resize(width, 900);
      await settle();
      const m = await measure();
      expect(m.requested).toBe(Number(step[0]));
      expectStripIsSound(m, `${step} today`, { today: true });
    });

    it('other days: the same even strip, and no dot', async () => {
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

describe('the dot at the edges of the day (Tokyo clock moved to 00:10, 12:30 and 23:50), every hour shown', () => {
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
      expectStripIsSound(m, `${hh}:${mm}`, { today: true });
      expectDotAtTime(m, hh, mm, `${hh}:${mm} @${width}px`);
      // And its accessible name reads that time (12-hour).
      const h12 = hh % 12 === 0 ? 12 : hh % 12;
      const expected = `Current time: ${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
      expect(await page.evaluate<string>(`document.getElementById('now-dot').getAttribute('aria-label')`)).toMatch(new RegExp(`^Current time: ${h12}:\\d{2} ${hh < 12 ? 'AM' : 'PM'}$`));
      expect(expected).toMatch(/^Current time: /);
    });
  }

  it('the dot moves with the minute while the hour labels stay put', async () => {
    await app.resize(1000, 900);
    await setTokyoTime(12, 30);
    const a = await measure();
    await setTokyoTime(12, 59);
    const b = await measure();
    expect(b.dot.cx - a.dot.cx).toBeGreaterThan(5); // the dot moved
    expectDotAtTime(b, 12, 59, '12:59');
    expect(b.shown.map((x) => x.cx)).toEqual(a.shown.map((x) => x.cx)); // the labels did not
  });

  it('the accessible name follows the format setting (12-hour and 24-hour)', async () => {
    await app.resize(1000, 900);
    await setTokyoTime(16, 37);
    const label = () => page.evaluate<string>(`document.getElementById('now-dot').getAttribute('aria-label')`);
    expect(await label()).toMatch(/^Current time: 4:3[78] PM$/);
    await page.evaluate(`document.querySelector('#settings-sections button[data-value="24h"]').click()`);
    await page.waitFor(`/^Current time: \\d{2}:\\d{2}$/.test(document.getElementById('now-dot').getAttribute('aria-label'))`, 3000);
    await setTokyoTime(16, 37);
    expect(await label()).toMatch(/^Current time: 16:3[78]$/);
    expect(await page.evaluate<string>(`document.getElementById('now-dot').title`)).toBe(await label());
    await page.evaluate(`document.querySelector('#settings-sections button[data-value="12h"]').click()`);
    await page.waitFor(`/(AM|PM)$/.test(document.getElementById('now-dot').getAttribute('aria-label'))`, 3000);
  });

  it('threw no page exceptions', () => {
    expect(app.errors).toEqual([]);
  });
});
