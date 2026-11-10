// Settings panel: a liquid-glass layer that slides down from the top and covers
// the whole window, frosting the dashboard behind it. Add sections to
// SETTINGS_SECTIONS below (see "Settings panel" in the README).

import { RAIN_ALERT_FACTS, STARTUP_FACTS } from '../../shared/backgroundText';
import { LOCATION_FACTS, LOCATION_SETTINGS_LINE } from '../../shared/locationText';
import { formatTime } from '../../shared/time';
import { WIND_LABELS, type Appearance, type CloseBehavior, type Settings, type TempLabels, type TimeFormat, type Units, type WindUnit } from '../../shared/types';

export interface SettingsSection {
  /** Unique id, used for the section's DOM id ("settings-<id>"). */
  id: string;
  title: string;
  /** An optional short line under the title. Only for what the user must know (Location's one line); explanations go in `hint`. */
  description?: string;
  /** Hidden text for screen readers (linked with aria-describedby), not shown: the panel shows only titles and controls. */
  hint?: string;
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
  /** The "Use my location" switch: on asks the server for the place (and the answer comes back through a sync), off forgets it. */
  setLocation(on: boolean): void;
  /** Settings > Look (v1.7): Classic or Glass, applied at once. */
  setAppearance(appearance: Appearance): void;
  /** Whether this PC can show glass now; when it cannot, the Glass option is disabled (and the page shows classic). */
  glassSupported(): boolean;
  /** The line under the switch (see locationStatus in shared/locationText.ts). */
  locationStatus(): string;
  /** The selected city's current local time ("YYYY-MM-DDTHH:mm:ss"), used for the time-format examples. */
  now(): string;
  /** Settings > Background (v1.9). */
  setCloseBehavior(closeBehavior: CloseBehavior): void;
  /** "Start with Windows" as the OS last reported it (read again when the panel opens); null before the first answer. */
  startup(): { supported: boolean; enabled: boolean } | null;
  setStartup(on: boolean): void;
  setRainAlerts(on: boolean): void;
  sendTestAlert(): void;
  /** Called each time the panel opens (re-reads the OS login item). */
  onOpen?(): void;
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
  options: { value: T; label: string | (() => string); disabled?: () => boolean }[];
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
    b.addEventListener('click', () => {
      if (!b.disabled) opts.onChange(value);
    });
    return b;
  });
  const sync = () => {
    const current = opts.current();
    buttons.forEach((b, i) => {
      const label = opts.options[i]!.label;
      if (typeof label === 'function') b.textContent = label();
      const off = opts.options[i]!.disabled?.() ?? false;
      b.disabled = off;
      if (off) b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
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

/**
 * An on/off switch (role="switch"). Pressing it calls `onChange` with the new value; the caller
 * changes the setting and syncs the panel, which is what flips `aria-checked`.
 */
export function switchControl(opts: { current: () => boolean; onChange: (on: boolean) => void; disabled?: () => boolean }): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'switch';
  b.setAttribute('role', 'switch');
  b.innerHTML = '<span class="switch-knob" aria-hidden="true"></span>';
  b.addEventListener('click', () => {
    if (!b.disabled) opts.onChange(b.getAttribute('aria-checked') !== 'true');
  });
  const sync = () => {
    b.setAttribute('aria-checked', String(opts.current()));
    b.disabled = opts.disabled?.() ?? false;
  };
  syncers.add(sync);
  sync();
  return b;
}

/** The info button's text in Settings > Look (v1.7). */
export const LOOK_GLASS_NEEDS = 'Glass needs Windows 11 22H2 or newer with Transparency effects on.';

/** Add future settings sections here, in display order. (Updates is added first by updateNote.ts, so Look is second.) */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'look',
    title: 'Look',
    render(body) {
      const row = settingsRow({
        label: 'Look',
        control: segmentedControl<Appearance>({
          options: [
            { value: 'classic', label: 'Classic' },
            { value: 'glass', label: 'Glass', disabled: () => !bindings!.glassSupported() },
          ],
          // Where glass cannot be shown the page is classic, so Classic is what reads as chosen.
          current: () => (bindings!.glassSupported() ? bindings!.get().appearance : 'classic'),
          onChange: (v) => bindings!.setAppearance(v),
        }),
      });
      // The section title already says "Look": the row's own label is for screen readers only.
      row.querySelector('.settings-row-label')!.classList.add('sr-only');
      row.querySelector('.settings-row-control')!.append(...infoPopover({ id: 'look-info', label: 'About Glass', lines: [LOOK_GLASS_NEEDS] }));
      body.append(row);
    },
  },
  {
    id: 'background',
    title: 'Background',
    render(body) {
      body.append(
        settingsRow({
          label: 'When I close the window',
          control: segmentedControl<CloseBehavior>({
            options: [
              { value: 'ask', label: 'Ask' },
              { value: 'background', label: 'Keep running' },
              { value: 'exit', label: 'Exit' },
            ],
            current: () => bindings!.get().closeBehavior,
            onChange: (v) => bindings!.setCloseBehavior(v),
          }),
        }),
      );

      const startupSwitch = switchControl({
        current: () => bindings!.startup()?.enabled ?? false,
        disabled: () => !bindings!.startup()?.supported,
        onChange: (on) => bindings!.setStartup(on),
      });
      startupSwitch.id = 'settings-startup'; // before settingsRow, so the row's label points at it
      const startup = settingsRow({ label: 'Start with Windows', control: startupSwitch });
      startup.querySelector('.settings-row-control')!.append(
        ...infoPopover({ id: 'startup-info', label: 'About Start with Windows', ...STARTUP_FACTS }),
      );
      body.append(startup);

      const alertSwitch = switchControl({
        current: () => bindings!.get().rainAlerts,
        onChange: (on) => bindings!.setRainAlerts(on),
      });
      alertSwitch.id = 'settings-rain-alerts';
      const alerts = settingsRow({ label: 'Rain alerts', control: alertSwitch });
      const test = document.createElement('button');
      test.type = 'button';
      test.className = 'button button-small';
      test.id = 'rain-alert-test';
      test.textContent = 'Send a test';
      test.addEventListener('click', () => bindings!.sendTestAlert());
      alerts.querySelector('.settings-row-control')!.append(
        test,
        ...infoPopover({ id: 'rain-alert-info', label: 'About rain alerts', ...RAIN_ALERT_FACTS }),
      );
      body.append(alerts);
    },
  },
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
    hint: 'Applies to the live clock, the hourly times and charts, sunrise and sunset, and the rain summary.',
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
          hint: 'How often the strip under the chart shows a time, icon and temperature. Narrow windows show fewer.',
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
  {
    id: 'location',
    title: 'Location',
    description: LOCATION_SETTINGS_LINE,
    render(body) {
      const row = settingsRow({
        label: 'Use my location',
        description: bindings!.locationStatus(),
        control: switchControl({
          current: () => bindings!.get().location === 'on',
          onChange: (on) => bindings!.setLocation(on),
        }),
      });
      // The "i" button sits after the switch (so the row's label still names the switch), its popover right after it.
      row.querySelector('.settings-row-control')!.append(
        ...infoPopover({ id: 'location-info', label: 'How is my IP address used?', ...LOCATION_FACTS }),
      );
      const status = row.querySelector('.settings-row-description')!;
      status.id = 'settings-location-status';
      onSettingsSync(() => {
        const text = bindings!.locationStatus();
        if (status.textContent !== text) status.textContent = text;
      });
      body.append(row);
    },
  },
];

