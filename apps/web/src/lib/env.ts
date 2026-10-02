import { z } from 'zod';

/**
 * Server-only configuration. The browser never talks to the API host
 * directly: requests go to this app's own `/api/*`, which Next.js forwards
 * to API_INTERNAL_URL. Auth cookies therefore stay first-party on the web
 * domain, whatever domain the API is deployed on.
 */
const serverEnvSchema = z.object({
  API_INTERNAL_URL: z.url().default('http://localhost:4000'),
  NEXT_PUBLIC_SITE_URL: z.url().default('http://localhost:3000'),
});

export const env = serverEnvSchema.parse({
  API_INTERNAL_URL: process.env.API_INTERNAL_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});
