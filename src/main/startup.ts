// "Start with Windows" (v1.9), kept free of Electron imports so it can be unit-tested; main.ts passes
// app.getLoginItemSettings / app.setLoginItemSettings. Nothing is stored: the OS login item is the truth,
// and it is read again every time the page asks (the user can change it in Windows Settings).

import type { StartupState } from '../server/routes/background';

/** The argument the login item starts the app with: open hidden in the tray, no window. */
export const HIDDEN_ARG = '--wd-hidden';

/** Only the installed app can register itself: a dev or unpackaged build would register electron.exe or a temp folder. */
export function startupSupported(env: { isPackaged: boolean; devUrl: string | undefined }): boolean {
  return env.isPackaged && !env.devUrl;
}

/** True when Windows started the app from its login item (a normal launch shows the window). */
export function launchedHidden(argv: readonly string[]): boolean {
  return argv.includes(HIDDEN_ARG);
}

/** The parts of Electron's app we use. */
export interface LoginItems {
  getLoginItemSettings(options: { args: string[] }): { openAtLogin: boolean };
  setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void;
}

export function createStartup(opts: { supported: boolean; items: LoginItems }) {
  const args = [HIDDEN_ARG];
  const get = (): StartupState => {
    if (!opts.supported) return { supported: false, enabled: false };
    try {
      return { supported: true, enabled: opts.items.getLoginItemSettings({ args }).openAtLogin };
    } catch {
      return { supported: true, enabled: false };
    }
  };
  return {
    get,
    set(enabled: boolean): StartupState {
      if (opts.supported) opts.items.setLoginItemSettings({ openAtLogin: enabled, args });
      return get(); // what the OS now says, not what was asked
    },
  };
}
