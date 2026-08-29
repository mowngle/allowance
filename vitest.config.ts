import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    env: { DATABASE_URL: ':memory:' },
    setupFiles: ['./src/lib/server/test/setup.ts'],
    pool: 'forks',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      $lib: resolve('./src/lib'),
      // SvelteKit only generates this module during a build; stub it for tests.
      '$env/dynamic/private': resolve('./src/lib/server/test/env-dynamic-private.ts'),
    },
  },
});
