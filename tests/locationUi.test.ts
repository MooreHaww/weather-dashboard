// @vitest-environment happy-dom
// The page parts of v1.5: "Your location" in the sidebar, no star on it, the Settings switch,
// and the "Check for updates" button. (The flow in main.ts is covered by tests/e2e/location.e2e.ts.)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHero } from '../src/renderer/components/hero';
import { setupSettings, switchControl, syncSettingsControls, type SettingsBindings } from '../src/renderer/components/settings';
import { LOCATION_FACTS } from '../src/shared/locationText';
import { renderSidebar, setupSidebar } from '../src/renderer/components/sidebar';
import { setupUpdateReady } from '../src/renderer/components/updateNote';
import { forecast } from '../src/server/openMeteo';
import { LOCATION_PLACE_ID, type Place, type Settings } from '../src/shared/types';

const paris: Place = { id: LOCATION_PLACE_ID, name: 'Paris', latitude: 48.86, longitude: 2.35, country: 'France', countryCode: 'FR', timezone: 'Europe/Paris' };
const tokyo: Place = { id: 1850147, name: 'Tokyo', latitude: 35.69, longitude: 139.69, country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' };

const SIDEBAR_HTML =
  '<aside class="sidebar">' +
  '<section id="location-section" hidden><h2>Your location</h2><ul id="location-list"></ul><p id="location-note" hidden></p></section>' +
  '<section><ul id="favorites"></ul><p id="favorites-empty"></p></section>' +
  '<section><ul id="recent"></ul><p id="recent-empty"></p><button id="clear-recent" hidden></button></section></aside>';

describe('"Your location" in the sidebar', () => {
  let selected: Place[];
  let removed: Place[];
  let removedRecent: Place[];
  beforeEach(() => {
    document.body.innerHTML = SIDEBAR_HTML;
    selected = [];
    removed = [];
    removedRecent = [];
    setupSidebar({
      onSelect: (p) => selected.push(p),
      onRemoveFavorite: (p) => removed.push(p),
      onRemoveRecent: (p) => removedRecent.push(p),
      onClearRecent: () => {},
    });
  });

  const section = () => document.getElementById('location-section') as HTMLElement;
  const card = () => document.querySelector<HTMLElement>('#location-list .place-card');

  it('is hidden when the setting is not on (no location argument)', () => {
    renderSidebar([tokyo], [], null, new Map());
    expect(section().hidden).toBe(true);
    expect(card()).toBeNull();
  });

  it('shows the detected place as a card, above the favorites in the page, with its weather', () => {
    renderSidebar([tokyo], [], null, new Map([[paris.id, { status: 'ok', temperature: 14.4, weatherCode: 0, isDay: true }]]), { place: paris, note: 'x' });
    expect(section().hidden).toBe(false);
    expect(card()!.querySelector('.fav-name')!.textContent).toBe('Paris');
    expect(card()!.querySelector('.fav-weather')!.textContent).toContain('14°');
    expect(document.getElementById('location-note')!.hidden).toBe(true);
    expect(section().compareDocumentPosition(document.getElementById('favorites')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no remove button and cannot be removed from the keyboard (Delete)', () => {
    renderSidebar([], [], null, new Map(), { place: paris, note: 'x' });
    expect(card()!.querySelector('.fav-remove')).toBeNull();
    card()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(removed).toEqual([]);
    expect(removedRecent).toEqual([]);
  });

  it('is purple: its own "loc" class, separate from favorites and recent cities', () => {
    renderSidebar([], [], LOCATION_PLACE_ID, new Map(), { place: paris, note: 'x' });
    expect([...card()!.classList]).toEqual(['place-card', 'loc', 'is-active']);
  });

  it('selects the place on click and on Enter, and marks it active when it is the one shown', () => {
    renderSidebar([], [], null, new Map(), { place: paris, note: 'x' });
    card()!.click();
    card()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(selected).toEqual([paris, paris]);
    renderSidebar([], [], LOCATION_PLACE_ID, new Map(), { place: paris, note: 'x' });
    expect(card()!.classList.contains('is-active')).toBe(true);
    expect(card()!.getAttribute('aria-current')).toBe('true');
  });

  it('without a place yet it shows the neutral note instead (looking, or couldn\'t find it)', () => {
    renderSidebar([], [], null, new Map(), { place: null, note: 'Looking for your location…' });
    expect(section().hidden).toBe(false);
    expect(card()).toBeNull();
    expect(document.getElementById('location-note')!.hidden).toBe(false);
    expect(document.getElementById('location-note')!.textContent).toBe('Looking for your location…');
  });

  it('escapes the name (it comes from a web service)', () => {
    renderSidebar([], [], null, new Map(), { place: { ...paris, name: '<img src=x onerror=alert(1)>' }, note: 'x' });
    expect(card()!.querySelector('img')).toBeNull();
    expect(card()!.querySelector('.fav-name')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('the "×" on a Recent card (1.5.1)', () => {
  const london: Place = { id: 2643743, name: 'London', latitude: 51.51, longitude: -0.13, country: 'United Kingdom', countryCode: 'GB' };
  let calls: string[];
  beforeEach(() => {
    document.body.innerHTML = SIDEBAR_HTML;
    calls = [];
    setupSidebar({
      onSelect: (p) => calls.push(`select ${p.name}`),
      onRemoveFavorite: (p) => calls.push(`favorite ${p.name}`),
      onRemoveRecent: (p) => calls.push(`recent ${p.name}`),
      onClearRecent: () => calls.push('clear'),
    });
    // Tokyo is a favorite and a recent city at the same time.
    renderSidebar([tokyo], [tokyo, london], tokyo.id, new Map(), { place: paris, note: 'x' });
  });
  const recentCard = (name: string) => [...document.querySelectorAll<HTMLElement>('#recent .place-card')].find((c) => c.querySelector('.fav-name')!.textContent === name)!;

  it('every recent card has one, built like the favorites one and named "Remove <city> from recent"', () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('#recent .fav-remove')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Remove Tokyo from recent', 'Remove London from recent']);
    expect(buttons.every((b) => b.type === 'button' && b.title === b.getAttribute('aria-label'))).toBe(true);
    expect(document.querySelector('#favorites .fav-remove')!.getAttribute('aria-label')).toBe('Remove Tokyo from favorites');
    expect(document.querySelector('#location-list .fav-remove')).toBeNull();
  });

  it('a click removes it from recent only (not a favorite removal, not a selection)', () => {
    recentCard('London').querySelector<HTMLButtonElement>('.fav-remove')!.click();
    recentCard('Tokyo').querySelector<HTMLButtonElement>('.fav-remove')!.click();
    expect(calls).toEqual(['recent London', 'recent Tokyo']);
    document.querySelector<HTMLButtonElement>('#favorites .fav-remove')!.click();
    expect(calls.at(-1)).toBe('favorite Tokyo');
  });

  it('Delete on a focused recent card removes it; Enter still selects it', () => {
    recentCard('London').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    recentCard('London').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(calls).toEqual(['recent London', 'select London']);
  });

  it('escapes the name in the label', () => {
    renderSidebar([], [{ ...london, name: '"><img src=x>' }], null, new Map());
    const b = document.querySelector('#recent .fav-remove')!;
    expect(b.getAttribute('aria-label')).toBe('Remove "><img src=x> from recent');
    expect(document.querySelector('#recent img')).toBeNull();
  });
});

describe('the hero for the detected place', () => {
  it('has no star (it is not a favorite), and keeps it for other cities', async () => {
    const json = await readFile(path.join(__dirname, 'fixtures', 'forecast-tokyo.json'), 'utf8');
    const w = await forecast(async () => new Response(json, { status: 200 }), 35.69, 139.69, 'metric');
    const hero = document.createElement('section');
    renderHero(hero, paris, w, false, w.current.time, '12h');
    expect(hero.querySelector('#star')).toBeNull();
    expect(hero.querySelector('.place-name')!.textContent).toBe('Paris');
    renderHero(hero, tokyo, w, false, w.current.time, '12h');
    expect(hero.querySelector('#star')).not.toBeNull();
  });

  it('has a purple pin named "Your location" next to the name, only for the detected place', async () => {
    const json = await readFile(path.join(__dirname, 'fixtures', 'forecast-tokyo.json'), 'utf8');
    const w = await forecast(async () => new Response(json, { status: 200 }), 35.69, 139.69, 'metric');
    const hero = document.createElement('section');
    renderHero(hero, paris, w, false, w.current.time, '12h');
    const pin = hero.querySelector('.place-row .loc-pin')!;
    expect(pin.getAttribute('role')).toBe('img');
    expect(pin.getAttribute('aria-label')).toBe('Your location');
    expect(pin.previousElementSibling!.classList.contains('place-name')).toBe(true);
    expect(pin.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    renderHero(hero, tokyo, w, false, w.current.time, '12h');
    expect(hero.querySelector('.loc-pin')).toBeNull();
  });
});

describe('the Settings > Location switch', () => {
  const settings: Settings = { units: 'metric', timeFormat: '12h', windUnit: 'kmh', tempLabels: '3h', location: 'ask', appearance: 'classic', closeBehavior: 'ask', rainAlerts: false };
  const setLocation = vi.fn<(on: boolean) => void>();
  const bindings: SettingsBindings = {
    get: () => settings,
    setUnits: vi.fn(),
    setWindUnit: vi.fn(),
    setTimeFormat: vi.fn(),
    setTempLabels: vi.fn(),
    setLocation: (on) => {
      setLocation(on);
      settings.location = on ? 'on' : 'off';
      syncSettingsControls();
    },
    locationStatus: () => `status for ${settings.location}`,
    setAppearance: vi.fn(),
    glassSupported: () => true,
    setCloseBehavior: vi.fn(),
    startup: () => null,
    setStartup: vi.fn(),
    setRainAlerts: vi.fn(),
    sendTestAlert: vi.fn(),
    now: () => '2026-10-17T16:05:30',
  };
  beforeEach(() => {
    setLocation.mockClear();
    settings.location = 'ask';
    document.body.innerHTML =
      '<div id="settings"><section id="settings-sheet"><button class="settings-close"></button><div id="settings-sections"></div></section><div class="titlebar"></div><div class="layout"></div></div><button id="settings-button"></button>';
    setupSettings(bindings);
  });

  const sw = () => document.querySelector<HTMLButtonElement>('#settings-location [role="switch"]')!;
  const status = () => document.getElementById('settings-location-status')!.textContent;

  it('is its own section with one short line, a named switch and a status line', () => {
    const section = document.getElementById('settings-location')!;
    expect(section.querySelector('h3')!.textContent).toBe('Location');
    expect(section.querySelector('.settings-section-description')!.textContent).toBe('Uses your IP address, sent to GeoJS.');
    expect(sw().getAttribute('aria-checked')).toBe('false'); // "ask" counts as off: nothing is looked up
    expect(section.querySelector('label')!.textContent).toBe('Use my location');
    expect((section.querySelector('label') as HTMLLabelElement).htmlFor).toBe(sw().id);
    expect(status()).toBe('status for ask');
  });

  it('turns on and off with a click or the keyboard, and the status line follows', () => {
    sw().click();
    expect(setLocation).toHaveBeenLastCalledWith(true);
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(status()).toBe('status for on');
    sw().click();
    expect(setLocation).toHaveBeenLastCalledWith(false);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(status()).toBe('status for off');
  });

  it('follows a change made outside the panel (the consent card)', () => {
    settings.location = 'on';
    syncSettingsControls();
    expect(sw().getAttribute('aria-checked')).toBe('true');
  });

  describe('the "i" button next to the switch', () => {
    const info = () => document.querySelector<HTMLButtonElement>('#settings-location .info-button')!;
    const popover = () => document.getElementById('location-info')!;
    const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

    it('is a named button that controls the popover, after the switch (the label still names the switch)', () => {
      expect(info().tagName).toBe('BUTTON');
      expect(info().type).toBe('button');
      expect(info().getAttribute('aria-label')).toBe('How is my IP address used?');
      expect(info().getAttribute('aria-expanded')).toBe('false');
      expect(info().getAttribute('aria-controls')).toBe('location-info');
      expect(sw().nextElementSibling).toBe(info());
      expect(info().nextElementSibling).toBe(popover());
      expect((document.querySelector('#settings-location label') as HTMLLabelElement).htmlFor).toBe(sw().id);
      expect(popover().hidden).toBe(true);
    });

    it('the popover is a dialog with the shared text, exactly', () => {
      expect(popover().getAttribute('role')).toBe('dialog');
      expect(document.getElementById(popover().getAttribute('aria-labelledby')!)!.textContent).toBe(LOCATION_FACTS.title);
      expect(popover().querySelector('h4')!.textContent).toBe('How your IP address is used');
      expect([...popover().querySelectorAll('li')].map((li) => li.textContent)).toEqual([...LOCATION_FACTS.lines]);
    });

    it('opens and closes on click, with aria-expanded following, and focus goes into it', () => {
      info().click();
      expect(popover().hidden).toBe(false);
      expect(info().getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(popover());
      info().click();
      expect(popover().hidden).toBe(true);
      expect(info().getAttribute('aria-expanded')).toBe('false');
    });

    it('Escape closes only the popover (Settings stays open) and gives focus back to the button', () => {
      document.getElementById('settings-button')!.click(); // open Settings
      expect(document.getElementById('settings')!.classList.contains('is-open')).toBe(true);
      info().click();
      key(popover(), 'Escape');
      expect(popover().hidden).toBe(true);
      expect(document.activeElement).toBe(info());
      expect(document.getElementById('settings')!.classList.contains('is-open')).toBe(true);
      key(info(), 'Escape'); // with the popover closed, Escape closes Settings as before
      expect(document.getElementById('settings')!.classList.contains('is-open')).toBe(false);
    });

    it('a click outside closes it; a click inside does not', () => {
      info().click();
      popover().querySelector('li')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(popover().hidden).toBe(false);
      document.querySelector('.settings-close')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(popover().hidden).toBe(true);
      expect(info().getAttribute('aria-expanded')).toBe('false');
    });

    it('closing Settings closes it', () => {
      document.getElementById('settings-button')!.click();
      info().click();
      document.querySelector<HTMLButtonElement>('.settings-close')!.click();
      expect(popover().hidden).toBe(true);
      expect(info().getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('switchControl is a button with role "switch" that reports the new value', () => {
    let value = false;
    const control = switchControl({ current: () => value, onChange: (on) => (value = on) });
    expect(control.tagName).toBe('BUTTON');
    expect(control.type).toBe('button');
    control.click();
    expect(value).toBe(true);
  });
});

describe('the "Check for updates" button', () => {
  let fireState: (state: unknown) => void;
  let checkNow: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    document.body.innerHTML =
      '<button id="settings-button" aria-label="Settings"></button><div id="update-note" hidden></div>' +
      '<div id="settings"><section id="settings-sheet"><div id="settings-sections"></div></section></div>';
    checkNow = vi.fn<() => void>();
    window.updates = { onReady: () => {}, onState: (cb) => (fireState = cb), restart: vi.fn(), checkNow };
    setupUpdateReady();
  });

  const button = () => document.getElementById('update-check') as HTMLButtonElement | null;
  const state = (status: string, extra: Record<string, unknown> = {}) => fireState({ status, version: '1.5.0', ...extra });

  it('is in the Updates row when idle, up to date or failed, named "Check for updates"', () => {
    for (const status of ['idle', 'up-to-date', 'failed']) {
      state(status);
      expect(button(), status).not.toBeNull();
      expect(button()!.textContent).toBe('Check for updates');
      expect(button()!.getAttribute('aria-disabled')).toBe('false');
      expect(button()!.closest('#settings-updates')).not.toBeNull();
    }
  });

  it('is not there before the main process answers, in dev, while downloading or when an update is ready', () => {
    expect(button()).toBeNull();
    for (const [status, extra] of [['unavailable', {}], ['downloading', { next: '1.5.1' }], ['ready', { next: '1.5.1' }]] as const) {
      state(status, extra);
      expect(button(), status).toBeNull();
    }
    expect(document.getElementById('update-now')).not.toBeNull(); // "ready" still has its own button
  });

  it('sends the message (no arguments) on a click', () => {
    state('up-to-date');
    button()!.click();
    expect(checkNow).toHaveBeenCalledTimes(1);
    expect(checkNow.mock.calls[0]).toEqual([]);
  });

  it('says "Checking…" while it runs, ignores clicks, keeps keyboard focus, and then shows the result', () => {
    state('up-to-date', { checkedAt: new Date(2026, 9, 25, 10, 42).getTime() });
    button()!.focus();
    state('checking');
    expect(button()!.textContent).toBe('Checking…');
    expect(button()!.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button()); // aria-disabled, not disabled: focus is not lost
    button()!.click();
    expect(checkNow).not.toHaveBeenCalled();
    state('up-to-date', { checkedAt: new Date(2026, 9, 25, 10, 43).getTime() });
    expect(button()!.textContent).toBe('Check for updates');
    expect(document.activeElement).toBe(button());
    expect(document.querySelector('#settings-updates .settings-row-label')!.textContent).toBe('Version 1.5.0 · Up to date · checked 10:43 AM');
  });

  it('a failed check shows the neutral line and the button to try again', () => {
    state('checking');
    state('failed');
    expect(document.querySelector('#settings-updates .settings-row-description')!.textContent).toBe("Couldn't check for updates");
    expect(button()!.textContent).toBe('Check for updates');
  });

  it('the row is read out when it changes (a polite live region)', () => {
    expect(document.querySelector('#settings-updates .settings-section-body')!.getAttribute('aria-live')).toBe('polite');
  });
});
