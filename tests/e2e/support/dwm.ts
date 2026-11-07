// Reads a window's DWM attributes from outside the app (PowerShell + dwmapi.dll), test-only:
// DWMWA_SYSTEMBACKDROP_TYPE (38) is what Electron's backgroundMaterial sets: 0 auto, 1 none, 2 mica, 3 acrylic, 4 tabbed.
import { execFileSync } from 'node:child_process';

export const BACKDROP = { auto: 0, none: 1, mica: 2, acrylic: 3, tabbed: 4 } as const;

export function systemBackdropType(hwnd: string): number {
  if (!/^\d+$/.test(hwnd)) throw new Error(`Bad window handle: ${hwnd}`);
  const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class Dwm { [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s); }'
$v = 0; $r = [Dwm]::DwmGetWindowAttribute([IntPtr]::new([Int64]${hwnd}), 38, [ref]$v, 4); if ($r -ne 0) { "error $r" } else { $v }`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(out)) throw new Error(`DwmGetWindowAttribute: ${out}`);
  return Number(out);
}

/** "Transparency effects" as this PC has it (1 = on), to know what the app should choose here. */
export function transparencyEffectsOn(): boolean {
  try {
    const out = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'EnableTransparency'], { encoding: 'utf8' });
    return !/REG_DWORD\s+0x0\b/.test(out);
  } catch {
    return true;
  }
}
