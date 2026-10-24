import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The app version (the same package.json Electron's app.getVersion() reads), shown in Settings.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// The renderer lives in src/renderer and is built into dist/renderer,
// which the Express server serves inside the packaged app.
export default defineConfig({
  root: 'src/renderer',
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome130',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // In development the API runs separately (see src/server/index.ts).
    proxy: { '/api': 'http://127.0.0.1:5174' },
  },
});
