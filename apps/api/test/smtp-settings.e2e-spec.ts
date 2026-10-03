import type { SmtpSettingsView } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FieldEncryptionService } from '../src/infrastructure/crypto/field-encryption.service';
import {
  MailTransportResolver,
  SMTP_DNS_RESOLVER,
  SMTP_PASSWORD_PURPOSE,
} from '../src/infrastructure/mail/mail-transport.resolver';
import {
  SmtpConnector,
  type SmtpConnectionOptions,
} from '../src/infrastructure/mail/transports/smtp.transport';
import { adminAuth } from './helpers/booking-helpers';
import { createTestContext, type TestContext } from './helpers/test-app';

/** Records every SMTP connection and message instead of opening sockets. */
class FakeConnector {
  connections: SmtpConnectionOptions[] = [];
  sent: { options: SmtpConnectionOptions; to: string; from: unknown; subject: string }[] = [];
  failWith: string | null = null;

  connect(options: SmtpConnectionOptions) {
    this.connections.push(options);
    return {
      sendMail: (mail: { to: string; from: unknown; subject: string }) => {
        if (this.failWith) {
          const error = Object.assign(new Error(`535 bad login for ${options.auth?.pass}`), {
            code: this.failWith,
          });
          return Promise.reject(error);
        }
        this.sent.push({ options, to: mail.to, from: mail.from, subject: mail.subject });
        return Promise.resolve({});
      },
      close: () => undefined,
    };
  }

  reset() {
    this.connections = [];
    this.sent = [];
    this.failWith = null;
  }
}

/** host → addresses; anything unknown fails to resolve. */
const DNS: Record<string, string[]> = {
  'smtp.mailhost.test': ['203.0.114.10'],
  'smtp.other.test': ['198.51.101.20'],
  'internal.mailhost.test': ['10.0.0.5'],
  'metadata.mailhost.test': ['169.254.169.254'],
  'mixed.mailhost.test': ['203.0.114.11', '127.0.0.1'],
  'v6local.mailhost.test': ['::1'],
};
const fakeDns = (host: string) => {
  const addresses = DNS[host];
  if (!addresses) return Promise.reject(new Error('ENOTFOUND'));
  return Promise.resolve(
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
};

const SECRET = 'correct-horse-battery-staple-91';
const SMTP = '/api/v1/admin/settings/smtp';
const valid = {
  host: 'smtp.mailhost.test',
  port: 587,
  security: 'STARTTLS',
  username: 'mailer@havenhub.test',
  password: SECRET,
  fromEmail: 'no-reply@havenhub.test',
  fromName: 'HavenHub',
};

let ctx: TestContext;
let connector: FakeConnector;

beforeAll(async () => {
  connector = new FakeConnector();
  ctx = await createTestContext({}, [
    { provide: SmtpConnector, useValue: connector },
    { provide: SMTP_DNS_RESOLVER, useValue: fakeDns },
  ]);
});
beforeEach(async () => {
  await ctx.reset();
  connector.reset();
});
afterAll(() => ctx.close());

const smtpAdmin = () => adminAuth(ctx, ['super_admin']);

async function save(auth: Record<string, string>, body: Record<string, unknown> = valid) {
  const res = await ctx.http().put(SMTP).set(auth).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as SmtpSettingsView;
}

describe('SMTP settings: storage and exposure', () => {
  it('encrypts the password at rest and never returns or audits it', async () => {
    const admin = await smtpAdmin();
    const saved = await save(admin.auth);
    expect(saved).toMatchObject({
      source: 'DATABASE',
      database: { host: 'smtp.mailhost.test', username: 'mailer@havenhub.test', passwordSet: true },
    });
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    expect(JSON.stringify(saved)).not.toMatch(/ciphertext/i);

    const row = await ctx.prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.passwordCiphertext).not.toContain(SECRET);
    expect(row.passwordCiphertext).toMatch(/^v1\./);
    const cipher = ctx.app.get(FieldEncryptionService).forPurpose(SMTP_PASSWORD_PURPOSE);
    expect(cipher.decrypt(row.passwordCiphertext!)).toBe(SECRET);
    // Bound to its purpose: the general field key cannot decrypt it.
    expect(() => ctx.app.get(FieldEncryptionService).decrypt(row.passwordCiphertext!)).toThrow();

    const view = await ctx.http().get(SMTP).set(admin.auth).expect(200);
    expect(JSON.stringify(view.body)).not.toContain(SECRET);
    expect(JSON.stringify(view.body)).not.toContain(row.passwordCiphertext!);

    const audits = await ctx.prisma.auditLog.findMany({ where: { resourceType: 'smtp_settings' } });
    expect(audits.map((a) => a.action)).toEqual(['settings.smtp.configured']);
    const dump = JSON.stringify(audits);
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain(row.passwordCiphertext!);
    expect(audits[0]!.after).toMatchObject({ passwordSet: true, passwordChanged: true });
  });

  it('treats the password as write-only: omitted keeps it, null removes it, a new one replaces it', async () => {
    const admin = await smtpAdmin();
    await save(admin.auth);
    const first = (await ctx.prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } }))
      .passwordCiphertext;

    const { password: _omit, ...withoutPassword } = valid;
    await save(admin.auth, { ...withoutPassword, fromName: 'HavenHub Team' });
    const kept = await ctx.prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(kept.passwordCiphertext).toBe(first);
    expect(kept.fromName).toBe('HavenHub Team');
    expect(kept.version).toBe(2);

    await save(admin.auth, { ...valid, password: 'another-long-secret-22' });
    expect(
      (await ctx.prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } })).passwordCiphertext,
    ).not.toBe(first);

    // A username without a password is refused; no username means no password at all.
    const missing = await ctx
      .http()
      .put(SMTP)
      .set(admin.auth)
      .send({ ...withoutPassword, password: null });
    expect(missing.status).toBe(422);
    await save(admin.auth, { ...withoutPassword, username: null, password: null });
    const anonymous = await ctx.prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(anonymous.passwordCiphertext).toBeNull();
  });

  it('only settings.smtp may read, change, remove or test it (not the general Admin)', async () => {
    for (const role of ['admin', 'content_manager', 'marketing_manager', 'finance_admin']) {
      const auth = (await adminAuth(ctx, [role])).auth;
      await ctx.http().get(SMTP).set(auth).expect(403);
      await ctx.http().put(SMTP).set(auth).send(valid).expect(403);
      await ctx.http().delete(SMTP).set(auth).expect(403);
      await ctx.http().post(`${SMTP}/test`).set(auth).expect(403);
    }
    await ctx.http().get(SMTP).expect(401);
    expect(await ctx.prisma.smtpSettings.count()).toBe(0);
  });

  it('validates the input', async () => {
    const admin = await smtpAdmin();
    for (const bad of [
      { ...valid, port: 22 },
      { ...valid, port: 8080 },
      { ...valid, security: 'NONE' },
      { ...valid, host: 'not a host' },
      { ...valid, fromEmail: 'nope' },
      { ...valid, extra: true },
    ]) {
      await ctx.http().put(SMTP).set(admin.auth).send(bad).expect(422);
    }
  });
});

