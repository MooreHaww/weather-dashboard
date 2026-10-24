import { rainSummary } from '../../shared/rain';
import { cityClock, compass, formatHour } from '../../shared/time';
import type { Place, TimeFormat, WeatherData } from '../../shared/types';
import { describeWeather } from '../../shared/weatherCodes';
import { esc, round } from '../dom';
import { glyphs, weatherIcon, windArrow } from '../icons';

export function placeSubtitle(p: Place): string {
  const parts = [p.admin1, p.country].filter((s): s is string => Boolean(s) && s !== p.name);
  return [...new Set(parts)].join(', ');
}

function stat(icon: string, label: string, value: string, sub = ''): string {
  return `
    <div class="stat">
      <div class="stat-label">${icon}<span>${esc(label)}</span></div>
      <div class="stat-value">${value}</div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`;
}

/**
 * Current conditions card. The clock spans are filled by tickClock() every second, so
 * the clock opts out of the card's polite live region (or screen readers would say the time every second).
 */
export function renderHero(
  el: HTMLElement,
  place: Place,
  w: WeatherData,
  isFavorite: boolean,
  nowLocal: string,
  format: TimeFormat,
): void {
  const c = w.current;
  const info = describeWeather(c.weatherCode);
  const t = w.unitLabels.temperature;
  const todayIdx = Math.max(0, w.daily.time.indexOf(nowLocal.slice(0, 10)));
  const rain = rainSummary(w.hourly, nowLocal, undefined, format);

  el.innerHTML = `
    <div class="hero-place">
      <div class="place-row">
        <h1 class="place-name">${esc(place.name)}</h1>
        <button type="button" class="star" id="star" aria-pressed="${isFavorite}"
          title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">${glyphs.star}</button>
      </div>
      <p class="muted">${esc(placeSubtitle(place)) || '&nbsp;'}</p>
      <div class="clock" aria-live="off">
        <div class="clock-time" id="clock-time"></div>
        <div class="clock-date"><span id="clock-date"></span></div>
        <div class="clock-tz muted small">Local time · <span id="clock-offset"></span> · ${esc(w.timezone)}</div>
      </div>
    </div>

    <div class="hero-now">
      ${weatherIcon(info.icon, c.isDay, 'wx-icon hero-icon')}
      <div>
        <div class="hero-temp">${round(c.temperature)}<span class="unit">${esc(t)}</span></div>
        <div class="hero-cond">${esc(info.label)}</div>
        <div class="muted">H ${round(w.daily.tempMax[todayIdx]!)}° · L ${round(w.daily.tempMin[todayIdx]!)}°</div>
      </div>
    </div>

    <div class="hero-stats">
      ${stat(glyphs.thermo, 'Feels like', `${round(c.apparentTemperature)}${esc(t)}`, round(c.apparentTemperature) < round(c.temperature) ? 'Cooler than actual' : round(c.apparentTemperature) > round(c.temperature) ? 'Warmer than actual' : 'Same as actual')}
      ${stat(glyphs.wind, 'Wind', `${round(c.windSpeed)} <small>${esc(w.unitLabels.windSpeed)}</small>`, `${windArrow(c.windDirection)} From ${compass(c.windDirection)}`)}
      ${stat(glyphs.humidity, 'Humidity', `${round(c.humidity)}%`)}
      ${stat(glyphs.umbrella, 'Rain chance', `${w.daily.precipitationProbabilityMax[todayIdx] ?? 0}%`, rain.level === 'none' ? 'Rest of today: dry' : `Peak ${formatHour(rain.at!, false, format)}`)}
      ${stat(glyphs.sunrise, 'Sunrise', formatHour(w.daily.sunrise[todayIdx]!, true, format))}
      ${stat(glyphs.sunset, 'Sunset', formatHour(w.daily.sunset[todayIdx]!, true, format))}
    </div>`;
}

/** Update the live clock in the city's own timezone (never the PC's). */
export function tickClock(timeZone: string, format: TimeFormat): void {
  const clock = cityClock(timeZone, new Date(), format);
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  set('clock-time', clock.time);
  set('clock-date', clock.date);
  set('clock-offset', clock.offset);
}
