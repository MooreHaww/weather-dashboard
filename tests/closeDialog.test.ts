// @vitest-environment happy-dom
// v1.9: "Close Weather Dashboard?" in the page, the preload's window.background, and Settings > Background.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_TITLE, showCloseDialog } from '../src/renderer/components/closeDialog';
import { setupSettings, syncSettingsControls, type SettingsBindings } from '../src/renderer/components/settings';
import { RAIN_ALERT_FACTS, STARTUP_FACTS } from '../src/shared/backgroundText';
import type { CloseBehavior, Settings } from '../src/shared/types';

const key = (target: Element, k: string, shiftKey = false) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));

describe('the close dialog', () => {
  let remember: ReturnType<typeof vi.fn<(b: CloseBehavior) => Promise<unknown>>>;
  let choose: ReturnType<typeof vi.fn<(c: string) => void>>;
  let order: string[];

  beforeEach(() => {
    document.body.innerHTML = '<div class="titlebar"></div><main class="layout"><button id="before">x</button></main><div id="settings" hidden></div>';
    order = [];
    remember = vi.fn(async (b: CloseBehavior) => void order.push(`remember ${b}`));
    choose = vi.fn<(c: string) => void>((c) => void order.push(`choose ${c}`));
    document.getElementById('before')!.focus();
  });

  const open = () => showCloseDialog({ remember, choose });
  const button = (action: string) => document.querySelector<HTMLButtonElement>(`#close-confirm [data-action="${action}"]`)!;

  it('asks "Close Weather Dashboard?" with Keep running, Exit and Remember my choice; focus starts on Keep running; the rest is inert', () => {
    const layer = open();
    expect(layer.querySelector('h3')!.textContent).toBe(CLOSE_TITLE);
    expect([...layer.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Keep running', 'Exit']);
    expect(layer.querySelector<HTMLInputElement>('#close-remember')!.checked).toBe(false);
    expect(layer.querySelector('label.check')!.textContent).toBe('Remember my choice');
    expect(layer.querySelector('[role="alertdialog"]')!.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(button('hide'));
    expect(document.querySelector<HTMLElement>('.layout')!.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('#settings')!.inert).toBe(true);
    expect(layer.querySelectorAll('p')).toHaveLength(0); // no explanation text
  });

  it('Escape keeps the window open: nothing is sent, the page is usable again, focus returns', () => {
    open();
    key(button('hide'), 'Escape');
    expect(document.getElementById('close-confirm')).toBeNull();
    expect(choose).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('.layout')!.inert).toBe(false);
    expect(document.activeElement!.id).toBe('before');
  });

  it('keeps the inert state the page had (Settings open: dashboard stays inert after the dialog)', () => {
    document.querySelector<HTMLElement>('.layout')!.inert = true;
    open();
    key(button('hide'), 'Escape');
    expect(document.querySelector<HTMLElement>('.layout')!.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('#settings')!.inert).toBe(false);
  });

  it('unchecked: applies the choice once, saving nothing', async () => {
    open();
    button('exit').click();
    await vi.waitFor(() => expect(choose).toHaveBeenCalledWith('exit'));
    expect(remember).not.toHaveBeenCalled();
    open();
    button('hide').click();
    await vi.waitFor(() => expect(choose).toHaveBeenLastCalledWith('hide'));
  });

  it('Remember my choice: saves the setting first, then answers', async () => {
    open();
    document.querySelector<HTMLInputElement>('#close-remember')!.checked = true;
    button('hide').click();
    await vi.waitFor(() => expect(order).toEqual(['remember background', 'choose hide']));
    open();
    document.querySelector<HTMLInputElement>('#close-remember')!.checked = true;
    button('exit').click();
    await vi.waitFor(() => expect(order.slice(2)).toEqual(['remember exit', 'choose exit']));
  });

  it('a failed save still applies the choice', async () => {
    remember.mockRejectedValueOnce(new Error('500'));
    open();
    document.querySelector<HTMLInputElement>('#close-remember')!.checked = true;
    button('exit').click();
    await vi.waitFor(() => expect(choose).toHaveBeenCalledWith('exit'));
  });

  it('answers only once, and a second request while open shows no second dialog', async () => {
    const first = open();
    expect(open()).toBe(first);
    expect(document.querySelectorAll('#close-confirm')).toHaveLength(1);
    button('exit').click();
    button('exit')?.click?.();
    await vi.waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
  });

  it('Tab stays inside: checkbox, Keep running, Exit, and around', () => {
    open();
    const box = document.querySelector<HTMLInputElement>('#close-remember')!;
    key(button('hide'), 'Tab');
    expect(document.activeElement).toBe(button('exit'));
    key(button('exit'), 'Tab');
    expect(document.activeElement).toBe(box);
    key(box, 'Tab', true);
    expect(document.activeElement).toBe(button('exit'));
  });
});

describe('the preload exposes only these to the page', () => {
  afterEach(() => vi.resetModules());

  it('window.background: listens for the request and sends only "exit" or "hide"', async () => {
    const exposed: Record<string, Record<string, unknown>> = {};
    const send = vi.fn();
    const listeners: Record<string, (...a: unknown[]) => void> = {};
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: (k: string, v: Record<string, unknown>) => (exposed[k] = v) },
      ipcRenderer: { send, on: (ch: string, fn: (...a: unknown[]) => void) => (listeners[ch] = fn) },
    }));
    await import('../src/main/preload');
    expect(Object.keys(exposed).sort()).toEqual(['appearance', 'background', 'updates']);
    expect(Object.keys(exposed.background!).sort()).toEqual(['choose', 'onCloseRequest']);
    expect(Object.keys(exposed.updates!).sort()).toEqual(['checkNow', 'onReady', 'onState', 'restart']);
    const choose = exposed.background!.choose as (c: unknown) => void;
    for (const bad of ['quit', 'EXIT', '', null, 1, { toString: () => 'exit' }, ['exit']]) choose(bad);
    expect(send).not.toHaveBeenCalled();
    choose('exit');
    choose('hide');
    expect(send.mock.calls).toEqual([
      ['close-choice', 'exit'],
      ['close-choice', 'hide'],
    ]);
    const onRequest = vi.fn();
    (exposed.background!.onCloseRequest as (cb: (...a: unknown[]) => void) => void)(onRequest);
    listeners['close-request']!({}, 'payload from main is not passed on');
    expect(onRequest).toHaveBeenCalledWith();
  });
});

