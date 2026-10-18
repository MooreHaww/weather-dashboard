// Layout test: really resizes the app window and checks that no cards overlap,
// nothing spills out of its card, and short windows scroll instead of squeezing.
// Run with: npm run test:e2e

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type LaunchedApp } from '../../scripts/launch';

const favorites = [
  { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, country: 'Japan', countryCode: 'JP' },
  { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, country: 'United Kingdom', countryCode: 'GB' },
];

interface LayoutReport {
  viewport: [number, number];
  problems: string[];
  scroll: { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number };
}

/** Runs in the page: collects overlaps and overflow, returns a report. */
const CHECK_LAYOUT = `(() => {
  const problems = [];
  const box = (el) => el.getBoundingClientRect();
  const name = (el) => el.id || el.querySelector('.section-title')?.textContent.trim() || el.className;
  const visible = (el) => { const r = box(el); return r.width > 0 && r.height > 0; };
  const layout = document.querySelector('.layout');
  const top = layout.getBoundingClientRect().top;

  // Positions relative to the scroll content, so cards scrolled out of view still count.
  const rel = (el) => { const r = box(el); return { top: r.top - top + layout.scrollTop, bottom: r.bottom - top + layout.scrollTop, left: r.left, right: r.right }; };
  const overlap = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1;

  const blocks = [...document.querySelectorAll('.card, .sidebar > section')].filter(visible);
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++)
      if (overlap(rel(blocks[i]), rel(blocks[j]))) problems.push('overlap: ' + name(blocks[i]) + ' / ' + name(blocks[j]));

  // Content of each card must stay inside that card.
  const inner = '.stat, .hero-now, .hero-place, .chart-wrap, .hour-strip, .rain-summary, .temp-summary, .day, .card-header';
  for (const card of blocks.filter((b) => b.classList.contains('card'))) {
    const c = rel(card);
    for (const el of [...card.querySelectorAll(inner)].filter(visible)) {
      const r = rel(el);
      if (r.top < c.top - 1 || r.bottom > c.bottom + 1 || r.left < c.left - 1 || r.right > c.right + 1)
        problems.push('outside its card: ' + (el.className || el.tagName) + ' in ' + name(card));
    }
  }

  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth + 1) problems.push('page scrolls horizontally: ' + doc.scrollWidth + ' > ' + innerWidth);
  if (layout.scrollWidth > layout.clientWidth + 1) problems.push('layout scrolls horizontally: ' + layout.scrollWidth + ' > ' + layout.clientWidth);

  return {
    viewport: [innerWidth, innerHeight],
    problems,
    scroll: { scrollHeight: layout.scrollHeight, clientHeight: layout.clientHeight, scrollWidth: layout.scrollWidth, clientWidth: layout.clientWidth },
  };
})()`;

let app: LaunchedApp;

beforeAll(async () => {
  app = await launchApp({ lastPlace: favorites[0], favorites, recent: favorites, settings: { units: 'metric' } });
  await waitForDashboard(app.page);
  await app.page.waitFor(`document.querySelectorAll('#favorites .fav-icon').length === 2`, 20_000).catch(() => {});
});

afterAll(async () => {
  await app?.close();
});

async function check(width: number, height: number): Promise<LayoutReport> {
  await app.resize(width, height);
  const report = await app.page.evaluate<LayoutReport>(CHECK_LAYOUT);
  expect(report.problems, `at ${width}×${height} (viewport ${report.viewport.join('×')})`).toEqual([]);
  return report;
}

describe('layout at different window sizes', () => {
  it.each([
    [1360, 900],
    [1000, 700],
    [800, 600],
    [500, 900],
    [1000, 450],
  ])('%i×%i: no overlapping cards, nothing outside its card, no horizontal scroll', async (w, h) => {
    await check(w, h);
  });

  it('a short window scrolls vertically instead of squeezing the cards', async () => {
    const { scroll } = await check(1000, 450);
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    // The last card can be scrolled into view.
    await app.page.evaluate(`document.querySelector('.layout').scrollTop = 1e6`);
    const forecastBottom = await app.page.evaluate<number>(`document.getElementById('forecast').getBoundingClientRect().bottom`);
    expect(forecastBottom).toBeLessThanOrEqual(450 + 1);
    await app.page.evaluate(`document.querySelector('.layout').scrollTop = 0`);
  });

  it('survives maximize → restore → shorter window (like docking and restoring)', async () => {
    await app.maximize();
    expect((await app.page.evaluate<LayoutReport>(CHECK_LAYOUT)).problems).toEqual([]);
    await app.restore();
    await check(1000, 450);
  });

  it('threw no errors while resizing', () => {
    expect(app.errors).toEqual([]);
  });
});
