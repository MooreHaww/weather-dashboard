// @vitest-environment happy-dom
// The settings panel ships empty; these tests make sure the helpers for adding
// sections later produce accessible markup.

import { describe, expect, it } from 'vitest';
import {
  renderSettingsSections,
  settingsRow,
  settingsSection,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from '../src/renderer/components/settings';

function toggle(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  return input;
}

describe('settings helpers', () => {
  it('ships with no sections', () => {
    expect(SETTINGS_SECTIONS).toEqual([]);
    const container = document.createElement('div');
    container.innerHTML = '<p>old</p>';
    renderSettingsSections(container);
    expect(container.children).toHaveLength(0);
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
