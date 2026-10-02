import { resolveTestEnv } from './test-env';

// Runs in every e2e worker before test files are imported.
Object.assign(process.env, resolveTestEnv());
