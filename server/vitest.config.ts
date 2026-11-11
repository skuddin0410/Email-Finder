import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 15000 },
  coverage: { provider: 'v8', include: ['src/engine/**'], thresholds: { lines: 90, functions: 90, statements: 90 } },
} as never);
