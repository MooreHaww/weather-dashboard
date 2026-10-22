import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type Plugin,
  type ScriptableContext,
} from 'chart.js';
import type { NowMarker } from '../shared/passed';
import type { HourPoint } from '../shared/rain';
import { formatHour } from '../shared/time';
import type { TimeFormat } from '../shared/types';

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Filler, Tooltip);

Chart.defaults.color = 'rgba(226, 232, 240, 0.65)';
Chart.defaults.font.family = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
Chart.defaults.font.size = 11;
// Change single settings only. Assigning a new object to Chart.defaults.animation
// drops the internals Chart.js animates numbers with ("this._fn is not a
// function"), and the charts stay empty. Animations follow Windows'
// "Animation effects" setting (Settings > Accessibility > Visual effects).
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  Chart.defaults.animation = false;
} else if (Chart.defaults.animation) {
  Chart.defaults.animation.duration = 450;
}

export const SERIES_COLORS = {
  temperature: '#FFB547',
  feelsLike: '#C4B5FD',
  rain: 'rgba(90, 176, 255, 1)',
  rainHighlight: '#7CC4FF',
  // Hours that have already passed today: no colour, just grey.
  passed: 'rgba(148, 163, 184, 0.5)',
  passedFeelsLike: 'rgba(148, 163, 184, 0.38)',
};

const GRID = 'rgba(255, 255, 255, 0.06)';

const tooltip = {
  backgroundColor: 'rgba(15, 23, 42, 0.92)',
  borderColor: 'rgba(255, 255, 255, 0.12)',
  borderWidth: 1,
  padding: 10,
  titleFont: { weight: 600 as const },
};

export interface TempPoint {
  time: string;
  temperature: number;
  feelsLike: number;
}

/**
 * After every layout: the x pixel of each data point, and of "now" (null on other
 * days), relative to the canvas. "Now" comes from the same scale the dot is drawn
 * with, so anything placed from these numbers lines up with the dot exactly.
 */
export interface TempLayout {
  xs: number[];
  nowX: number | null;
}
export type LayoutListener = (layout: TempLayout) => void;

/** Room the plot leaves at its edges so the hourly strip's labels fit under the first and last points. */
export const TEMP_CHART_PADDING = { left: 6, right: 22 };

let tempChart: Chart<'line'> | null = null;
let rainChart: Chart<'bar'> | null = null;
let onTempLayout: LayoutListener | null = null;
/** Fractional point position of "now" on today's chart, or null on other days. */
let nowPos: number | null = null;

// Datasets 0 and 1 are the coloured lines; 2 and 3 are grey copies of the same
// data. The coloured pair is clipped to the part of the chart after "now" and
// the grey pair to the part before it, so the split falls at the exact minute.
const PASSED_DATASETS = new Set([2, 3]);

const reportLayout: Plugin<'line'> = {
  id: 'reportLayout',
  afterLayout(chart) {
    const x = chart.scales.x;
    if (!x || !onTempLayout) return;
    const n = chart.data.labels?.length ?? 0;
    onTempLayout({
      xs: Array.from({ length: n }, (_, i) => x.getPixelForValue(i)),
      nowX: nowPos === null ? null : x.getPixelForValue(nowPos),
    });
  },
};

const nowSplit: Plugin<'line'> = {
  id: 'nowSplit',
  beforeDatasetDraw(chart, args) {
    const { ctx, chartArea: a, scales } = chart;
    const passed = PASSED_DATASETS.has(args.index);
    let x0 = a.left;
    let x1 = a.right;
    if (nowPos === null) {
      if (passed) x1 = x0; // nothing has passed on another day
    } else {
      const x = scales.x.getPixelForValue(nowPos);
      if (passed) x1 = x;
      else x0 = x;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, a.top - 6, Math.max(0, x1 - x0), a.bottom - a.top + 12);
    ctx.clip();
  },
  afterDatasetDraw(chart) {
    chart.ctx.restore();
  },
};

interface CurvePoint {
  x: number;
  y: number;
  cp1x?: number;
  cp1y?: number;
  cp2x?: number;
  cp2y?: number;
}

/** The point on the drawn (curved) temperature line at x = `targetX`, between points a and b. */
function pointOnLine(a: CurvePoint, b: CurvePoint, targetX: number): { x: number; y: number } {
  if (a.x === b.x) return { x: a.x, y: a.y };
  const c1 = { x: a.cp2x ?? a.x, y: a.cp2y ?? a.y };
  const c2 = { x: b.cp1x ?? b.x, y: b.cp1y ?? b.y };
  const at = (t: number, p0: number, p1: number, p2: number, p3: number) =>
    (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid, a.x, c1.x, c2.x, b.x) < targetX) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return { x: at(t, a.x, c1.x, c2.x, b.x), y: at(t, a.y, c1.y, c2.y, b.y) };
}

