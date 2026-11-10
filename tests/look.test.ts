// @vitest-environment happy-dom
// v1.7: Settings > Look (Classic | Glass) and the page rule: glass only when the user chose it AND the system supports it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupAppearance } from '../src/renderer/appearance';
import { LOOK_GLASS_NEEDS, setupSettings, syncSettingsControls, type SettingsBindings } from '../src/renderer/components/settings';
import { glassSupported, pageLook } from '../src/shared/look';
import type { Appearance, Settings } from '../src/shared/types';

describe('pageLook: glass only when chosen and supported', () => {
  it('every combination', () => {
    for (const systemGlass of [true, false]) {
      for (const forcedColors of [true, false]) {
        for (const reducedTransparency of [true, false]) {
          const s = { systemGlass, forcedColors, reducedTransparency };
          const ok = systemGlass && !forcedColors && !reducedTransparency;
          expect(glassSupported(s), JSON.stringify(s)).toBe(ok);
          expect(pageLook('glass', s), JSON.stringify(s)).toBe(ok ? 'glass' : 'classic');
          expect(pageLook('classic', s), JSON.stringify(s)).toBe('classic');
          expect(pageLook(null, s), JSON.stringify(s)).toBe('classic'); // before the settings arrive
        }
      }
    }
  });
});

describe('setupAppearance: html[data-material] follows the choice and the system', () => {
  afterEach(() => {
    delete window.appearance;
  });

  const fakeMain = (mode: 'glass' | 'solid') => {
    let cb: ((m: 'glass' | 'solid') => void) | null = null;
    window.appearance = { current: () => mode, onChange: (fn) => void (cb = fn) };
    return (m: 'glass' | 'solid') => cb!(m);
  };

  it('starts classic until the choice arrives, then shows glass only if chosen and supported, at once', () => {
    fakeMain('glass');
    const root = document.createElement('html');
    const look = setupAppearance(root);
    expect(root.dataset.material).toBe('solid');
    look.setChoice('glass');
    expect(root.dataset.material).toBe('glass');
    look.setChoice('classic');
    expect(root.dataset.material).toBe('solid');
    expect(look.supported()).toBe(true);
  });

  it('when the system cannot show glass, a Glass choice shows classic; when support appears later, glass applies without a restart', () => {
    const send = fakeMain('solid');
    const root = document.createElement('html');
    const look = setupAppearance(root);
    const changed = vi.fn();
    look.onSupportChange(changed);
    look.setChoice('glass');
    expect(root.dataset.material).toBe('solid');
    expect(look.supported()).toBe(false);
    send('glass');
    expect(root.dataset.material).toBe('glass');
    expect(changed).toHaveBeenCalledTimes(1);
    send('solid');
    expect(root.dataset.material).toBe('solid');
  });

  it('without the preload (a plain browser) glass is not supported', () => {
    const root = document.createElement('html');
    const look = setupAppearance(root);
    look.setChoice('glass');
    expect(root.dataset.material).toBe('solid');
    expect(look.supported()).toBe(false);
  });
});

describe('Settings > Look', () => {
  const settings: Settings = { units: 'metric', timeFormat: '12h', windUnit: 'kmh', tempLabels: '3h', location: 'ask', appearance: 'classic', closeBehavior: 'ask', rainAlerts: false };
  let supported = true;
  const setAppearance = vi.fn<(a: Appearance) => void>();
  const bindings: SettingsBindings = {
    get: () => settings,
    setUnits: vi.fn(),
    setWindUnit: vi.fn(),
    setTimeFormat: vi.fn(),
    setTempLabels: vi.fn(),
    setLocation: vi.fn(),
    locationStatus: () => 'status',
    setAppearance: (a) => {
      setAppearance(a);
      settings.appearance = a;
      syncSettingsControls();
    },
    glassSupported: () => supported,
    setCloseBehavior: vi.fn(),
    startup: () => null,
    setStartup: vi.fn(),
    setRainAlerts: vi.fn(),
    sendTestAlert: vi.fn(),
    now: () => '2026-11-08T10:00:00',
  };
  const mount = () => {
    document.body.innerHTML =
      '<div id="settings"><section id="settings-sheet"><button class="settings-close"></button><div id="settings-sections"></div></section><div class="titlebar"></div><div class="layout"></div></div><button id="settings-button"></button>';
    setupSettings(bindings);
    return document.getElementById('settings-look')!;
  };
  const button = (section: HTMLElement, text: string) => [...section.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === text)!;
  afterEach(() => {
    setAppearance.mockClear();
    settings.appearance = 'classic';
    supported = true;
  });

  it('is a "Look" section with one row: a Classic | Glass control (no shown explanation) and an info button with the static text', () => {
    const section = mount();
    expect(document.querySelector('#settings-sections')!.firstElementChild).toBe(section); // Updates is prepended before it at startup
    expect(section.querySelector('h3')!.textContent).toBe('Look');
    expect([...section.querySelectorAll('[role="radio"]')].map((b) => b.textContent)).toEqual(['Classic', 'Glass']);
    expect(section.querySelectorAll('.settings-row')).toHaveLength(1);
    expect([...section.querySelectorAll('p')].filter((p) => !p.closest('[hidden]') && !p.classList.contains('sr-only'))).toEqual([]);
    expect(section.querySelector('.settings-row-label')!.classList.contains('sr-only')).toBe(true);
    const info = section.querySelector<HTMLButtonElement>('.info-button')!;
    expect(info.getAttribute('aria-controls')).toBe('look-info');
    const pop = document.getElementById('look-info')!;
    expect(pop.hidden).toBe(true);
    expect(pop.textContent).toBe(LOOK_GLASS_NEEDS);
    expect(LOOK_GLASS_NEEDS).toBe('Glass needs Windows 11 22H2 or newer with Transparency effects on.');
    info.click();
    expect(pop.hidden).toBe(false);
  });

  it('choosing Glass calls the setter at once and the control follows', () => {
    const section = mount();
    expect(button(section, 'Classic').getAttribute('aria-checked')).toBe('true');
    button(section, 'Glass').click();
    expect(setAppearance).toHaveBeenCalledWith('glass');
    expect(button(section, 'Glass').getAttribute('aria-checked')).toBe('true');
    button(section, 'Classic').click();
    expect(setAppearance).toHaveBeenLastCalledWith('classic');
  });

  it('without system support the Glass option is disabled, cannot be chosen, and Classic reads as chosen', () => {
    supported = false;
    settings.appearance = 'glass';
    const section = mount();
    const glass = button(section, 'Glass');
    expect(glass.disabled).toBe(true);
    expect(glass.getAttribute('aria-disabled')).toBe('true');
    expect(button(section, 'Classic').getAttribute('aria-checked')).toBe('true');
    glass.click();
    expect(setAppearance).not.toHaveBeenCalled();
    supported = true; // support appears later: the next sync enables it again
    syncSettingsControls();
    expect(glass.disabled).toBe(false);
    expect(glass.hasAttribute('aria-disabled')).toBe(false);
    expect(glass.getAttribute('aria-checked')).toBe('true');
  });
});
