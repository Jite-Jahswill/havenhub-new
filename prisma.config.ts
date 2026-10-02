import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // Read lazily so `prisma generate` (which needs no database) works without
  // DATABASE_URL — e.g. during install or Vercel builds. Commands that talk
  // to the database fail with a clear error if it is missing.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
