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

/** x pixel of each data point, relative to the canvas, after every layout. */
export type LayoutListener = (xs: number[]) => void;

let tempChart: Chart<'line'> | null = null;
let rainChart: Chart<'bar'> | null = null;
let onTempLayout: LayoutListener | null = null;

const reportLayout: Plugin<'line'> = {
  id: 'reportLayout',
  afterLayout(chart) {
    const x = chart.scales.x;
    if (!x || !onTempLayout) return;
    const n = chart.data.labels?.length ?? 0;
    onTempLayout(Array.from({ length: n }, (_, i) => x.getPixelForValue(i)));
  },
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function renderTempChart(
  canvas: HTMLCanvasElement,
  points: TempPoint[],
  unit: string,
  firstIsNow: boolean,
  format: TimeFormat,
  onLayout: LayoutListener,
): void {
  onTempLayout = onLayout;
  const labels = points.map((p, i) => (i === 0 && firstIsNow ? 'Now' : formatHour(p.time, false, format)));
  canvas.dataset.labels = JSON.stringify(labels); // for tests; the canvas itself is not readable
  const temps = points.map((p) => round1(p.temperature));
  const feels = points.map((p) => round1(p.feelsLike));
  const label = (c: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${c.dataset.label}: ${c.parsed.y}${unit}`;

  if (tempChart) {
    tempChart.data.labels = labels;
    tempChart.data.datasets[0]!.data = temps;
    tempChart.data.datasets[1]!.data = feels;
    tempChart.options.plugins!.tooltip!.callbacks!.label = label;
    tempChart.update();
    return;
  }

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
          backgroundColor: (ctx: ScriptableContext<'line'>) => {
            const { chart } = ctx;
            const area = chart.chartArea;
            if (!area) return 'transparent';
            const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, 'rgba(255, 181, 71, 0.32)');
            g.addColorStop(1, 'rgba(255, 181, 71, 0)');
            return g;
          },
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
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltip, callbacks: { label } },
      },
      scales: {
        // The hourly strip under the chart is the time axis, so no tick labels here.
        x: { grid: { display: false }, ticks: { display: false } },
        y: { grid: { color: GRID }, border: { display: false }, grace: '5%', ticks: { callback: (v) => `${v}°`, maxTicksLimit: 5 } },
      },
    },
    plugins: [reportLayout],
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
