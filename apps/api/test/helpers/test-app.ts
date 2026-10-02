import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AUTH_COOKIES,
  AUTH_MODE_HEADER,
  CSRF_HEADER,
  type AuthTokens,
  type AuthUser,
} from '@havenhub/shared';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { expect } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ENV } from '../../src/config/config.module';
import { loadEnv, type Env } from '../../src/config/env';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { MAIL_TRANSPORT } from '../../src/infrastructure/mail/mail.types';
import { MemoryMailTransport } from '../../src/infrastructure/mail/transports/memory.transport';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { RedisService } from '../../src/infrastructure/redis/redis.service';
import { PasswordService } from '../../src/modules/auth/password.service';
import { setupApp } from '../../src/setup-app';

export const WEB_ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'a-very-long-password-1';

export interface TestContext {
  app: INestApplication;
  http: () => TestAgent;
  mail: MemoryMailTransport;
  prisma: PrismaClient;
  env: Env;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/** Boots the real AppModule against the test database, with in-memory email. */
export async function createTestContext(overrides: Partial<Env> = {}): Promise<TestContext> {
  const env: Env = { ...loadEnv(), ...overrides };
  const mail = new MemoryMailTransport();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(mail)
    .compile();

  const app = moduleRef.createNestApplication({ bodyParser: false, rawBody: true });
  setupApp(app, env);
  // Listen once: supertest otherwise opens/closes a listener per request on the
  // shared server, which breaks requests built before an awaited helper call.
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as import('node:http').Server;

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);

  return {
    app,
    http: () => request(server),
    mail,
    prisma,
    env,
    reset: async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE users, sessions, verification_tokens, user_roles, agent_profiles, payout_accounts, audit_logs, properties, property_images, property_videos, property_amenities, property_favorites, property_view_daily, pricing_configs, bookings, booking_line_items, payments, refunds, ledger_entries, agent_earnings CASCADE',
      );
      await redis.client.flushdb();
      mail.clear();
    },
    close: () => app.close(),
  };
}

// ── Account helpers ──────────────────────────────────────────────────────────

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now()}.${++counter}@example.com`;

export function tokenFromMail(ctx: TestContext, email: string, path: string): string {
  const message = ctx.mail.lastTo(email);
  expect(message, `expected an email to ${email}`).toBeDefined();
  const match = new RegExp(`${path}\\?token=([^\\s"&<]+)`).exec(message!.text);
  expect(match, `expected a ${path} link`).not.toBeNull();
  return decodeURIComponent(match![1]!);
}

export async function registerCustomer(
  ctx: TestContext,
  { verify = true, email = uniqueEmail('customer') } = {},
) {
  await ctx
    .http()
    .post('/api/v1/auth/register/customer')
    .send({ fullName: 'Chiamaka Okafor', email, password: PASSWORD })
    .expect(202);
  if (verify) await verifyEmail(ctx, email);
  return { email, password: PASSWORD };
}

export async function registerAgent(
  ctx: TestContext,
  { verify = true, email = uniqueEmail('agent') } = {},
) {
  await ctx
    .http()
    .post('/api/v1/auth/register/agent')
    .send({
      fullName: 'Tunde Bakare',
      email,
      password: PASSWORD,
      phone: '08031234567',
      sex: 'MALE',
      serviceTypes: ['LANDLORD'],
    })
    .expect(202);
  if (verify) await verifyEmail(ctx, email);
  return { email, password: PASSWORD };
}

export async function verifyEmail(ctx: TestContext, email: string) {
  const token = tokenFromMail(ctx, email, '/verify-email');
  await ctx.http().post('/api/v1/auth/verify-email').send({ token }).expect(200);
}

/** Creates an ADMIN account directly (public registration cannot) with the given roles. */
export async function createAdmin(ctx: TestContext, roleKeys: string[]) {
  const email = uniqueEmail('admin');
  const roles = await ctx.prisma.role.findMany({ where: { key: { in: roleKeys } } });
  const user = await ctx.prisma.user.create({
    data: {
      email,
      fullName: 'Admin User',
      passwordHash: await new PasswordService().hash(PASSWORD),
      accountType: 'ADMIN',
      emailVerifiedAt: new Date(),
      roles: { create: roles.map((role) => ({ roleId: role.id })) },
    },
  });
  return { id: user.id, email, password: PASSWORD };
}

/** Logs in as a token (mobile) client. */
export async function loginToken(ctx: TestContext, creds: { email: string; password: string }) {
  const res = await ctx
    .http()
    .post('/api/v1/auth/login')
    .set(AUTH_MODE_HEADER, 'token')
    .send(creds)
    .expect(200);
  return res.body.data as { user: AuthUser; tokens: AuthTokens };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Logs in as a web client and returns its cookies plus the CSRF header. */
export async function loginCookie(ctx: TestContext, creds: { email: string; password: string }) {
  const res = await ctx
    .http()
    .post('/api/v1/auth/login')
    .set('Origin', WEB_ORIGIN)
    .send(creds)
    .expect(200);
  const cookies = parseSetCookies(res.headers['set-cookie']);
  return {
    res,
    cookies,
    cookieHeader: Object.entries(cookies)
      .map(([name, c]) => `${name}=${c.value}`)
      .join('; '),
    csrf: { [CSRF_HEADER]: cookies[AUTH_COOKIES.CSRF]!.value, Origin: WEB_ORIGIN },
  };
}

export interface ParsedCookie {
  value: string;
  attributes: string[];
}

export function parseSetCookies(
  header: string | string[] | undefined,
): Record<string, ParsedCookie> {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  return Object.fromEntries(
    list.map((line) => {
      const [pair, ...attributes] = line.split(';').map((part) => part.trim());
      const eq = pair!.indexOf('=');
      return [pair!.slice(0, eq), { value: pair!.slice(eq + 1), attributes }];
    }),
  );
}

/** Asserts a response body contains none of the given secrets or sensitive markers. */
export function expectNoSecrets(body: unknown, secrets: string[] = []) {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/password/i);
  expect(json).not.toMatch(/\$argon2/);
  expect(json).not.toMatch(/ciphertext|fingerprint/i);
  for (const secret of secrets) expect(json).not.toContain(secret);
}

// ── Phase 2 helpers ──────────────────────────────────────────────────────────

type VerificationStatus =
  'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED' | 'BLOCKED';

/** Creates an agent directly in a given verification state and signs them in (token mode). */
export async function createAgent(
  ctx: TestContext,
  verificationStatus: VerificationStatus = 'VERIFIED',
) {
  const email = uniqueEmail('agent');
  const user = await ctx.prisma.user.create({
    data: {
      email,
      fullName: 'Kemi Adebayo',
      phone: '+2348031234567',
      passwordHash: await new PasswordService().hash(PASSWORD),
      accountType: 'AGENT',
      emailVerifiedAt: new Date(),
      agentProfile: {
        create: {
          sex: 'FEMALE',
          serviceTypes: ['LANDLORD'],
          businessName: `Adebayo Homes ${counter}`,
          verificationStatus,
          addressLine: '1 Private Street',
          city: 'Ikeja',
          lga: 'Ikeja',
          state: 'Lagos',
        },
      },
    },
    include: { agentProfile: true },
  });
  const { tokens } = await loginToken(ctx, { email, password: PASSWORD });
  return {
    userId: user.id,
    agentProfileId: user.agentProfile!.id,
    email,
    auth: bearer(tokens.accessToken),
  };
}

export type Agent = Awaited<ReturnType<typeof createAgent>>;

export async function testImage(
  width = 1200,
  height = 800,
  color = { r: 216, g: 34, b: 39 },
): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg({ quality: 80 })
    .withExif({ IFD0: { Copyright: 'secret-camera-owner' } })
    .toBuffer();
}

