import { localIsoIn } from '../shared/time';
import type { AppState, CacheStatus, Place, TimeFormat, Units, WeatherData, WindUnit } from '../shared/types';
import { describeWeather } from '../shared/weatherCodes';
import { api } from './api';
import { renderDayDetails } from './components/dayDetails';
import { renderForecast, selectDay, setupForecast } from './components/forecast';
import { renderHero, tickClock } from './components/hero';
import { setupSearch } from './components/search';
import { setupSettings, syncSettingsControls } from './components/settings';
import { renderSidebar, setupSidebar, type CardWeather } from './components/sidebar';
import { $, esc, round } from './dom';
import { glyphs } from './icons';

const DEFAULT_PLACE: Place = {
  id: 2643743,
  name: 'London',
  latitude: 51.50853,
  longitude: -0.12574,
  admin1: 'England',
  country: 'United Kingdom',
  countryCode: 'GB',
  timezone: 'Europe/London',
};
const REFRESH_MS = 10 * 60_000;
const CARD_CONCURRENCY = 4;

const app = {
  state: { favorites: [], recent: [], settings: { units: 'metric', timeFormat: '12h', windUnit: 'kmh' }, lastPlace: null } as AppState,
  place: null as Place | null,
  weather: null as WeatherData | null,
  cache: 'MISS' as CacheStatus,
  loadedAt: 0,
  /** Selected forecast day ("YYYY-MM-DD"); null means today. */
  day: null as string | null,
  cards: new Map<number, CardWeather>(),
  request: 0,
};

const main = $('#main');

// ---------- rendering ----------

function showBanner(text: string | null, retry = false): void {
  const el = $('#banner');
  el.hidden = !text;
  if (!text) return;
  el.innerHTML = `<span>${esc(text)}</span>${retry ? `<button type="button" class="button" id="retry">${glyphs.refresh} Retry</button>` : ''}`;
  el.querySelector('#retry')?.addEventListener('click', () => void refresh());
}

/** The selected day if it's still in the forecast (it may roll off after midnight), else today. */
function currentDay(w: WeatherData, nowLocal: string): string {
  const today = nowLocal.slice(0, 10);
  return app.day && w.daily.time.includes(app.day) ? app.day : today;
}

function render(): void {
  const { place, weather: w } = app;
  if (!place || !w) return;
  const nowLocal = localIsoIn(w.timezone);
  const info = describeWeather(w.current.weatherCode);
  document.body.dataset.theme = `${info.theme}-${w.current.isDay ? 'day' : 'night'}`;
  document.title = `${place.name} · ${round(w.current.temperature)}${w.unitLabels.temperature} · Weather Dashboard`;

  renderHero($('#hero'), place, w, isFavorite(place), nowLocal, app.state.settings.timeFormat);
  tickClock(w.timezone, app.state.settings.timeFormat);
  $('#star').addEventListener('click', () => void toggleFavorite());

  const day = currentDay(w, nowLocal);
  renderForecast($('#forecast'), w, nowLocal.slice(0, 10), day);
  renderDayDetails(w, day, nowLocal, app.state.settings.timeFormat);
  renderUnits();
  renderUpdated();
  renderCards();
}

/** Switch the rain and temperature cards to another forecast day. */
function chooseDay(day: string): void {
  const w = app.weather;
  if (!w) return;
  const nowLocal = localIsoIn(w.timezone);
  app.day = day === nowLocal.slice(0, 10) ? null : day;
  selectDay(day);
  renderDayDetails(w, day, nowLocal, app.state.settings.timeFormat);
}

function renderCards(): void {
  renderSidebar(app.state.favorites, app.state.recent, app.place?.id ?? null, app.cards);
}

function renderUnits(): void {
  syncSettingsControls();
}

function renderUpdated(): void {
  if (!app.weather) return;
  const mins = Math.floor((Date.now() - new Date(app.weather.fetchedAt).getTime()) / 60_000);
  const age = mins < 1 ? 'just now' : mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  $('#updated-text').textContent = `Updated ${age}${app.cache === 'HIT' ? ' · from cache' : ''}`;
}

// ---------- actions ----------

const isFavorite = (p: Place) => app.state.favorites.some((f) => f.id === p.id);

async function selectPlace(place: Place, record = true): Promise<void> {
  const req = ++app.request;
  if (app.place?.id !== place.id) app.day = null; // a new city starts on today
  app.place = place;
  main.classList.add('is-loading');
  $<HTMLButtonElement>('#refresh').disabled = true;
  try {
    const res = await api.weather(place, app.state.settings.units, app.state.settings.windUnit);
    if (req !== app.request) return; // a newer selection won
    app.weather = res.data;
    app.cache = res.meta.cache;
    app.loadedAt = Date.now();
    showBanner(res.meta.cache === 'STALE' ? 'Showing saved data: the weather service is unreachable right now.' : null);
    render();
  } catch (err) {
    if (req !== app.request) return;
    showBanner((err as Error).message, true);
  } finally {
    if (req === app.request) {
      main.classList.remove('is-loading');
      $<HTMLButtonElement>('#refresh').disabled = false;
    }
  }

  if (record) {
    api
      .addRecent(place)
      .then((recent) => {
        app.state.recent = recent;
        app.state.lastPlace = place;
        renderCards();
        void loadCardWeather();
      })
      .catch(() => {});
  }
}

