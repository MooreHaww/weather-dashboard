// The Rain and Temperature cards for the selected day (today by default).

import { rainHoursForDay, rainSummary } from '../../shared/rain';
import { formatHour, shortDate, weekday } from '../../shared/time';
import type { TimeFormat, WeatherData } from '../../shared/types';
import { describeWeather } from '../../shared/weatherCodes';
import { renderRainChart, renderTempChart, type TempPoint } from '../charts';
import { $, esc, round } from '../dom';
import { glyphs, weatherIcon } from '../icons';

const STRIP_EVERY = 3; // hours between items in the hourly strip

/** "Tomorrow, Oct 18" / "Monday, Oct 19". */
export function dayName(w: WeatherData, day: string): string {
  return day === w.daily.time[1] ? `Tomorrow, ${shortDate(day)}` : `${weekday(day, true)}, ${shortDate(day)}`;
}

interface StripPoint extends TempPoint {
  weatherCode: number;
  isDay: boolean;
}

/** Hours shown for a day: today = now + next 24 h; other days = midnight to 11 pm. */
function tempPoints(w: WeatherData, day: string, nowLocal: string): StripPoint[] {
  const h = w.hourly;
  const point = (i: number): StripPoint => ({
    time: h.time[i]!,
    temperature: h.temperature[i]!,
    feelsLike: h.apparentTemperature[i]!,
    weatherCode: h.weatherCode[i]!,
    isDay: h.isDay[i]!,
  });
  if (day === nowLocal.slice(0, 10)) {
    const start = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) === nowLocal.slice(0, 13)));
    return h.time.slice(start, start + 25).map((_, i) => point(start + i));
  }
  return h.time.flatMap((t, i) => (t.startsWith(day) ? [point(i)] : []));
}

function table(id: string, caption: string, head: string[], rows: string[][]): void {
  $(`#${id}`).innerHTML = `<caption>${esc(caption)}</caption>
    <thead><tr>${head.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

/**
 * Place each strip item under its point on the chart's x axis, kept inside the
 * card. On a narrow chart, items that would touch the previous one are hidden.
 */
function positionStrip(strip: HTMLElement, xs: number[]): void {
  const width = strip.clientWidth;
  let lastRight = -Infinity;
  strip.querySelectorAll<HTMLElement>('.hour').forEach((el) => {
    const x = xs[Number(el.dataset.index)];
    if (x === undefined) return;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(x - w / 2, 0), Math.max(0, width - w));
    const fits = left >= lastRight + 6;
    el.style.visibility = fits ? 'visible' : 'hidden';
    el.style.left = `${left}px`;
    if (fits) lastRight = left + w;
  });
}

export function renderDayDetails(w: WeatherData, day: string, nowLocal: string, format: TimeFormat): void {
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
  const points = tempPoints(w, day, nowLocal);
  const unit = w.unitLabels.temperature;
  $('#temp-title').textContent = isToday ? 'Temperature · next 24 hours' : `Temperature · ${name}`;
  if (points.length) {
    const hi = points.reduce((a, b) => (b.temperature > a.temperature ? b : a));
    const lo = points.reduce((a, b) => (b.temperature < a.temperature ? b : a));
    $('#temp-summary').textContent =
      `High ${round(hi.temperature)}° at ${hour(hi.time)} · Low ${round(lo.temperature)}° at ${hour(lo.time)}`;
  }

  const strip = $('#temp-strip');
  strip.innerHTML = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % STRIP_EVERY === 0)
    .map(({ p, i }) => {
      const info = describeWeather(p.weatherCode);
      return `<div class="hour" data-index="${i}" title="${esc(info.label)}">
          <span class="hour-time">${i === 0 && isToday ? 'Now' : hour(p.time)}</span>
          ${weatherIcon(info.icon, p.isDay, 'wx-icon hour-icon')}
          <span class="hour-temp">${round(p.temperature)}°</span>
        </div>`;
    })
    .join('');

  renderTempChart($<HTMLCanvasElement>('#temp-chart'), points, unit, isToday, format, (xs) => positionStrip(strip, xs));
  table(
    'temp-data',
    `Hourly temperature, ${name}`,
    ['Time', `Temperature (${unit})`, `Feels like (${unit})`],
    points.map((p) => [hour(p.time), String(round(p.temperature)), String(round(p.feelsLike))]),
  );
  $('#temp-data').dataset.values = JSON.stringify(points.map((p) => [p.time, p.temperature, p.feelsLike]));
}
