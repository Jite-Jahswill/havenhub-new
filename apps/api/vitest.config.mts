import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits the decorator metadata NestJS dependency injection relies on.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'test/health.e2e-spec.ts'],
          environment: 'node',
        },
      },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.e2e-spec.ts'],
          exclude: ['test/health.e2e-spec.ts'],
          environment: 'node',
          globalSetup: ['test/setup/global-setup.ts'],
          setupFiles: ['test/setup/setup-env.ts'],
          // Files share one test database, so they run one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
