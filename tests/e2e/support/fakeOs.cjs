// Loaded into the app's main process by the v1.9 tests (NODE_OPTIONS=--require), before the app's own code runs.
// It replaces the two things the tests must never touch on this PC:
// - the Windows login item (app.getLoginItemSettings / setLoginItemSettings): kept in memory only;
// - Windows notifications (Notification.prototype.show): recorded, never shown.
// The packaged exe ignores NODE_OPTIONS, so nothing that ships can load this.
//
// The test reads and sets it from the main-process inspector through `globalThis.__os`:
//   loginItem: { openAtLogin, args }   setCalls: every setLoginItemSettings call   notifications: [{ title, body }]

// At --require time, 'electron' is still the npm package (a path string). Patch Electron's API the first time the
// app's own code requires it, before any of the app's code runs with it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('node:module');

const os = (globalThis.__os = { loginItem: { openAtLogin: false, args: [] }, setCalls: [], notifications: [] });
let patched = false;

function patch({ app, Notification }) {
  app.getLoginItemSettings = () => ({ openAtLogin: os.loginItem.openAtLogin, executableWillLaunchAtLogin: os.loginItem.openAtLogin });
  app.setLoginItemSettings = (settings) => {
    os.setCalls.push(settings);
    os.loginItem = { openAtLogin: Boolean(settings.openAtLogin), args: settings.args ?? [] };
  };
  Notification.isSupported = () => true;
  Notification.prototype.show = function show() {
    os.notifications.push({ title: this.title, body: this.body });
  };
}

const realRequire = Module.prototype.require;
Module.prototype.require = function require(id) {
  const result = realRequire.apply(this, arguments);
  if (!patched && id === 'electron' && result && typeof result === 'object' && result.app) {
    patched = true;
    patch(result);
  }
  return result;
};
