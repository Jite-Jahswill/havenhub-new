import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';

import { PrismaClient } from '../generated/prisma/client';

/** Shared setup for operational scripts: load the root .env and open Prisma. */
export function scriptPrisma(): PrismaClient {
  loadDotenv({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