let rowCount = 0;

/** A `.sr-only` paragraph: read by screen readers through aria-describedby, not shown. */
function hiddenHint(id: string, text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'sr-only';
  p.id = id;
  p.textContent = text;
  return p;
}

/**
 * One labelled setting: label (and optional description) on the left, the control on the right (none for a plain information row).
 * `description` is shown (state lines only); `hint` is for screen readers only.
 */
export function settingsRow(opts: { label: string; description?: string; hint?: string; control?: HTMLElement }): HTMLElement {
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

  const describedBy: string[] = [];
  if (opts.description) {
    const desc = document.createElement('p');
    desc.className = 'settings-row-description';
    desc.id = `settings-desc-${n}`;
    desc.textContent = opts.description;
    text.append(desc);
    describedBy.push(desc.id);
  }
  if (opts.hint) {
    const hint = hiddenHint(`settings-hint-${n}`, opts.hint);
    text.append(hint);
    describedBy.push(hint.id);
  }
  if (describedBy.length) widget?.setAttribute('aria-describedby', describedBy.join(' '));

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
  const describedBy: string[] = [];
  if (section.description) {
    const desc = document.createElement('p');
    desc.className = 'settings-section-description';
    desc.id = `settings-${section.id}-description`;
    desc.textContent = section.description;
    describedBy.push(desc.id);
    el.append(desc);
  }
  if (section.hint) {
    const hint = hiddenHint(`settings-${section.id}-hint`, section.hint);
    describedBy.push(hint.id);
    el.append(hint);
  }
  if (describedBy.length) el.setAttribute('aria-describedby', describedBy.join(' '));
  el.append(body);
  return el;
}

/** Closes every open info popover (when the panel closes). */
const popoverClosers = new Set<() => void>();

const POPOVER_MARGIN = 16;
const POPOVER_GAP = 8;
const POPOVER_WIDTH = 320;

/**
 * A small "i" button and the popover it opens (static text: a title and a list of lines, set with textContent).
 * The popover is `position: fixed` (the sheet is its containing block, so the scrolling sections never clip it), placed
 * under the button or above it, inside the sections area with 16 px margins; it scrolls inside itself if it does not fit.
 * Escape closes only the popover and returns focus to the button; a click outside or focus leaving closes it too.
 */
