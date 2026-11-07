// Loaded into the app's main process by tests/e2e/glass.e2e.ts (NODE_OPTIONS=--require), before the app's own
// code runs: os.release() reports Windows 10 (build 19045), so the app must choose the solid 1.5.1 look.
// Test-only: the packaged exe ignores NODE_OPTIONS, so nothing that ships can be switched this way.
const os = process.getBuiltinModule('node:os'); // the same object the app's `import os` gets
os.release = () => '10.0.19045';
