import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Unit tests for web-server logic and error screens (rendered to static HTML). */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