describe('Settings > Background', () => {
  const settings: Settings = {
    units: 'metric',
    timeFormat: '12h',
    windUnit: 'kmh',
    tempLabels: '3h',
    location: 'ask',
    appearance: 'classic',
    closeBehavior: 'ask',
    rainAlerts: false,
    widget: false,
    widgetSize: 'small',
    widgetOnTop: false,
    widgetBackground: 'wallpaper',
    widgetEffects: true,
  };
  let startup: { supported: boolean; enabled: boolean } | null = null;
  const bindings: SettingsBindings = {
    get: () => settings,
    setUnits: vi.fn(),
    setWindUnit: vi.fn(),
    setTimeFormat: vi.fn(),
    setTempLabels: vi.fn(),
    setLocation: vi.fn(),
    setAppearance: vi.fn(),
    glassSupported: () => true,
    locationStatus: () => 'status',
    now: () => '2026-11-10T10:00:00',
    setCloseBehavior: vi.fn((b: CloseBehavior) => void (settings.closeBehavior = b)),
    startup: () => startup,
    setStartup: vi.fn(),
    setRainAlerts: vi.fn((on: boolean) => void (settings.rainAlerts = on)),
    setWidget: vi.fn(),
    sendTestAlert: vi.fn(),
    onOpen: vi.fn(),
  };

  function mount(): { root: HTMLElement; open: () => void } {
    document.body.innerHTML =
      '<div id="settings" hidden><section id="settings-sheet"><button class="settings-close"></button><div id="settings-sections"></div></section></div><div class="titlebar"></div><div class="layout"></div><button id="settings-button"></button>';
    const panel = setupSettings(bindings);
    return { root: document.getElementById('settings-sections')!, open: panel.open };
  }

  it('comes right after Look, with three rows in order, and only titles and controls', () => {
    const { root } = mount();
    expect([...root.children].map((s) => s.id).slice(0, 2)).toEqual(['settings-look', 'settings-background']);
    const section = root.querySelector('#settings-background')!;
    expect(section.querySelector('h3')!.textContent).toBe('Background');
    expect([...section.querySelectorAll('.settings-row-label')].map((l) => l.textContent)).toEqual(['When I close the window', 'Start with Windows', 'Rain alerts']);
    expect([...section.querySelectorAll('[role="radiogroup"] button')].map((b) => b.textContent)).toEqual(['Ask', 'Keep running', 'Exit']);
    expect([...section.querySelectorAll('p')].filter((p) => !p.closest('[hidden]'))).toHaveLength(0);
    expect(section.querySelector('#settings-rain-alerts')!.getAttribute('role')).toBe('switch');
    expect(section.querySelector('label[for="settings-startup"]')!.textContent).toBe('Start with Windows');
    expect(section.querySelector('label[for="settings-rain-alerts"]')!.textContent).toBe('Rain alerts');
  });

  it('the close choice calls its setter and follows the setting', () => {
    const { root } = mount();
    const btn = (v: string) => root.querySelector<HTMLButtonElement>(`#settings-background [data-value="${v}"]`)!;
    expect(btn('ask').getAttribute('aria-checked')).toBe('true');
    btn('background').click();
    expect(bindings.setCloseBehavior).toHaveBeenCalledWith('background');
    syncSettingsControls();
    expect(btn('background').getAttribute('aria-checked')).toBe('true');
    settings.closeBehavior = 'ask';
  });

  it('Start with Windows: disabled (with its info) until the OS says it is supported; shows the OS state; re-read on open', () => {
    startup = null;
    const { root, open } = mount();
    const sw = root.querySelector<HTMLButtonElement>('#settings-startup')!;
    expect(sw.disabled).toBe(true);
    sw.click();
    expect(bindings.setStartup).not.toHaveBeenCalled();
    expect(root.querySelector('#startup-info')!.textContent).toContain(STARTUP_FACTS.lines[2]);
    open();
    expect(bindings.onOpen).toHaveBeenCalled();
    startup = { supported: true, enabled: true };
    syncSettingsControls();
    expect(sw.disabled).toBe(false);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click();
    expect(bindings.setStartup).toHaveBeenCalledWith(false);
  });

  it('Rain alerts: off by default, the switch and "Send a test" call their bindings, the info names the city rule', () => {
    const { root } = mount();
    const sw = root.querySelector<HTMLButtonElement>('#settings-rain-alerts')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    expect(bindings.setRainAlerts).toHaveBeenCalledWith(true);
    root.querySelector<HTMLButtonElement>('#rain-alert-test')!.click();
    expect(bindings.sendTestAlert).toHaveBeenCalledTimes(1);
    expect(root.querySelector('#rain-alert-info')!.textContent).toContain(RAIN_ALERT_FACTS.lines[0]);
    expect(root.querySelector('#rain-alert-info')!.textContent).toMatch(/Windows can block notifications/);
    settings.rainAlerts = false;
  });
});
