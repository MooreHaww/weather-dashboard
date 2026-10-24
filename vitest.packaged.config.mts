import { defineConfig } from 'vitest/config';

// Tests that need the packaged app (release/win-unpacked), e.g. auto-update. Run with `npm run test:update`.
export default defineConfig({
  test: {
    include: ['tests/packaged/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 90_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
