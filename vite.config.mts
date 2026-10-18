import { defineConfig } from 'vite';

// The renderer lives in src/renderer and is built into dist/renderer,
// which the Express server serves inside the packaged app.
export default defineConfig({
  root: 'src/renderer',
  base: '/',
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
