// Settings panel: a glass sheet that slides down from the top over a frosted
// backdrop. It is intentionally empty for now; add sections to
// SETTINGS_SECTIONS below (see "Settings panel" in the README).

export interface SettingsSection {
  /** Unique id, used for the section's DOM id ("settings-<id>"). */
  id: string;
  title: string;
  /** Fill the section body, typically with settingsRow(...) elements. */
  render(body: HTMLElement): void;
}

/** Add future settings sections here, in display order. Empty for now. */
export const SETTINGS_SECTIONS: SettingsSection[] = [];

let rowCount = 0;

/** One labelled setting: label (and optional description) on the left, the control on the right. */
export function settingsRow(opts: { label: string; description?: string; control: HTMLElement }): HTMLElement {
  const n = ++rowCount;
  const row = document.createElement('div');
  row.className = 'settings-row';

  const text = document.createElement('div');
  text.className = 'settings-row-text';
  const label = document.createElement('label');
  label.className = 'settings-row-label';
  label.textContent = opts.label;
  opts.control.id ||= `settings-control-${n}`;
  label.htmlFor = opts.control.id;
  text.append(label);

  if (opts.description) {
    const desc = document.createElement('p');
    desc.className = 'settings-row-description';
    desc.id = `settings-desc-${n}`;
    desc.textContent = opts.description;
    text.append(desc);
    opts.control.setAttribute('aria-describedby', desc.id);
  }

  const control = document.createElement('div');
  control.className = 'settings-row-control';
  control.append(opts.control);

  row.append(text, control);
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
  el.append(heading, body);
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
export function setupSettings(): { open: () => void; close: () => void; isOpen: () => boolean } {
  const root = document.getElementById('settings')!;
  const sheet = document.getElementById('settings-sheet')!;
  const gear = document.getElementById('settings-button')!;
  const closeButton = root.querySelector<HTMLButtonElement>('.settings-close')!;
  const background = [document.querySelector('.titlebar'), document.querySelector('.layout')].filter(
    (el): el is HTMLElement => el !== null,
  );
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderSettingsSections(document.getElementById('settings-sections')!);

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
    if (reducedMotion()) {
      finish();
    } else {
      sheet.addEventListener('transitionend', onEnd);
      hideTimer = window.setTimeout(finish, CLOSE_FALLBACK_MS);
    }
  }

  gear.addEventListener('click', () => (open ? hide() : show()));
  closeButton.addEventListener('click', hide);
  root.querySelector('.settings-scrim')!.addEventListener('click', hide);

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