const nowDot: Plugin<'line'> = {
  id: 'nowDot',
  afterDatasetsDraw(chart) {
    const canvas = chart.canvas;
    const data = chart.getDatasetMeta(0).data as unknown as CurvePoint[];
    if (nowPos === null || data.length === 0) {
      delete canvas.dataset.nowX; // for tests
      delete canvas.dataset.nowY;
      return;
    }
    const i = Math.min(Math.max(Math.floor(nowPos), 0), data.length - 1);
    const targetX = chart.scales.x.getPixelForValue(nowPos);
    const { x, y } = pointOnLine(data[i]!, data[Math.min(i + 1, data.length - 1)]!, targetX);
    canvas.dataset.nowX = x.toFixed(1);
    canvas.dataset.nowY = y.toFixed(1);

    const { ctx } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 181, 71, 0.28)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = SERIES_COLORS.temperature;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
    ctx.restore();
  },
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Move the "now" dot and the colour split without rebuilding the chart (the minute tick). */
export function moveTempNow(now: NowMarker | null): void {
  nowPos = now ? Math.min(now.pos, (tempChart?.data.labels?.length ?? 1) - 1) : null;
  tempChart?.update('none');
}

export function renderTempChart(
  canvas: HTMLCanvasElement,
  points: TempPoint[],
  unit: string,
  now: NowMarker | null,
  format: TimeFormat,
  onLayout: LayoutListener,
): void {
  onTempLayout = onLayout;
  // The line ends at the last point (11 PM), so during the final hour the dot rests there.
  nowPos = now ? Math.min(now.pos, points.length - 1) : null;
  const labels = points.map((p, i) => (now && i === now.index ? 'Now' : formatHour(p.time, false, format)));
  canvas.dataset.labels = JSON.stringify(labels); // for tests; the canvas itself is not readable
  const temps = points.map((p) => round1(p.temperature));
  const feels = points.map((p) => round1(p.feelsLike));
  const label = (c: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${c.dataset.label}: ${c.parsed.y}${unit}`;

  if (tempChart) {
    tempChart.data.labels = labels;
    for (const [i, data] of [temps, feels, temps, feels].entries()) tempChart.data.datasets[i]!.data = data;
    tempChart.options.plugins!.tooltip!.callbacks!.label = label;
    tempChart.update();
    return;
  }

  const fill = (top: string) => (ctx: ScriptableContext<'line'>) => {
    const area = ctx.chart.chartArea;
    if (!area) return 'transparent';
    const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, top);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    return g;
  };

  tempChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Temperature',
          data: temps,
          borderColor: SERIES_COLORS.temperature,
          borderWidth: 2.5,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: SERIES_COLORS.temperature,
          backgroundColor: fill('rgba(255, 181, 71, 0.32)'),
        },
        {
          label: 'Feels like',
          data: feels,
          borderColor: SERIES_COLORS.feelsLike,
          borderWidth: 2,
          borderDash: [5, 4],
          tension: 0.4,
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: SERIES_COLORS.feelsLike,
        },
        {
          label: 'Temperature (passed)',
          data: temps,
          borderColor: SERIES_COLORS.passed,
          borderWidth: 2.5,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 0,
          backgroundColor: fill('rgba(148, 163, 184, 0.16)'),
        },
        {
          label: 'Feels like (passed)',
          data: feels,
          borderColor: SERIES_COLORS.passedFeelsLike,
          borderWidth: 2,
          borderDash: [5, 4],
          tension: 0.4,
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: TEMP_CHART_PADDING },
      plugins: {
        legend: { display: false },
        // The grey copies only repaint the passed part; the tooltip lists each series once.
        tooltip: { ...tooltip, filter: (item) => !PASSED_DATASETS.has(item.datasetIndex), callbacks: { label } },
      },
      scales: {
        // The hourly strip under the chart is the time axis, so no tick labels here.
        x: { grid: { display: false }, ticks: { display: false } },
        y: { grid: { color: GRID }, border: { display: false }, grace: '5%', ticks: { callback: (v) => `${v}°`, maxTicksLimit: 5 } },
      },
    },
    plugins: [reportLayout, nowSplit, nowDot],
  });
}

function barColor(p: HourPoint, highlight: string | null): string {
  if (p.time === highlight) return SERIES_COLORS.rainHighlight;
  const alpha = 0.3 + (p.probability / 100) * 0.6;
  return p.isPast ? `rgba(90, 176, 255, ${alpha * 0.4})` : `rgba(90, 176, 255, ${alpha})`;
}

export function renderRainChart(canvas: HTMLCanvasElement, hours: HourPoint[], highlight: string | null, format: TimeFormat): void {
  const labels = hours.map((h) => formatHour(h.time, false, format));
  canvas.dataset.labels = JSON.stringify(labels);
  const data = hours.map((h) => h.probability);
  const colors = hours.map((h) => barColor(h, highlight));

  if (rainChart) {
    rainChart.data.labels = labels;
    rainChart.data.datasets[0]!.data = data;
    rainChart.data.datasets[0]!.backgroundColor = colors;
    rainChart.update();
    return;
  }

  rainChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Chance of rain', data, backgroundColor: colors, borderRadius: 4, borderSkipped: false, maxBarThickness: 18 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltip, displayColors: false, callbacks: { label: (c) => ` ${c.parsed.y}% chance of rain` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } },
        y: {
          min: 0,
          max: 100,
          grid: { color: GRID },
          border: { display: false },
          ticks: { stepSize: 25, callback: (v) => `${v}%` },
        },
      },
    },
  });
}
