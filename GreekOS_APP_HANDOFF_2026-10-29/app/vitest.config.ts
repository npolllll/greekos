import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), 'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)) } },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 60000, hookTimeout: 120000, fileParallelism: false } },
    ],
  },
});
