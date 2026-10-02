import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';

import { PrismaClient } from '../../src/generated/prisma/client';
import { seedDefaultAmenities } from '../../src/modules/amenities/default-amenities';
import { syncRbac } from '../../src/modules/rbac/rbac-sync';
import { seedDefaultPlan } from '../../src/modules/subscriptions/default-plan';
import { resolveTestEnv } from './test-env';

/** Creates (if needed), migrates and seeds the test database once per run. */
export default async function globalSetup(): Promise<void> {
  const env = resolveTestEnv();
  const url = new URL(env.DATABASE_URL!);
  const database = url.pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0)
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '')}"`);
  } finally {
    await client.end();
  }

  const repoRoot = resolve(__dirname, '../../../..');
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL! }),
  });
  try {
    await syncRbac(prisma);
    await seedDefaultAmenities(prisma);
    await seedDefaultPlan(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
