// @vitest-environment happy-dom
// The settings sections (Units, Time format) and the helpers for adding more:
// they must produce accessible markup and stay in sync with the settings.

import { describe, expect, it, vi } from 'vitest';
import {
  renderSettingsSections,
  segmentedControl,
  settingsRow,
  settingsSection,
  setupSettings,
  SETTINGS_SECTIONS,
  syncSettingsControls,
  type SettingsBindings,
  type SettingsSection,
} from '../src/renderer/components/settings';
import type { Settings } from '../src/shared/types';

function toggle(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  return input;
}

describe('settings helpers', () => {
  it('ships the Units, Time format, Temperature chart and Location sections, and nothing else yet', () => {
    expect(SETTINGS_SECTIONS.map((s) => [s.id, s.title])).toEqual([
      ['units', 'Units'],
      ['time-format', 'Time format'],
      ['temperature-chart', 'Temperature chart'],
      ['location', 'Location'],
    ]);
  });

  it('settingsSection shows an optional description under the title and links it to the section', () => {
    const el = settingsSection({ id: 'x', title: 'X', description: 'What this does.', render: () => {} });
    const children = [...el.children].map((c) => c.className || c.tagName);
    expect(children).toEqual(['settings-section-title', 'settings-section-description', 'settings-section-body']);
    expect(el.querySelector('.settings-section-description')!.textContent).toBe('What this does.');
    expect(el.getAttribute('aria-describedby')).toBe(el.querySelector('.settings-section-description')!.id);
  });

  it('segmentedControl labels can be functions and are refreshed on sync', () => {
    let n = 1;
    const group = segmentedControl({ options: [{ value: 'a', label: () => `Now ${n}` }], current: () => 'a', onChange: () => {} });
    expect(group.querySelector('button')!.textContent).toBe('Now 1');
    n = 2;
    syncSettingsControls();
    expect(group.querySelector('button')!.textContent).toBe('Now 2');
  });

  it('settingsRow links its label and description to the control', () => {
    const control = toggle();
    const row = settingsRow({ label: 'Show seconds', description: 'Adds seconds to the clock.', control });

    const label = row.querySelector('label')!;
    const desc = row.querySelector('.settings-row-description')!;
    expect(label.textContent).toBe('Show seconds');
    expect(control.id).not.toBe('');
    expect(label.htmlFor).toBe(control.id);
    expect(control.getAttribute('aria-describedby')).toBe(desc.id);
    expect(desc.textContent).toBe('Adds seconds to the clock.');
    expect(row.querySelector('.settings-row-control')!.contains(control)).toBe(true);
  });

  it('settingsRow names a non-form control (a radio group) from its label', () => {
    const group = segmentedControl({ options: [{ value: 'a', label: 'A' }], current: () => 'a', onChange: () => {} });
    const row = settingsRow({ label: 'Wind', control: group });
    expect(group.getAttribute('aria-labelledby')).toBe(row.querySelector('label')!.id);
    expect(row.querySelector('label')!.htmlFor).toBe('');
  });

  it('settingsRow keeps an existing control id and works without a description', () => {
    const control = toggle();
    control.id = 'my-toggle';
    const row = settingsRow({ label: 'Compact', control });
    expect(row.querySelector('label')!.htmlFor).toBe('my-toggle');
    expect(row.querySelector('.settings-row-description')).toBeNull();
    expect(control.hasAttribute('aria-describedby')).toBe(false);
  });

  it('settingsSection builds a labelled section and renders its rows', () => {
    const section: SettingsSection = {
      id: 'display',
      title: 'Display',
      render: (body) => body.append(settingsRow({ label: 'Compact', control: toggle() })),
    };
    const el = settingsSection(section);
    expect(el.id).toBe('settings-display');
    expect(el.querySelector('h3')!.textContent).toBe('Display');
    expect(el.getAttribute('aria-labelledby')).toBe(el.querySelector('h3')!.id);
    expect(el.querySelectorAll('.settings-section-body .settings-row')).toHaveLength(1);
    expect(el.querySelector('.settings-section-description')).toBeNull();

    const container = document.createElement('div');
    renderSettingsSections(container, [section, { ...section, id: 'other', title: 'Other' }]);
    expect([...container.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Display', 'Other']);
  });
});

describe('the real sections', () => {
  const settings: Settings = { units: 'metric', timeFormat: '12h', windUnit: 'kmh', tempLabels: '3h', location: 'ask' };
  let nowLocal = '2026-10-17T16:05:30';
  const bindings: SettingsBindings = {
    get: () => settings,
    setUnits: vi.fn((u) => void (settings.units = u)),
    setWindUnit: vi.fn((u) => void (settings.windUnit = u)),
    setTimeFormat: vi.fn((f) => void (settings.timeFormat = f)),
    setTempLabels: vi.fn((l) => void (settings.tempLabels = l)),
    setLocation: vi.fn((on) => void (settings.location = on ? 'on' : 'off')),
    locationStatus: () => `status:${settings.location}`,
    now: () => nowLocal,
  };

  function mount(): HTMLElement {
    document.body.innerHTML = '<div id="settings"><section id="settings-sheet"><button class="settings-close"></button><div id="settings-sections"></div></section><div class="titlebar"></div><div class="layout"></div></div><button id="settings-button"></button>';
    setupSettings(bindings);
    return document.getElementById('settings-sections')!;
  }

  const checked = (root: HTMLElement, group: number) =>
    [...root.querySelectorAll('[role="radiogroup"]')[group]!.querySelectorAll('button')]
      .filter((b) => b.getAttribute('aria-checked') === 'true')
      .map((b) => b.textContent);

  it('renders radio groups with the current values checked', () => {
    const root = mount();
    expect([...root.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Units', 'Time format', 'Temperature chart', 'Location']);
    expect(root.querySelectorAll('[role="radiogroup"]')).toHaveLength(4);
    expect(checked(root, 0)).toEqual(['°C']);
    expect(checked(root, 1)).toEqual(['km/h']);
    expect(checked(root, 2)).toEqual(['12-hour (4:05 PM)']);
    expect(checked(root, 3)).toEqual(['Every 3 hours']);
    expect([...root.querySelectorAll('[role="radiogroup"]')[1]!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'km/h',
      'mph',
      'm/s',
    ]);
  });

  it('labels the time formats with examples from the current time, and says where they apply', () => {
    const root = mount();
    const labels = () => [...root.querySelectorAll('[role="radiogroup"]')[2]!.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels()).toEqual(['12-hour (4:05 PM)', '24-hour (16:05)']);
    expect(root.querySelector('#settings-time-format .settings-section-description')!.textContent).toMatch(/clock.*hourly.*sunrise and sunset/i);
    nowLocal = '2026-10-17T00:09:00';
    syncSettingsControls();
    expect(labels()).toEqual(['12-hour (12:09 AM)', '24-hour (00:09)']);
    nowLocal = '2026-10-17T16:05:30';
  });

  it('offers every 3 hours, every 2 hours and every hour, and calls the setter', () => {
    const root = mount();
    const group = root.querySelectorAll('[role="radiogroup"]')[3]!;
    expect([...group.querySelectorAll('button')].map((b) => [b.dataset.value, b.textContent])).toEqual([
      ['3h', 'Every 3 hours'],
      ['2h', 'Every 2 hours'],
      ['1h', 'Every hour'],
    ]);
    [...group.querySelectorAll('button')].find((b) => b.dataset.value === '1h')!.click();
    expect(bindings.setTempLabels).toHaveBeenCalledWith('1h');
    syncSettingsControls();
    expect(checked(root, 3)).toEqual(['Every hour']);
    settings.tempLabels = '3h';
  });

  it('has no version line of its own any more (the version lives in the Updates section)', () => {
    const root = mount();
    expect(root.querySelector('#settings-version')).toBeNull();
    expect(root.lastElementChild!.id).toBe('settings-location');
  });

  it('a row can be plain information, with no control', () => {
    const row = settingsRow({ label: 'Version 1.4.7', description: 'Some note' });
    expect(row.querySelector('.settings-row-control')).toBeNull();
    expect(row.querySelector('label')!.htmlFor).toBe('');
    expect(row.querySelector('.settings-row-description')!.textContent).toBe('Some note');
  });

  it('calls the matching setter on click and follows outside changes', () => {
    const root = mount();
    const button = (group: number, text: string) =>
      [...root.querySelectorAll('[role="radiogroup"]')[group]!.querySelectorAll('button')].find((b) => b.textContent === text)!;

    button(1, 'm/s').click();
    button(2, '24-hour (16:05)').click();
    expect(bindings.setWindUnit).toHaveBeenCalledWith('ms');
    expect(bindings.setTimeFormat).toHaveBeenCalledWith('24h');

    // The title-bar °C/°F toggle changes the setting elsewhere; the panel catches up on sync.
    settings.units = 'imperial';
    syncSettingsControls();
    expect(checked(root, 0)).toEqual(['°F']);
    expect(checked(root, 1)).toEqual(['m/s']);
    expect(checked(root, 2)).toEqual(['24-hour (16:05)']);
  });
});
