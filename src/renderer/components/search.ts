import type { Place } from '../../shared/types';
import { api } from '../api';
import { $, esc } from '../dom';
import { glyphs } from '../icons';
import { placeSubtitle } from './hero';

const DEBOUNCE_MS = 300;

/** City search box: debounced geocoding, dropdown, keyboard navigation. */
export function setupSearch(onSelect: (p: Place) => void): { focus: () => void } {
  const input = $<HTMLInputElement>('#search-input');
  const list = $<HTMLUListElement>('#search-results');
  $('#search-icon').innerHTML = glyphs.search;

  let results: Place[] = [];
  let active = -1;
  let timer: number | undefined;
  let controller: AbortController | null = null;

  const open = (isOpen: boolean) => {
    list.hidden = !isOpen;
    input.setAttribute('aria-expanded', String(isOpen));
  };

  const message = (text: string) => {
    results = [];
    active = -1;
    list.innerHTML = `<li class="search-message">${esc(text)}</li>`;
    open(true);
  };

  const render = () => {
    list.innerHTML = results
      .map(
        (p, i) => `
        <li id="result-${i}" role="option" class="result${i === active ? ' is-active' : ''}" aria-selected="${i === active}" data-index="${i}">
          ${glyphs.pin}
          <span class="result-text"><span class="result-name">${esc(p.name)}</span>
          <span class="muted small">${esc(placeSubtitle(p))}</span></span>
          ${p.countryCode ? `<span class="badge">${esc(p.countryCode)}</span>` : ''}
        </li>`,
      )
      .join('');
    input.setAttribute('aria-activedescendant', active >= 0 ? `result-${active}` : '');
    open(results.length > 0);
  };

  const choose = (i: number) => {
    const place = results[i];
    if (!place) return;
    input.value = '';
    results = [];
    open(false);
    input.blur();
    onSelect(place);
  };

  const search = async (q: string) => {
    controller?.abort();
    controller = new AbortController();
    try {
      const res = await api.geocode(q, controller.signal);
      if (input.value.trim() !== q) return;
      results = res.results;
      active = results.length ? 0 : -1;
      if (results.length) render();
      else message(`No cities found for “${q}”`);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      message((err as Error).message);
    }
  };

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      controller?.abort();
      results = [];
      open(false);
      return;
    }
    timer = window.setTimeout(() => void search(q), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + results.length) % results.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) choose(active);
    } else if (e.key === 'Escape') {
      if (!list.hidden) open(false);
      else input.blur();
    }
  });

  // mousedown (not click) so it fires before the input loses focus
  list.addEventListener('mousedown', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (!item) return;
    e.preventDefault();
    choose(Number(item.dataset.index));
  });

  input.addEventListener('focus', () => {
    if (results.length) open(true);
  });
  input.addEventListener('blur', () => open(false));

  return { focus: () => input.focus() };
}
