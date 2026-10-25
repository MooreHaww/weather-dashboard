// Settings panel: a liquid-glass layer that slides down from the top and covers
// the whole window, frosting the dashboard behind it. Add sections to
// SETTINGS_SECTIONS below (see "Settings panel" in the README).

import { formatTime } from '../../shared/time';
import { WIND_LABELS, type Settings, type TempLabels, type TimeFormat, type Units, type WindUnit } from '../../shared/types';

export interface SettingsSection {
  /** Unique id, used for the section's DOM id ("settings-<id>"). */
  id: string;
  title: string;
  /** An optional short line under the title, saying what the section does. */
  description?: string;
  /** Fill the section body, typically with settingsRow(...) elements. */
  render(body: HTMLElement): void;
}

/** What the panel needs from the app: current settings and one setter per control. */
export interface SettingsBindings {
  get(): Settings;
  setUnits(units: Units): void;
  setWindUnit(windUnit: WindUnit): void;
  setTimeFormat(timeFormat: TimeFormat): void;
  setTempLabels(tempLabels: TempLabels): void;
  /** The selected city's current local time ("YYYY-MM-DDTHH:mm:ss"), used for the time-format examples. */
  now(): string;
}

let bindings: SettingsBindings | null = null;
const syncers = new Set<() => void>();

/** Refresh every control in the panel from the current settings (after a setting changes outside the panel). */
export function syncSettingsControls(): void {
  syncers.forEach((fn) => fn());
}

/** Run `fn` whenever the panel is synced (a setting changed, or the minute tick). For text outside the segmented controls. */
export function onSettingsSync(fn: () => void): void {
  syncers.add(fn);
}

/** A row of mutually exclusive buttons (radio-group semantics), styled as a pill group. */
export function segmentedControl<T extends string>(opts: {
  /** A label can be a function, so it can show something live (like the current time). */
  options: { value: T; label: string | (() => string) }[];
  current: () => T;
  onChange: (value: T) => void;
}): HTMLElement {
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'radiogroup');
  const buttons = opts.options.map(({ value, label }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.value = value;
    b.textContent = typeof label === 'function' ? label() : label;
    b.addEventListener('click', () => opts.onChange(value));
    return b;
  });
  const sync = () => {
    const current = opts.current();
    buttons.forEach((b, i) => {
      const label = opts.options[i]!.label;
      if (typeof label === 'function') b.textContent = label();
      const on = b.dataset.value === current;
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-pressed', String(on)); // drives the pressed styling
    });
  };
  group.append(...buttons);
  syncers.add(sync);
  sync();
  return group;
}

/** Add future settings sections here, in display order. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'units',
    title: 'Units',
    render(body) {
      body.append(
        settingsRow({
          label: 'Temperature',
          control: segmentedControl<Units>({
            options: [
              { value: 'metric', label: '°C' },
              { value: 'imperial', label: '°F' },
            ],
            current: () => bindings!.get().units,
            onChange: (v) => bindings!.setUnits(v),
          }),
        }),
        settingsRow({
          label: 'Wind speed',
          control: segmentedControl<WindUnit>({
            options: (['kmh', 'mph', 'ms'] as const).map((value) => ({ value, label: WIND_LABELS[value] })),
            current: () => bindings!.get().windUnit,
            onChange: (v) => bindings!.setWindUnit(v),
          }),
        }),
      );
    },
  },
  {
    id: 'time-format',
    title: 'Time format',
    description: 'Applies to the live clock, the hourly times and charts, sunrise and sunset, and the rain summary.',
    render(body) {
      const example = (format: TimeFormat) => formatTime(bindings!.now(), format, { minutes: true });
      body.append(
        settingsRow({
          label: 'Show times as',
          control: segmentedControl<TimeFormat>({
            options: [
              { value: '12h', label: () => `12-hour (${example('12h')})` },
              { value: '24h', label: () => `24-hour (${example('24h')})` },
            ],
            current: () => bindings!.get().timeFormat,
            onChange: (v) => bindings!.setTimeFormat(v),
          }),
        }),
      );
    },
  },
  {
    id: 'temperature-chart',
    title: 'Temperature chart',
    render(body) {
      body.append(
        settingsRow({
          label: 'Time labels',
          description: 'How often the strip under the chart shows a time, icon and temperature. Narrow windows show fewer.',
          control: segmentedControl<TempLabels>({
            options: [
              { value: '3h', label: 'Every 3 hours' },
              { value: '2h', label: 'Every 2 hours' },
              { value: '1h', label: 'Every hour' },
            ],
            current: () => bindings!.get().tempLabels,
            onChange: (v) => bindings!.setTempLabels(v),
          }),
        }),
      );
    },
  },
];

let rowCount = 0;

/** One labelled setting: label (and optional description) on the left, the control on the right (none for a plain information row). */
export function settingsRow(opts: { label: string; description?: string; control?: HTMLElement }): HTMLElement {
  const n = ++rowCount;
  const row = document.createElement('div');
  row.className = 'settings-row';

  const text = document.createElement('div');
  text.className = 'settings-row-text';
  const label = document.createElement('label');
  label.className = 'settings-row-label';
  label.textContent = opts.label;
  const { control: widget } = opts;
  if (widget) {
    widget.id ||= `settings-control-${n}`;
    if (widget.matches('input, select, textarea, button, meter, output, progress')) {
      label.htmlFor = widget.id;
    } else {
      // A label can't point at a div; name the control (e.g. a radio group) from the label instead.
      label.id = `settings-label-${n}`;
      widget.setAttribute('aria-labelledby', label.id);
    }
  }
  text.append(label);

  if (opts.description) {
    const desc = document.createElement('p');
    desc.className = 'settings-row-description';
    desc.id = `settings-desc-${n}`;
    desc.textContent = opts.description;
    text.append(desc);
    widget?.setAttribute('aria-describedby', desc.id);
  }

  row.append(text);
  if (widget) {
    const control = document.createElement('div');
    control.className = 'settings-row-control';
    control.append(widget);
    row.append(control);
  }
  return row;
}