export const completeProperty = (overrides: Record<string, unknown> = {}) => ({
  title: 'Bright 3-bedroom apartment in Lekki',
  description: 'A bright, spacious apartment with a sea breeze, close to shops and the expressway.',
  propertyType: 'APARTMENT',
  listingType: 'RENT',
  pricingPeriod: 'YEARLY',
  addressLine: '12 Admiralty Way',
  city: 'Lekki',
  lga: 'Eti-Osa',
  state: 'Lagos',
  latitude: 6.4474,
  longitude: 3.4723,
  bedrooms: 3,
  bathrooms: 3,
  priceKobo: 450_000_000,
  cleaningOption: 'CUSTOMER_MUST_CLEAN',
  ...overrides,
});

export async function createDraft(
  ctx: TestContext,
  agent: Agent,
  overrides: Record<string, unknown> = {},
) {
  const res = await ctx
    .http()
    .post('/api/v1/agents/me/properties')
    .set(agent.auth)
    .send(completeProperty(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; slug: string; status: string };
}

/** Uploads an image and asserts the response status (201 by default). */
export async function uploadImage(
  ctx: TestContext,
  agent: Agent,
  propertyId: string,
  expectedStatus = 201,
  image?: Buffer,
) {
  const res = await ctx
    .http()
    .post(`/api/v1/agents/me/properties/${propertyId}/images`)
    .set(agent.auth)
    .attach('file', image ?? (await testImage()), {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(expectedStatus);
  return res;
}

/** Full happy path: draft → image → submit → approved by a property manager. */
export async function createPublished(
  ctx: TestContext,
  agent: Agent,
  overrides: Record<string, unknown> = {},
) {
  const draft = await createDraft(ctx, agent, overrides);
  await uploadImage(ctx, agent, draft.id);
  await ctx
    .http()
    .post(`/api/v1/agents/me/properties/${draft.id}/submit`)
    .set(agent.auth)
    .expect(200);
  const moderator = await moderatorAuth(ctx);
  await ctx
    .http()
    .patch(`/api/v1/admin/properties/${draft.id}/moderation`)
    .set(moderator)
    .send({ action: 'APPROVE' })
    .expect(200);
  return draft;
}

export async function moderatorAuth(ctx: TestContext) {
  const { tokens } = await loginToken(ctx, await createAdmin(ctx, ['property_manager']));
  return bearer(tokens.accessToken);
}
