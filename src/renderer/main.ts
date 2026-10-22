import { localIsoIn } from '../shared/time';
import type { AppState, CacheStatus, Place, TimeFormat, Units, WeatherData, WindUnit } from '../shared/types';
import { describeWeather } from '../shared/weatherCodes';
import { api } from './api';
import { moveTempNow } from './charts';
import { nowMarker, renderDayDetails } from './components/dayDetails';
import { renderForecast, selectDay, setupForecast } from './components/forecast';
import { renderHero, tickClock } from './components/hero';
import { setupSearch } from './components/search';
import { setupSettings, syncSettingsControls } from './components/settings';
import { renderSidebar, setupSidebar, type CardWeather } from './components/sidebar';
import { $, esc, round } from './dom';
import { glyphs } from './icons';
import { createRefresher } from './refresh';

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
const REFRESH_MS = 5 * 60_000;
const CARD_CONCURRENCY = 4;

const app = {
  state: { favorites: [], recent: [], settings: { units: 'metric', timeFormat: '12h', windUnit: 'kmh' }, lastPlace: null } as AppState,
  place: null as Place | null,
  weather: null as WeatherData | null,
  cache: 'MISS' as CacheStatus,
  /** Selected forecast day ("YYYY-MM-DD"); null means today. */
  day: null as string | null,
  cards: new Map<number, CardWeather>(),
  request: 0,
  /** City-local date and hour ("YYYY-MM-DDTHH") the cards were last drawn for. */
  drawnHour: '',
};

const main = $('#main');

const refresher = createRefresher({
  intervalMs: REFRESH_MS,
  now: Date.now,
  isVisible: () => document.visibilityState === 'visible',
  run: autoRefresh,
  setTimer: (fn, ms) => window.setInterval(fn, ms),
  clearTimer: (h) => window.clearInterval(h as number),
});

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
  app.drawnHour = nowLocal.slice(0, 13);
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
  app.drawnHour = nowLocal.slice(0, 13);
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

/**
 * Load a city's weather and draw it. `fresh` asks the server to skip its cache.
 * `silent` is the background refresh: no loading state, no error banner, and if
 * it fails (or the server only has saved data) the screen stays exactly as it was.
 * Returns true when new weather was drawn.
 */
async function selectPlace(place: Place, record = true, opts: { fresh?: boolean; silent?: boolean } = {}): Promise<boolean> {
  const req = ++app.request;
  const { fresh = false, silent = false } = opts;
  if (app.place?.id !== place.id) app.day = null; // a new city starts on today
  app.place = place;
  if (!silent) {
    main.classList.add('is-loading');
    $<HTMLButtonElement>('#refresh').disabled = true;
  }
  let ok = false;
  try {
    const res = await api.weather(place, app.state.settings.units, app.state.settings.windUnit, fresh);
    if (req !== app.request) return false; // a newer selection won
    if (silent && res.meta.cache === 'STALE') return false; // upstream is down: keep what we show
    app.weather = res.data;
    app.cache = res.meta.cache;
    showBanner(res.meta.cache === 'STALE' ? 'Showing saved data: the weather service is unreachable right now.' : null);
    render();
    ok = true;
    refresher.markFresh();
  } catch (err) {
    if (req !== app.request) return false;
    if (!silent) showBanner((err as Error).message, true);
  } finally {
    if (req === app.request && !silent) {
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
  return ok;
}

/** The refresh button and the banner's Retry: visible loading state, always fresh data. */
async function refresh(): Promise<void> {
  if (!app.place) return;
  await selectPlace(app.place, false, { fresh: true });
  void loadCardWeather(true, true);
}

/** The 5-minute refresh: same data path, no spinner, no flicker. */
async function autoRefresh(): Promise<boolean> {
  // Don't cut in on a city the user just picked; the next tick tries again.
  if (!app.place || main.classList.contains('is-loading')) return false;
  const ok = await selectPlace(app.place, false, { fresh: true, silent: true });
  void loadCardWeather(true, true);
  return ok;
}

/** Once a minute: move the "now" dot, or redraw if the city's hour (or day) has changed. */
function tickNow(): void {
  const w = app.weather;
  if (!w) return;
  const nowLocal = localIsoIn(w.timezone);
  if (nowLocal.slice(0, 13) !== app.drawnHour) {
    render();
    return;
  }
  moveTempNow(nowMarker(w, currentDay(w, nowLocal), nowLocal));
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
 * cache (or past it, with `fresh`), a few at a time. Without `all`, only cards
 * that are missing or failed are fetched. A failure marks just that card, and a
 * card that already has weather keeps it.
 */
async function loadCardWeather(all = false, fresh = false): Promise<void> {
  const { units, windUnit } = app.state.settings;
  const unique = new Map([...app.state.favorites, ...app.state.recent].map((p) => [p.id, p]));
  const queue = [...unique.values()].filter((p) => all || app.cards.get(p.id)?.status !== 'ok');

  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try {
        const { data } = await api.weather(p, units, windUnit, fresh);
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

  // Keep data fresh every 5 minutes while the window is visible; coming back
  // after being minimized refreshes at once if the data is older than that.
  refresher.start();
  document.addEventListener('visibilitychange', () => refresher.onVisible());
  window.setInterval(renderUpdated, 30_000);
  window.setInterval(tickNow, 60_000);

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