/** A titled group of settings rows. */
export function settingsSection(section: SettingsSection): HTMLElement {
  const el = document.createElement('section');
  el.className = 'settings-section';
  el.id = `settings-${section.id}`;
  const heading = document.createElement('h3');
  heading.className = 'settings-section-title';
  heading.id = `settings-${section.id}-title`;
  heading.textContent = section.title;
  el.setAttribute('aria-labelledby', heading.id);
  const body = document.createElement('div');
  body.className = 'settings-section-body';
  section.render(body);
  el.append(heading);
  if (section.description) {
    const desc = document.createElement('p');
    desc.className = 'settings-section-description';
    desc.id = `settings-${section.id}-description`;
    desc.textContent = section.description;
    el.setAttribute('aria-describedby', desc.id);
    el.append(desc);
  }
  el.append(body);
  return el;
}

/** Render the sections into the panel body (replacing what was there). */
export function renderSettingsSections(container: HTMLElement, sections: SettingsSection[] = SETTINGS_SECTIONS): void {
  container.replaceChildren(...sections.map(settingsSection));
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CLOSE_FALLBACK_MS = 400;

/** Wire the gear button and the panel. Call once at startup. */
export function setupSettings(b: SettingsBindings): { open: () => void; close: () => void; isOpen: () => boolean } {
  bindings = b;
  const root = document.getElementById('settings')!;
  const sheet = document.getElementById('settings-sheet')!;
  const gear = document.getElementById('settings-button')!;
  const closeButton = root.querySelector<HTMLButtonElement>('.settings-close')!;
  const background = [document.querySelector('.titlebar'), document.querySelector('.layout')].filter(
    (el): el is HTMLElement => el !== null,
  );

  const sections = document.getElementById('settings-sections')!;
  renderSettingsSections(sections);
  syncSettingsControls();

  let open = false;
  let hideTimer: number | undefined;

  const focusables = () => [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);

  function show(): void {
    if (open) return;
    open = true;
    window.clearTimeout(hideTimer);
    root.hidden = false;
    void root.offsetHeight; // apply the closed state first, so the slide-in animates
    root.classList.add('is-open');
    background.forEach((el) => (el.inert = true));
    gear.setAttribute('aria-expanded', 'true');
    (focusables()[0] ?? sheet).focus();
  }

  function hide(): void {
    if (!open) return;
    open = false;
    root.classList.remove('is-open');
    background.forEach((el) => (el.inert = false));
    gear.setAttribute('aria-expanded', 'false');
    gear.focus();

    const finish = () => {
      window.clearTimeout(hideTimer);
      sheet.removeEventListener('transitionend', onEnd);
      if (!open) root.hidden = true;
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === sheet) finish();
    };
    // Slide (or, with reduced motion, fade) out first, then hide.
    sheet.addEventListener('transitionend', onEnd);
    hideTimer = window.setTimeout(finish, CLOSE_FALLBACK_MS);
  }

  gear.addEventListener('click', () => (open ? hide() : show()));
  closeButton.addEventListener('click', hide);

  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
      return;
    }
    if (e.key !== 'Tab') return;
    // Focus trap: cycle within the sheet.
    const items = focusables();
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // If focus ever lands outside the open panel, bring it back.
  document.addEventListener('focusin', (e) => {
    if (open && !sheet.contains(e.target as Node)) (focusables()[0] ?? sheet).focus();
  });

  return { open: show, close: hide, isOpen: () => open };
}
