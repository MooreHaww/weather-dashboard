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
  it('ships the Units and Time format sections, and nothing else yet', () => {
    expect(SETTINGS_SECTIONS.map((s) => [s.id, s.title])).toEqual([
      ['units', 'Units'],
      ['time-format', 'Time format'],
    ]);
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

    const container = document.createElement('div');
    renderSettingsSections(container, [section, { ...section, id: 'other', title: 'Other' }]);
    expect([...container.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Display', 'Other']);
  });
});

describe('the real sections', () => {
  const settings: Settings = { units: 'metric', timeFormat: '12h', windUnit: 'kmh' };
  const bindings: SettingsBindings = {
    get: () => settings,
    setUnits: vi.fn((u) => void (settings.units = u)),
    setWindUnit: vi.fn((u) => void (settings.windUnit = u)),
    setTimeFormat: vi.fn((f) => void (settings.timeFormat = f)),
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
    expect([...root.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Units', 'Time format']);
    expect(root.querySelectorAll('[role="radiogroup"]')).toHaveLength(3);
    expect(checked(root, 0)).toEqual(['°C']);
    expect(checked(root, 1)).toEqual(['km/h']);
    expect(checked(root, 2)).toEqual(['12-hour (AM/PM)']);
    expect([...root.querySelectorAll('[role="radiogroup"]')[1]!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'km/h',
      'mph',
      'm/s',
    ]);
  });

  it('calls the matching setter on click and follows outside changes', () => {
    const root = mount();
    const button = (group: number, text: string) =>
      [...root.querySelectorAll('[role="radiogroup"]')[group]!.querySelectorAll('button')].find((b) => b.textContent === text)!;

    button(1, 'm/s').click();
    button(2, '24-hour').click();
    expect(bindings.setWindUnit).toHaveBeenCalledWith('ms');
    expect(bindings.setTimeFormat).toHaveBeenCalledWith('24h');

    // The title-bar °C/°F toggle changes the setting elsewhere; the panel catches up on sync.
    settings.units = 'imperial';
    syncSettingsControls();
    expect(checked(root, 0)).toEqual(['°F']);
    expect(checked(root, 1)).toEqual(['m/s']);
    expect(checked(root, 2)).toEqual(['24-hour']);
  });
});
