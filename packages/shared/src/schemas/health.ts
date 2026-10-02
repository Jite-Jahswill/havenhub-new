import { z } from 'zod';

export const dependencyStatusSchema = z.enum(['up', 'down']);

export const healthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number(),
  timestamp: z.iso.datetime(),
  checks: z.object({
    database: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;
