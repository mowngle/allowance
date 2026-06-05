import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    env: { DATABASE_URL: ':memory:' },
    setupFiles: ['./src/lib/server/test/setup.ts'],
    pool: 'forks',
  },
  resolve: {
    alias: { $lib: resolve('./src/lib') },
  },
});
