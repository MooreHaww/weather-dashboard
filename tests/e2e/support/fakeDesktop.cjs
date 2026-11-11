// Loaded into the app's main process by the v2.0 widget tests (NODE_OPTIONS=--require), before the app's own code runs.
// It replaces what the widget reads from this PC, so no test ever reads the real wallpaper or captures the real screen
// unless it asks for it:
// - reg.exe queries of the wallpaper keys (Control Panel\Desktop, ...\Explorer\Wallpapers, DesktopSpotlight, Colors):
//   answered from globalThis.__desk.reg; every other reg.exe query (Transparency effects) goes to the real reg.exe;
// - %APPDATA% for the main process: a temp folder whose Microsoft\Windows\Themes\TranscodedWallpaper is the fixture
//   picture (tests/fixtures/wallpaper.png). Electron's own paths are not affected (they don't come from the variable);
// - desktopCapturer.getSources: a flat colour (globalThis.__desk.capture.color) unless capture.mode is 'real'.
// The packaged exe ignores NODE_OPTIONS, so nothing that ships can load this.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('node:module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require('node:os');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');

const fakeAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-fake-appdata-'));
const themes = path.join(fakeAppData, 'Microsoft', 'Windows', 'Themes');
fs.mkdirSync(themes, { recursive: true });
const fixture = path.join(__dirname, '..', '..', 'fixtures', 'wallpaper.png');
fs.copyFileSync(fixture, path.join(themes, 'TranscodedWallpaper'));
process.env.APPDATA = fakeAppData;

const desk = (globalThis.__desk = {
  themes,
  reg: {
    'HKCU\\Control Panel\\Desktop': { WallPaper: fixture, WallpaperStyle: '10', TileWallpaper: '0', TranscodedImageCount: '0x1' },
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Wallpapers': { BackgroundType: '0x0' },
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\DesktopSpotlight\\Settings': null, // the key does not exist
    'HKCU\\Control Panel\\Colors': { Background: '0 0 0' },
  },
  regCalls: 0,
  capture: { mode: 'fake', color: [40, 160, 90] },
  captureCalls: 0,
});

const realExecFile = childProcess.execFile;
childProcess.execFile = function execFile(file, args, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  if (String(file).toLowerCase() === 'reg.exe' && Array.isArray(args) && args[0] === 'query' && args[1] in desk.reg) {
    desk.regCalls++;
    const values = desk.reg[args[1]];
    setImmediate(() => {
      if (!values) return cb(Object.assign(new Error('not found'), { code: 1 }), '', '');
      const lines = ['', args[1], ...Object.entries(values).map(([k, v]) => `    ${k}    ${/^0x/.test(v) ? 'REG_DWORD' : 'REG_SZ'}    ${v}`), ''];
      cb(null, lines.join('\r\n'), '');
    });
    return undefined;
  }
  return realExecFile.apply(this, arguments);
};

let patched = false;
function patch({ desktopCapturer, nativeImage, screen }) {
  const real = desktopCapturer.getSources.bind(desktopCapturer);
  desktopCapturer.getSources = async (opts) => {
    desk.captureCalls++;
    if (desk.capture.mode === 'real') return real(opts);
    const { width, height } = opts.thumbnailSize;
    const buf = Buffer.alloc(width * height * 4);
    const [r, g, b] = desk.capture.color;
    for (let i = 0; i < buf.length; i += 4) buf.set([b, g, r, 255], i); // BGRA
    return screen.getAllDisplays().map((d) => ({
      id: `screen:${d.id}:0`,
      name: 'Screen',
      display_id: String(d.id),
      thumbnail: nativeImage.createFromBitmap(buf, { width, height }),
      appIcon: null,
    }));
  };
}

const realRequire = Module.prototype.require;
Module.prototype.require = function require(id) {
  const result = realRequire.apply(this, arguments);
  if (!patched && id === 'electron' && result && typeof result === 'object' && result.desktopCapturer) {
    patched = true;
    patch(result);
  }
  return result;
};
