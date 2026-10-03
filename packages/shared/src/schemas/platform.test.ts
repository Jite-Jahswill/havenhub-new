import { describe, expect, it } from 'vitest';

import {
  analyticsQuerySchema,
  auditLogQuerySchema,
  createRoleSchema,
  updateModerationPolicySchema,
  updateSmtpSettingsSchema,
} from './platform.js';

const smtp = {
  host: 'smtp.example.com',
  port: 587,
  security: 'STARTTLS',
  username: 'mailer',
  password: 'secret-value',
  fromEmail: 'no-reply@example.com',
  fromName: 'HavenHub',
};

describe('platform schemas', () => {
  it('accept only real calendar dates, in order, within the analytics range limit', () => {
    expect(analyticsQuerySchema.safeParse({ from: '2026-02-28', to: '2026-03-01' }).success).toBe(
      true,
    );
    expect(analyticsQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ from: '2026-03-02', to: '2026-03-01' }).success).toBe(
      false,
    );
    expect(analyticsQuerySchema.safeParse({ from: '2025-01-01', to: '2026-01-01' }).success).toBe(
      true,
    );
    expect(analyticsQuerySchema.safeParse({ from: '2025-01-01', to: '2026-01-02' }).success).toBe(
      false,
    );
    expect(auditLogQuerySchema.safeParse({ from: '2026-13-01' }).success).toBe(false);
  });

  it('restrict roles to catalogued permissions, deduplicated', () => {
    const parsed = createRoleSchema.parse({
      name: '  Recruiter ',
      permissions: ['careers.applications', 'careers.applications'],
    });
    expect(parsed).toMatchObject({ name: 'Recruiter', permissions: ['careers.applications'] });
    expect(
      createRoleSchema.safeParse({ name: 'X Y', permissions: ['permissions.manage'] }).success,
    ).toBe(false);
    expect(createRoleSchema.safeParse({ name: 'X Y', permissions: [] }).success).toBe(false);
  });

  it('allow only encrypted SMTP on mail ports, with a write-only optional password', () => {
    expect(updateSmtpSettingsSchema.safeParse(smtp).success).toBe(true);
    const { password: _p, ...withoutPassword } = smtp;
    expect(updateSmtpSettingsSchema.parse(withoutPassword).password).toBeUndefined();
    expect(updateSmtpSettingsSchema.safeParse({ ...smtp, security: 'NONE' }).success).toBe(false);
    expect(updateSmtpSettingsSchema.safeParse({ ...smtp, port: 22 }).success).toBe(false);
    expect(updateSmtpSettingsSchema.safeParse({ ...smtp, host: 'smtp example' }).success).toBe(
      false,
    );
    expect(updateSmtpSettingsSchema.parse({ ...smtp, host: 'SMTP.Example.com' }).host).toBe(
      'smtp.example.com',
    );
  });

  it('accept only the known listing types in the moderation policy', () => {
    expect(updateModerationPolicySchema.safeParse({ PROPERTY: false }).success).toBe(true);
    expect(updateModerationPolicySchema.safeParse({}).success).toBe(false);
    expect(updateModerationPolicySchema.safeParse({ SALE: false }).success).toBe(false);
  });
});