export function infoPopover(opts: { id: string; label: string; title?: string; lines: readonly string[] }): [HTMLButtonElement, HTMLElement] {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'info-button';
  button.setAttribute('aria-label', opts.label);
  button.title = opts.label;
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', opts.id);
  button.innerHTML = '<span aria-hidden="true">i</span>';

  const popover = document.createElement('div');
  popover.id = opts.id;
  popover.className = 'info-popover';
  popover.setAttribute('role', 'dialog');
  popover.tabIndex = -1;
  popover.hidden = true;
  if (opts.title === undefined) {
    // One plain line (Settings > Look): the popover is named by its button.
    popover.setAttribute('aria-label', opts.label);
    const p = document.createElement('p');
    p.className = 'info-popover-text';
    p.textContent = opts.lines.join(' ');
    popover.append(p);
  } else {
    const title = document.createElement('h4');
    title.className = 'info-popover-title';
    title.id = `${opts.id}-title`;
    title.textContent = opts.title;
    popover.setAttribute('aria-labelledby', title.id);
    const list = document.createElement('ul');
    list.className = 'info-popover-list';
    list.append(
      ...opts.lines.map((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        return li;
      }),
    );
    popover.append(title, list);
  }

  const isOpen = () => !popover.hidden;

  const place = () => {
    if (!isOpen()) return;
    // The room it may use: the sections area (below the panel header), never past the window.
    const area = (button.closest('.settings-sections') ?? document.documentElement).getBoundingClientRect();
    const top = Math.max(area.top, 0) + POPOVER_MARGIN;
    const bottom = Math.min(area.bottom, window.innerHeight) - POPOVER_MARGIN;
    const left = Math.max(area.left, 0) + POPOVER_MARGIN;
    const right = Math.min(area.right, window.innerWidth) - POPOVER_MARGIN;
    const width = Math.max(0, Math.min(POPOVER_WIDTH, right - left));
    popover.style.width = `${width}px`;
    popover.style.maxHeight = '';
    popover.style.left = '0px';
    popover.style.top = '0px';
    // Where (0, 0) lands: the containing block's corner (the sheet), whatever it is.
    const origin = popover.getBoundingClientRect();
    const height = origin.height;
    const b = button.getBoundingClientRect();
    // The button was scrolled out of sight: there is nothing left to point at.
    if (b.bottom < top - POPOVER_MARGIN || b.top > bottom + POPOVER_MARGIN) {
      close(popover.contains(document.activeElement));
      return;
    }
    const below = bottom - (b.bottom + POPOVER_GAP);
    const above = b.top - POPOVER_GAP - top;
    const under = below >= height || below >= above;
    const room = Math.max(0, under ? below : above);
    const shown = Math.min(height, room);
    popover.style.maxHeight = `${room}px`;
    const y = under ? b.bottom + POPOVER_GAP : b.top - POPOVER_GAP - shown;
    const x = Math.min(Math.max(b.right - width, left), right - width);
    popover.style.left = `${Math.round(x - origin.left)}px`;
    popover.style.top = `${Math.round(Math.min(Math.max(y, top), bottom - shown) - origin.top)}px`;
  };
  const onScroll = (e: Event) => {
    if (e.target !== popover) place(); // its own scrolling moves nothing
  };

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (popover.contains(target) || button.contains(target)) return;
    close(popover.contains(document.activeElement));
  };

  function open(): void {
    popover.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    // Opened from the keyboard after the sections were scrolled away: bring the button back first (only the sections scroll).
    button.scrollIntoView({ block: 'nearest' });
    place();
    if (!isOpen()) return; // its button is out of sight
    window.addEventListener('resize', place);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    popoverClosers.add(close);
    // preventScroll: it is already placed in view; focusing must not scroll the panel behind it.
    popover.focus({ preventScroll: true });
  }

  function close(returnFocus = false): void {
    if (!isOpen()) return;
    popover.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    window.removeEventListener('resize', place);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    popoverClosers.delete(close);
    if (returnFocus) button.focus({ preventScroll: true });
  }

  button.addEventListener('click', () => (isOpen() ? close() : open()));
  for (const el of [button, popover] as HTMLElement[]) {
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !isOpen()) return;
      // Only the popover closes: the panel's own Escape handler never sees this key.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    });
    el.addEventListener('focusout', (e) => {
      const next = e.relatedTarget as Node | null;
      if (next && (popover.contains(next) || button.contains(next))) return;
      if (next) close(); // focus moved somewhere else (a window losing focus leaves it open)
    });
  }
  return [button, popover];
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
    b.onOpen?.();
  }

  function hide(): void {
    if (!open) return;
    open = false;
    popoverClosers.forEach((closePopover) => closePopover());
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
    // Focus inside an open info popover counts as being on its button (the popover sits right after it).
    const popover = document.activeElement?.closest('.info-popover');
    const active = popover ? document.querySelector(`[aria-controls="${popover.id}"]`) : document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // If focus ever lands outside the open panel, bring it back.
  document.addEventListener('focusin', (e) => {
    // The close dialog (v1.9) sits over everything, the panel included: leave its focus alone.
    if ((e.target as Element | null)?.closest?.('#close-confirm')) return;
    if (open && !sheet.contains(e.target as Node)) (focusables()[0] ?? sheet).focus();
  });

  return { open: show, close: hide, isOpen: () => open };
}