describe('SMTP settings: destinations (SSRF)', () => {
  it('refuses loopback, private, link-local and mixed answers, before saving and before sending', async () => {
    const admin = await smtpAdmin();
    for (const host of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'internal.mailhost.test',
      'metadata.mailhost.test',
      'mixed.mailhost.test',
      'v6local.mailhost.test',
      'unknown.mailhost.test',
    ]) {
      const res = await ctx
        .http()
        .put(SMTP)
        .set(admin.auth)
        .send({ ...valid, host });
      expect(res.status, host).toBe(422);
      expect(res.body.details.issues[0].path).toBe('host');
    }
    expect(await ctx.prisma.smtpSettings.count()).toBe(0);

    // A stored host that later resolves internally is refused at send time.
    await save(admin.auth);
    DNS['smtp.mailhost.test'] = ['10.9.9.9'];
    try {
      const res = await ctx.http().post(`${SMTP}/test`).set(admin.auth).expect(200);
      expect(res.body.data).toMatchObject({ delivered: false });
      expect(res.body.data.error).toMatch(/not allowed/);
      expect(connector.connections).toHaveLength(0);
    } finally {
      DNS['smtp.mailhost.test'] = ['203.0.114.10'];
    }
  });

  it('connects to the checked address with TLS verified against the host name', async () => {
    const admin = await smtpAdmin();
    await save(admin.auth);
    await ctx.http().post(`${SMTP}/test`).set(admin.auth).expect(200);
    expect(connector.connections[0]).toMatchObject({
      host: '203.0.114.10',
      servername: 'smtp.mailhost.test',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'mailer@havenhub.test', pass: SECRET },
    });
  });
});

