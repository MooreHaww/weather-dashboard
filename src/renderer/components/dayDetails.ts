// The Rain and Temperature cards for the selected day (today by default).

import { rainHoursForDay, rainSummary } from '../../shared/rain';
import { effectiveStep, labelHours, labelIndices } from '../../shared/labelStep';
import { passedInfo, type NowMarker } from '../../shared/passed';
import { formatHour, formatTime, shortDate, weekday } from '../../shared/time';
import type { TempLabels, TimeFormat, WeatherData } from '../../shared/types';
import { describeWeather } from '../../shared/weatherCodes';
import { renderRainChart, renderTempChart, type TempPoint } from '../charts';
import { $, esc, round } from '../dom';
import { glyphs, weatherIcon } from '../icons';

// Sizes of the hourly strip's items. Both are set inline, so the code below knows
// each item's exact width and can centre it on its x without measuring.
const HOUR_W = 34;
const HOUR_GAP = 3; // least space between two neighbouring hour labels

/** "Tomorrow, Oct 18" / "Monday, Oct 19". */
export function dayName(w: WeatherData, day: string): string {
  return day === w.daily.time[1] ? `Tomorrow, ${shortDate(day)}` : `${weekday(day, true)}, ${shortDate(day)}`;
}

interface StripPoint extends TempPoint {
  weatherCode: number;
  isDay: boolean;
}

/** Every selected day, today included, is shown from midnight to 11 pm in the city's own time. */
function tempPoints(w: WeatherData, day: string): StripPoint[] {
  const h = w.hourly;
  const point = (i: number): StripPoint => ({
    time: h.time[i]!,
    temperature: h.temperature[i]!,
    feelsLike: h.apparentTemperature[i]!,
    weatherCode: h.weatherCode[i]!,
    isDay: h.isDay[i]!,
  });
  return h.time.flatMap((t, i) => (t.startsWith(day) ? [point(i)] : []));
}

/** Where "now" sits on today's points, or null for any other day. */
export function nowMarker(w: WeatherData, day: string, nowLocal: string): NowMarker | null {
  if (day !== nowLocal.slice(0, 10)) return null;
  return passedInfo(tempPoints(w, day).map((p) => p.time), nowLocal);
}

function table(id: string, caption: string, head: string[], rows: string[][]): void {
  $(`#${id}`).innerHTML = `<caption>${esc(caption)}</caption>
    <thead><tr>${head.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

/**
 * Place the hourly strip from the chart's own x positions: each label is centred
 * on its hour's x. Nothing is clamped or moved to dodge a neighbour. If the chosen
 * step is too tight for the width, the whole strip moves to the next step (hourly,
 * 2, 3, 6, 12), so the labels that stay are always every n-th hour and equally spaced.
 */
function positionStrip(strip: HTMLElement, xs: number[], requested: number): void {
  const spacing = xs.length > 1 ? (xs[xs.length - 1]! - xs[0]!) / (xs.length - 1) : 0;
  const step = effectiveStep(requested, spacing, HOUR_W, HOUR_GAP);
  const shown = new Set(labelIndices(xs.length, step));
  strip.dataset.step = String(step); // for tests
  strip.dataset.requestedStep = String(requested);
  strip.querySelectorAll<HTMLElement>('.hour').forEach((el) => {
    const i = Number(el.dataset.index);
    el.hidden = !shown.has(i);
    el.style.left = `${xs[i]! - HOUR_W / 2}px`;
  });
}

/**
 * The pulsing dot's accessible name and tooltip, and the legend entry: both exist
 * only while today is selected. `nowLocal` is the city's own clock.
 */
export function updateNowDot(nowLocal: string, format: TimeFormat, isToday: boolean): void {
  const dot = $('#now-dot');
  const text = `Current time: ${formatTime(nowLocal, format, { minutes: true })}`;
  dot.setAttribute('aria-label', text);
  dot.title = text;
  $('#legend-now').hidden = !isToday;
}

export function renderDayDetails(w: WeatherData, day: string, nowLocal: string, format: TimeFormat, labels: TempLabels): void {
  const hour = (t: string) => formatHour(t, false, format);
  const isToday = day === nowLocal.slice(0, 10);
  const name = isToday ? 'today' : dayName(w, day);

  // ----- Rain -----
  const hours = rainHoursForDay(w.hourly, day, nowLocal);
  const rain = rainSummary(w.hourly, nowLocal, day, format);
  $('#rain-title').textContent = isToday ? 'Rain today' : `Rain · ${name}`;
  const summary = $('#rain-summary');
  summary.className = `rain-summary is-${rain.level}`;
  summary.innerHTML = `${glyphs.umbrella}<span>${esc(rain.text)}</span>`;
  renderRainChart($<HTMLCanvasElement>('#rain-chart'), hours, rain.at, format);
  table(
    'rain-data',
    `Hourly chance of rain, ${name}`,
    ['Time', 'Chance of rain'],
    hours.map((h) => [hour(h.time), `${h.probability}%`]),
  );
  $('#rain-data').dataset.values = JSON.stringify(hours.map((h) => [h.time, h.probability]));

  // ----- Temperature -----
  const points = tempPoints(w, day);
  const now = nowMarker(w, day, nowLocal);
  const unit = w.unitLabels.temperature;
  $('#temp-title').textContent = isToday ? 'Temperature · Today' : `Temperature · ${name}`;
  if (points.length) {
    const hi = points.reduce((a, b) => (b.temperature > a.temperature ? b : a));
    const lo = points.reduce((a, b) => (b.temperature < a.temperature ? b : a));
    $('#temp-summary').textContent =
      `High ${round(hi.temperature)}° at ${hour(hi.time)} · Low ${round(lo.temperature)}° at ${hour(lo.time)}`;
  }

  const strip = $('#temp-strip');
  strip.innerHTML = points
    .map((p, i) => {
      const info = describeWeather(p.weatherCode);
      return `<div class="hour" data-index="${i}" style="width:${HOUR_W}px" title="${esc(info.label)}">
          <span class="hour-time">${hour(p.time)}</span>
          ${weatherIcon(info.icon, p.isDay, 'wx-icon hour-icon')}
          <span class="hour-temp">${round(p.temperature)}°</span>
        </div>`;
    })
    .join('');

  const requested = labelHours(labels);
  renderTempChart($<HTMLCanvasElement>('#temp-chart'), points, unit, now, format, (xs) => positionStrip(strip, xs, requested));
  updateNowDot(nowLocal, format, now !== null);
  table(
    'temp-data',
    `Hourly temperature, ${name}`,
    ['Time', `Temperature (${unit})`, `Feels like (${unit})`],
    points.map((p) => [hour(p.time), String(round(p.temperature)), String(round(p.feelsLike))]),
  );
  $('#temp-data').dataset.values = JSON.stringify(points.map((p) => [p.time, p.temperature, p.feelsLike]));
}
