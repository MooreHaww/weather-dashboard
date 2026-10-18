import { shortDate, weekday } from '../../shared/time';
import type { WeatherData } from '../../shared/types';
import { describeWeather } from '../../shared/weatherCodes';
import { $, esc, round } from '../dom';
import { glyphs, weatherIcon } from '../icons';

/**
 * Day cards behave as a radio group: click, Enter/Space, or ←/→/Home/End
 * selects a day. Wired once; rendering only replaces the cards.
 */
export function setupForecast(onSelect: (day: string) => void): void {
  const el = $('#forecast');
  const cards = () => [...el.querySelectorAll<HTMLElement>('.day')];

  el.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.day');
    if (card?.dataset.date) onSelect(card.dataset.date);
  });

  el.addEventListener('keydown', (e) => {
    const list = cards();
    const i = list.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    const next = {
      ArrowRight: i + 1,
      ArrowDown: i + 1,
      ArrowLeft: i - 1,
      ArrowUp: i - 1,
      Home: 0,
      End: list.length - 1,
      Enter: i,
      ' ': i,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = list[(next + list.length) % list.length]!;
    onSelect(target.dataset.date!);
    target.focus();
  });
}

/** Mark the selected card without re-rendering, so keyboard focus stays put. */
export function selectDay(day: string): void {
  $('#forecast')
    .querySelectorAll<HTMLElement>('.day')
    .forEach((card) => {
      const on = card.dataset.date === day;
      card.setAttribute('aria-checked', String(on));
      card.tabIndex = on ? 0 : -1;
    });
}

/** Seven day cards with weekday, date, icon, high/low (with a range bar) and rain chance. */
export function renderForecast(el: HTMLElement, w: WeatherData, todayLocal: string, selected: string): void {
  const d = w.daily;
  const weekMin = Math.min(...d.tempMin);
  const weekMax = Math.max(...d.tempMax);
  const span = Math.max(1, weekMax - weekMin);

  el.innerHTML = d.time
    .map((date, i) => {
      const info = describeWeather(d.weatherCode[i]!);
      const lo = d.tempMin[i]!;
      const hi = d.tempMax[i]!;
      const left = ((lo - weekMin) / span) * 100;
      const width = Math.max(6, ((hi - lo) / span) * 100);
      const rain = d.precipitationProbabilityMax[i] ?? 0;
      const isToday = date === todayLocal;
      const isSelected = date === selected;
      return `
        <div class="day${isToday ? ' is-today' : ''}" role="radio" data-date="${esc(date)}"
          aria-checked="${isSelected}" tabindex="${isSelected ? 0 : -1}"
          aria-label="${isToday ? 'Today, ' : ''}${esc(weekday(date, true))} ${esc(shortDate(date))}: ${esc(info.label)}, high ${round(hi)}°, low ${round(lo)}°, ${rain}% chance of rain">
          <div class="day-name">${isToday ? 'Today' : weekday(date)}</div>
          <div class="day-date muted small">${isToday ? `${weekday(date)} · ` : ''}${shortDate(date)}</div>
          ${weatherIcon(info.icon, true, 'wx-icon day-icon')}
          <div class="day-cond small muted" title="${esc(info.label)}">${esc(info.label)}</div>
          <div class="day-temps"><strong>${round(hi)}°</strong><span class="muted">${round(lo)}°</span></div>
          <div class="range" aria-hidden="true"><span style="left:${left.toFixed(1)}%;width:${Math.min(width, 100 - left).toFixed(1)}%"></span></div>
          <div class="day-rain${rain >= 50 ? ' is-wet' : ''}">${glyphs.umbrella}<span>${rain}%</span></div>
        </div>`;
    })
    .join('');
}