describe('SMTP settings: test sends', () => {
  it('sends only to the signed-in admin, is audited, and never echoes server errors', async () => {
    const admin = await smtpAdmin();
    // Nothing configured (test env has no SMTP_HOST): a clear conflict.
    await ctx.http().post(`${SMTP}/test`).set(admin.auth).expect(409);

    await save(admin.auth);
    // Any recipient in the body is ignored.
    const res = await ctx
      .http()
      .post(`${SMTP}/test`)
      .set(admin.auth)
      .send({ to: 'victim@example.org' })
      .expect(200);
    expect(res.body.data).toEqual({ delivered: true, to: admin.email, error: null });
    expect(connector.sent.map((m) => m.to)).toEqual([admin.email]);
    expect(connector.sent[0]!.from).toEqual({
      name: 'HavenHub',
      address: 'no-reply@havenhub.test',
    });

    connector.failWith = 'EAUTH';
    const failed = await ctx.http().post(`${SMTP}/test`).set(admin.auth).expect(200);
    expect(failed.body.data).toMatchObject({
      delivered: false,
      error: 'The server rejected the username or password.',
    });
    expect(JSON.stringify(failed.body)).not.toContain(SECRET);

    const audits = await ctx.prisma.auditLog.findMany({
      where: { action: 'settings.smtp.test_sent' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.after)).toEqual([
      { source: 'DATABASE', delivered: true, errorCode: null },
      { source: 'DATABASE', delivered: false, errorCode: 'EAUTH' },
    ]);
    expect(JSON.stringify(audits)).not.toContain(SECRET);
  });

  it('is rate limited', async () => {
    const limited = await createTestContext({ RATE_LIMIT_ENABLED: true }, [
      { provide: SmtpConnector, useValue: connector },
      { provide: SMTP_DNS_RESOLVER, useValue: fakeDns },
    ]);
    try {
      await limited.reset();
      const admin = await adminAuth(limited, ['super_admin']);
      await limited.http().put(SMTP).set(admin.auth).send(valid).expect(200);
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        statuses.push((await limited.http().post(`${SMTP}/test`).set(admin.auth)).status);
      }
      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses.slice(5)).toEqual([429, 429]);
      expect(connector.sent).toHaveLength(5);
    } finally {
      await limited.reset();
      await limited.close();
    }
  });
});

describe('SMTP settings: resolution', () => {
  it('uses the environment as a fallback and database settings over it, on every instance', async () => {
    const envCtx = await createTestContext({ SMTP_HOST: 'smtp.env.test', SMTP_PORT: 2525 }, [
      { provide: SmtpConnector, useValue: connector },
      { provide: SMTP_DNS_RESOLVER, useValue: fakeDns },
    ]);
    try {
      const resolver = envCtx.app.get(MailTransportResolver);
      const send = async () => {
        const resolved = await resolver.resolve();
        await resolved.transport!.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' });
        return { source: resolved.source, host: connector.connections.at(-1)!.host };
      };

      // No database settings: environment fallback.
      expect(await send()).toEqual({ source: 'ENVIRONMENT', host: 'smtp.env.test' });
      const admin = await smtpAdmin();
      const view = await ctx.http().get(SMTP).set(admin.auth).expect(200);
      expect(view.body.data.source).toBe('NONE'); // this instance has no SMTP_HOST

      // Saved on the other instance: this instance switches on its next send.
      await save(admin.auth);
      expect(await send()).toEqual({ source: 'DATABASE', host: '203.0.114.10' });

      // Changed again: rebuilt from the new settings.
      await save(admin.auth, { ...valid, host: 'smtp.other.test', port: 465, security: 'TLS' });
      expect(await send()).toEqual({ source: 'DATABASE', host: '198.51.101.20' });
      expect(connector.connections.at(-1)).toMatchObject({ port: 465, secure: true });

      // Removed: back to the environment, and the removal is audited.
      await ctx.http().delete(SMTP).set(admin.auth).expect(200);
      expect(await send()).toEqual({ source: 'ENVIRONMENT', host: 'smtp.env.test' });
      expect(await ctx.prisma.auditLog.count({ where: { action: 'settings.smtp.removed' } })).toBe(
        1,
      );
      await ctx.http().delete(SMTP).set(admin.auth).expect(404);
    } finally {
      await envCtx.close();
    }
  });
});
