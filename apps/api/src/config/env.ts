import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * Validated API environment. The process refuses to start if required
 * configuration is missing or malformed, rather than failing later at runtime.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Railway (and most PaaS) inject PORT; API_PORT is the local default.
    PORT: z.coerce.number().int().positive().optional(),
    API_PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /** Express "trust proxy" setting: hop count, or a comma-separated list of subnets. */
    TRUST_PROXY: z.string().default('loopback'),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    /** Public URL of the web app, used to build links in emails. */
    WEB_APP_URL: z.url().default('http://localhost:3000'),

    // ── Auth ──
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    REQUIRE_EMAIL_VERIFICATION: booleanFlag.default(true),
    /** Optional cookie Domain, e.g. ".havenhub.ng". Omit for host-only cookies. */
    COOKIE_DOMAIN: z.string().optional(),
    /** Defaults to true in production. Only disable for local HTTP development. */
    COOKIE_SECURE: booleanFlag.optional(),
    RATE_LIMIT_ENABLED: booleanFlag.default(true),

    /**
     * 32-byte key (base64) for encrypting sensitive fields at rest (NIN, bank
     * account numbers). Generate with: openssl rand -base64 32
     */
    FIELD_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'Must be 32 bytes encoded as base64 (openssl rand -base64 32)',
    }),

    /**
     * 32-byte key (base64) used to sign CSRF tokens. Independent of the
     * encryption key so either can be rotated alone.
     */
    AUTH_SECRET: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'Must be 32 bytes encoded as base64 (openssl rand -base64 32)',
    }),

    // ── Media storage ──
    /** `local` writes to disk (development only); `s3` targets any S3-compatible service. */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    /** Local driver: directory for uploaded files. */
    STORAGE_LOCAL_DIR: z.string().optional(),
    /**
     * Base URL clients use to fetch stored files. Local default is the API's
     * own `/api/media` route (served same-origin through the web app).
     * For S3 use the bucket's public/CDN URL.
     */
    STORAGE_PUBLIC_BASE_URL: z.string().default('/api/media'),
    STORAGE_ENDPOINT: z.url().optional(),
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_BUCKET: z.string().optional(),
    STORAGE_ACCESS_KEY: z.string().optional(),
    STORAGE_SECRET_KEY: z.string().optional(),
    STORAGE_FORCE_PATH_STYLE: booleanFlag.optional(),

    // ── Email ──
    MAIL_FROM: z.string().default('HavenHub <no-reply@havenhub.ng>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /** true = implicit TLS (port 465); false = STARTTLS when offered. */
    SMTP_SECURE: booleanFlag.optional(),

    // ── Bookings & payments ──
    /**
     * `paystack` for real payments; `test` is a simulated provider for local
     * development (refused in production).
     */
    PAYMENT_PROVIDER: z.enum(['paystack', 'test']).default('test'),
    /** Paystack secret key (sk_test_… / sk_live_…). Also verifies webhook signatures. */
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_BASE_URL: z.url().default('https://api.paystack.co'),
    /** How long an unpaid booking holds its dates. */
    BOOKING_HOLD_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(30),
    /** Interval of the expiry/completion sweep; 0 disables it (tests). */
    BOOKING_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    /**
     * Lease on each scheduled job's distributed lock (renewed while the job
     * runs). Bounds how long a crashed instance can hold a job back.
     */
    SCHEDULED_JOB_LOCK_TTL_SECONDS: z.coerce.number().int().min(5).max(3600).default(120),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'] as const) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'Required when STORAGE_DRIVER=s3' });
      }
    }
    if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'Local disk storage is for development only; use s3 in production',
      });
    }
    if (env.PAYMENT_PROVIDER === 'paystack' && !env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYSTACK_SECRET_KEY'],
        message: 'Required when PAYMENT_PROVIDER=paystack',
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'The simulated test provider cannot take payments in production; use paystack',
      });
    }
    if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP must be configured in production so verification emails are delivered',
      });
    }
  });

type ParsedEnv = z.infer<typeof envSchema>;

export type Env = ParsedEnv & {
  port: number;
  cookieSecure: boolean;
  trustProxy: boolean | number | string;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = result.data;
  return {
    ...env,
    port: env.PORT ?? env.API_PORT,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  };
}

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
