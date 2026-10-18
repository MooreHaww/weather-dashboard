import type { Place } from '../../shared/types';
import { describeWeather } from '../../shared/weatherCodes';
import { $, esc, round } from '../dom';
import { glyphs, weatherIcon } from '../icons';

/** Weather shown on a city card: loaded, or failed (missing = still loading). */
export type CardWeather =
  | { status: 'ok'; temperature: number; weatherCode: number; isDay: boolean }
  | { status: 'error' };

interface Handlers {
  onSelect: (p: Place) => void;
  onRemoveFavorite: (p: Place) => void;
  onClearRecent: () => void;
}

let places = new Map<number, Place>();

/** Wire up click and keyboard handling once; renders only replace the list contents. */
export function setupSidebar(h: Handlers): void {
  for (const list of [$('#favorites'), $('#recent')]) {
    list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const card = target.closest<HTMLElement>('.place-card[data-id]');
      const place = card && places.get(Number(card.dataset.id));
      if (!place) return;
      if (target.closest('.fav-remove')) h.onRemoveFavorite(place);
      else h.onSelect(place);
    });
    list.addEventListener('keydown', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.place-card[data-id]');
      const place = card && places.get(Number(card.dataset.id));
      if (!place || e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        h.onSelect(place);
      } else if (e.key === 'Delete' && card.classList.contains('fav')) {
        h.onRemoveFavorite(place);
      }
    });
  }
  $('#clear-recent').addEventListener('click', h.onClearRecent);
}

function subtitle(p: Place): string {
  return p.country && p.country !== p.name ? p.country : (p.countryCode ?? '');
}

function weatherBadge(w: CardWeather | undefined): string {
  if (!w) return '<span class="muted" aria-label="Loading weather">…</span>';
  if (w.status === 'error') return '<span class="muted card-error" title="Weather unavailable">—</span>';
  const info = describeWeather(w.weatherCode);
  return `${weatherIcon(info.icon, w.isDay, 'wx-icon fav-icon')}<span>${round(w.temperature)}°</span>`;
}

function card(p: Place, kind: 'fav' | 'recent', activeId: number | null, weather: CardWeather | undefined): string {
  const active = p.id === activeId;
  const label = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
  return `
    <li>
      <div class="place-card ${kind}${active ? ' is-active' : ''}" data-id="${p.id}" role="button" tabindex="0"
        aria-current="${active}" title="${esc(label)}">
        <div class="fav-text">
          <span class="fav-name">${esc(p.name)}</span>
          <span class="fav-sub muted small">${esc(subtitle(p))}</span>
        </div>
        <div class="fav-weather">${weatherBadge(weather)}</div>
        ${
          kind === 'fav'
            ? `<button type="button" class="fav-remove" title="Remove ${esc(p.name)} from favorites" aria-label="Remove ${esc(p.name)} from favorites">${glyphs.close}</button>`
            : ''
        }
      </div>
    </li>`;
}

export function renderSidebar(
  favorites: Place[],
  recent: Place[],
  activeId: number | null,
  weather: Map<number, CardWeather>,
): void {
  places = new Map([...favorites, ...recent].map((p) => [p.id, p]));

  $('#favorites').innerHTML = favorites.map((p) => card(p, 'fav', activeId, weather.get(p.id))).join('');
  $('#favorites-empty').hidden = favorites.length > 0;

  $('#recent').innerHTML = recent.map((p) => card(p, 'recent', activeId, weather.get(p.id))).join('');
  $('#recent-empty').hidden = recent.length > 0;
  $('#clear-recent').hidden = recent.length === 0;
}
