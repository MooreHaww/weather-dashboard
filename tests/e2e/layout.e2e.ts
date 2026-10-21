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

describe('stat dividers at every width (top card)', () => {
  // Runs in the page: reads the real layout of the six stats and the borders drawn on them.
  const READ_STATS = `(() => {
    const stats = [...document.querySelectorAll('.hero-stats .stat')];
    const rects = stats.map((s) => s.getBoundingClientRect());
    const rowTops = [...new Set(rects.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
    const colLefts = [...new Set(rects.map((r) => Math.round(r.left)))].sort((a, b) => a - b);
    return {
      width: innerWidth,
      cols: colLefts.length,
      rows: rowTops.length,
      stats: stats.map((s, i) => {
        const cs = getComputedStyle(s);
        const r = rects[i];
        return {
          label: s.querySelector('.stat-label span').textContent,
          row: rowTops.indexOf(Math.round(r.top)), col: colLefts.indexOf(Math.round(r.left)),
          left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          borderLeft: parseFloat(cs.borderLeftWidth), borderLeftStyle: cs.borderLeftStyle, borderLeftColor: cs.borderLeftColor,
          borderTop: parseFloat(cs.borderTopWidth), borderTopStyle: cs.borderTopStyle, borderTopColor: cs.borderTopColor,
          borderRight: parseFloat(cs.borderRightWidth), borderBottom: parseFloat(cs.borderBottomWidth),
        };
      }),
    };
  })()`;

  interface StatBox {
    label: string; row: number; col: number; left: number; right: number; top: number; bottom: number;
    borderLeft: number; borderLeftStyle: string; borderLeftColor: string;
    borderTop: number; borderTopStyle: string; borderTopColor: string;
    borderRight: number; borderBottom: number;
  }

  /** Columns the layout is expected to use at a window width (see the media queries in styles.css). */
  const expectedCols = (w: number) => (w <= 600 ? 2 : w <= 960 ? 3 : w <= 1240 ? 6 : 3);

  const widths = Array.from({ length: 19 }, (_, i) => 480 + i * 50); // 480, 530, ... 1380
  widths.push(1400);

  it.each(widths)('%i px wide: a line between columns and rows, none after the last', async (w) => {
    await app.resize(w, 800);
    const r = await app.page.evaluate<{ cols: number; rows: number; stats: StatBox[] }>(READ_STATS);
    const where = `at ${w} px (${r.cols} columns × ${r.rows} rows)`;
    expect(r.stats).toHaveLength(6);
    expect(r.cols, `column count ${where}`).toBe(expectedCols(w));
    expect(r.rows, `row count ${where}`).toBe(6 / expectedCols(w));

    const visible = (width: number, style: string, color: string) =>
      width >= 1 && style === 'solid' && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent';
    for (const s of r.stats) {
      const id = `${s.label} (row ${s.row}, col ${s.col}) ${where}`;
      // A vertical line on the left of every stat except the first in its row...
      expect(visible(s.borderLeft, s.borderLeftStyle, s.borderLeftColor), `left line: ${id}`).toBe(s.col > 0);
      // ...a horizontal line on top of every stat except those in the first row...
      expect(visible(s.borderTop, s.borderTopStyle, s.borderTopColor), `top line: ${id}`).toBe(s.row > 0);
      // ...and nothing after the last column or the last row.
      expect(s.borderRight, `right line: ${id}`).toBe(0);
      expect(s.borderBottom, `bottom line: ${id}`).toBe(0);
    }

    // The lines are unbroken: stats in a row touch each other and share the same height,
    // and each row sits directly under the one above.
    for (let row = 0; row < r.rows; row++) {
      const cells = r.stats.filter((s) => s.row === row).sort((a, b) => a.col - b.col);
      expect(cells, `cells in row ${row} ${where}`).toHaveLength(r.cols);
      for (let i = 1; i < cells.length; i++) {
        expect(Math.abs(cells[i]!.left - cells[i - 1]!.right), `gap in row ${row} ${where}`).toBeLessThan(1);
        expect(Math.abs(cells[i]!.top - cells[i - 1]!.top), `row ${row} uneven ${where}`).toBeLessThan(1);
        expect(Math.abs(cells[i]!.bottom - cells[i - 1]!.bottom), `row ${row} height ${where}`).toBeLessThan(1);
      }
      if (row > 0) {
        const above = r.stats.filter((s) => s.row === row - 1);
        expect(Math.abs(cells[0]!.top - above[0]!.bottom), `gap above row ${row} ${where}`).toBeLessThan(1);
      }
    }
  });
});

  it('threw no errors while resizing', () => {
    expect(app.errors).toEqual([]);
  });
});
