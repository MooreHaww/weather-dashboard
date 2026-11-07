// Glass or solid (v1.6): decides whether the window gets Windows' acrylic material, kept free of
// Electron imports so it can be unit-tested. main.ts feeds it the system's state and applies the result.
//
// Glass needs Windows 11 22H2 (build 22621) or newer, "Transparency effects" on, and no reduced
// transparency, forced colours or high contrast. Anything else gets the solid 1.5.1 look. Only the
// main process decides; the page is told the result (receive-only) and has no way to ask for another.

export type AppearanceMode = 'glass' | 'solid';
export type AppearanceReason =
  | 'ok'
  | 'not-windows'
  | 'windows-too-old'
  | 'transparency-off'
  | 'reduced-transparency'
  | 'forced-colors'
  | 'high-contrast';

export interface AppearanceEnv {
  platform: string; // process.platform
  release: string; // os.release(), e.g. "10.0.22631"
  /** "Transparency effects" (HKCU ...\Themes\Personalize\EnableTransparency); null = could not be read. */
  transparencyEffects: boolean | null;
  reducedTransparency: boolean; // nativeTheme.prefersReducedTransparency
  forcedColors: boolean; // nativeTheme.inForcedColorsMode
  highContrast: boolean; // nativeTheme.shouldUseHighContrastColors
}

export interface AppearanceDecision {
  mode: AppearanceMode;
  reason: AppearanceReason;
}

/** Windows 11 22H2, the first build with DWMWA_SYSTEMBACKDROP_TYPE (what Electron's backgroundMaterial sets). */
export const GLASS_MIN_BUILD = 22621;
/** The material glass mode uses: acrylic blurs what is behind the window, live. */
export const GLASS_MATERIAL = 'acrylic';
/** Glass: the window itself is see-through so the material shows; the page draws the tint. */
export const GLASS_BACKGROUND = '#00000000';
/** Solid: the 1.5.1 window colour. */
export const SOLID_BACKGROUND = '#0e1729';
/** Main -> page, receive-only: the new mode after a system setting changed. */
export const APPEARANCE_CHANNEL = 'appearance';
/** The mode at window creation, passed to the preload in `webPreferences.additionalArguments`. */
export const APPEARANCE_ARG = '--wd-appearance=';

/** The Windows build number from os.release() ("10.0.22631" -> 22631), or null. */
export function windowsBuild(release: string): number | null {
  const m = /^\d+\.\d+\.(\d+)/.exec(release.trim());
  return m ? Number(m[1]) : null;
}

export function decideAppearance(env: AppearanceEnv): AppearanceDecision {
  const solid = (reason: AppearanceReason): AppearanceDecision => ({ mode: 'solid', reason });
  if (env.platform !== 'win32') return solid('not-windows');
  const build = windowsBuild(env.release);
  if (build === null || build < GLASS_MIN_BUILD) return solid('windows-too-old');
  if (env.forcedColors) return solid('forced-colors');
  if (env.highContrast) return solid('high-contrast');
  if (env.reducedTransparency) return solid('reduced-transparency');
  if (env.transparencyEffects === false) return solid('transparency-off');
  return { mode: 'glass', reason: 'ok' };
}

/**
 * Reads `reg.exe query` output for EnableTransparency: "    EnableTransparency    REG_DWORD    0x1".
 * Returns null when the value is missing or the output is not understood (then the setting counts as on,
 * which is Windows' default; nativeTheme.prefersReducedTransparency is checked as well).
 */
export function parseTransparencyQuery(stdout: string): boolean | null {
  const m = /EnableTransparency\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout);
  return m ? parseInt(m[1]!, 16) !== 0 : null;
}

export const TRANSPARENCY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';

type ExecFile = (
  file: string,
  args: string[],
  opts: { windowsHide: boolean; timeout: number },
  callback: (error: Error | null, stdout: string) => void,
) => unknown;

/** Ask reg.exe (local, no network) for "Transparency effects". Never throws; null when unknown. */
export function readTransparencyEffects(execFile: ExecFile, platform: string): Promise<boolean | null> {
  if (platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      execFile('reg.exe', ['query', TRANSPARENCY_KEY, '/v', 'EnableTransparency'], { windowsHide: true, timeout: 2000 }, (error, stdout) =>
        resolve(error ? null : parseTransparencyQuery(String(stdout))),
      );
    } catch {
      resolve(null);
    }
  });
}

export interface AppearanceWatcherOptions {
  /** The system's state now (the registry value is read by the caller, see readTransparencyEffects). */
  env: () => Promise<AppearanceEnv>;
  /** Called with each new decision (not with the first one, which the caller applies when it creates the window). */
  onChange: (decision: AppearanceDecision) => void;
  log?: (level: 'info' | 'warn', message: string) => void;
}

export interface AppearanceWatcher {
  current(): AppearanceDecision;
  /** Decide again (on a nativeTheme change or when the window gets focus); calls onChange only if the mode changed. */
  refresh(): Promise<void>;
}

/** Decide once now, then again on every refresh(). Concurrent refreshes are merged into one. */
export async function createAppearanceWatcher(opts: AppearanceWatcherOptions): Promise<AppearanceWatcher> {
  let decision = decideAppearance(await opts.env());
  opts.log?.('info', `Appearance: ${decision.mode} (${decision.reason})`);
  let running: Promise<void> | null = null;
  let again = false;

  const run = async (): Promise<void> => {
    do {
      again = false;
      let next: AppearanceDecision;
      try {
        next = decideAppearance(await opts.env());
      } catch {
        opts.log?.('warn', 'Appearance check failed');
        return;
      }
      if (next.mode !== decision.mode) {
        decision = next;
        opts.log?.('info', `Appearance: ${decision.mode} (${decision.reason})`);
        opts.onChange(decision);
      } else {
        decision = next; // same mode, maybe another reason
      }
    } while (again);
  };

  return {
    current: () => decision,
    refresh() {
      if (running) {
        again = true;
        return running;
      }
      running = run().finally(() => (running = null));
      return running;
    },
  };
}

/** The preload's reading of the creation-time argument: only the two known values count. */
export function parseAppearanceArg(argv: readonly string[]): AppearanceMode | null {
  const arg = argv.find((a) => a.startsWith(APPEARANCE_ARG));
  const value = arg?.slice(APPEARANCE_ARG.length);
  return value === 'glass' || value === 'solid' ? value : null;
}