async function refresh(): Promise<void> {
  if (!app.place) return;
  await selectPlace(app.place, false);
  void loadCardWeather(true);
}

async function toggleFavorite(): Promise<void> {
  const place = app.place;
  if (!place) return;
  try {
    app.state.favorites = isFavorite(place) ? await api.removeFavorite(place.id) : await api.addFavorite(place);
    render();
    void loadCardWeather();
  } catch (err) {
    showBanner((err as Error).message);
  }
}

/**
 * Current weather for every favorite and recent city card, through the server
 * cache, a few at a time. Without `all`, only cards that are missing or failed
 * are fetched. A failure marks just that card.
 */
async function loadCardWeather(all = false): Promise<void> {
  const { units, windUnit } = app.state.settings;
  const unique = new Map([...app.state.favorites, ...app.state.recent].map((p) => [p.id, p]));
  const queue = [...unique.values()].filter((p) => all || app.cards.get(p.id)?.status !== 'ok');

  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try {
        const { data } = await api.weather(p, units, windUnit);
        if (units !== app.state.settings.units) return; // units changed meanwhile
        app.cards.set(p.id, {
          status: 'ok',
          temperature: data.current.temperature,
          weatherCode: data.current.weatherCode,
          isDay: data.current.isDay,
        });
      } catch {
        if (app.cards.get(p.id)?.status !== 'ok') app.cards.set(p.id, { status: 'error' });
      }
      renderCards();
    }
  };
  await Promise.all(Array.from({ length: CARD_CONCURRENCY }, worker));
}

async function setUnits(units: Units): Promise<void> {
  if (units === app.state.settings.units) return;
  app.state.settings.units = units;
  renderUnits();
  app.cards.clear();
  renderCards();
  api.saveSettings({ units }).catch(() => {});
  if (app.place) await selectPlace(app.place, false);
  void loadCardWeather();
}

async function setWindUnit(windUnit: WindUnit): Promise<void> {
  if (windUnit === app.state.settings.windUnit) return;
  app.state.settings.windUnit = windUnit;
  syncSettingsControls();
  api.saveSettings({ windUnit }).catch(() => {});
  if (app.place) await selectPlace(app.place, false);
}

/** Times are formatted from the weather we already have, so no reload is needed. */
function setTimeFormat(timeFormat: TimeFormat): void {
  if (timeFormat === app.state.settings.timeFormat) return;
  app.state.settings.timeFormat = timeFormat;
  syncSettingsControls();
  api.saveSettings({ timeFormat }).catch(() => {});
  render();
}

// ---------- boot ----------

async function boot(): Promise<void> {
  const search = setupSearch((p) => void selectPlace(p));
  setupForecast(chooseDay);
  setupSidebar({
    onSelect: (p) => void selectPlace(p),
    onRemoveFavorite: async (p) => {
      app.state.favorites = await api.removeFavorite(p.id);
      render();
    },
    onClearRecent: async () => {
      app.state.recent = await api.clearRecent();
      renderCards();
    },
  });

  $('#refresh-icon').innerHTML = glyphs.refresh;
  $('#settings-button').innerHTML = glyphs.gear;
  $('.settings-close').innerHTML = glyphs.close;
  setupSettings({
    get: () => app.state.settings,
    setUnits: (u) => void setUnits(u),
    setWindUnit: (u) => void setWindUnit(u),
    setTimeFormat,
  });
  $('#refresh').addEventListener('click', () => void refresh());

  document.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement).matches('input, textarea');
    if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
      e.preventDefault();
      search.focus();
    }
  });

  // Live clock in the city's timezone.
  window.setInterval(() => {
    if (app.weather) tickClock(app.weather.timezone, app.state.settings.timeFormat);
  }, 1000);

  // Keep data fresh; the server cache absorbs repeat requests.
  window.setInterval(() => void refresh(), REFRESH_MS);
  window.setInterval(renderUpdated, 30_000);
  window.addEventListener('focus', () => {
    if (app.place && Date.now() - app.loadedAt > REFRESH_MS) void refresh();
  });

  try {
    app.state = await api.state();
  } catch (err) {
    showBanner((err as Error).message, true);
  }
  renderUnits();
  renderCards();
  await selectPlace(app.state.lastPlace ?? app.state.favorites[0] ?? DEFAULT_PLACE, false);
  void loadCardWeather();
}

void boot();
