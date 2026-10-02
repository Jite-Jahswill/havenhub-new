import { describe, expect, it } from 'vitest';

import {
  adminUpdateAgentVerificationSchema,
  changePasswordSchema,
  emailField,
  loginSchema,
  nigerianPhoneField,
  ninField,
  nubanField,
  registerAgentSchema,
  registerCustomerSchema,
} from './index.js';

describe('field schemas', () => {
  it.each([
    '08031234567',
    '0803 123 4567',
    '+2348031234567',
    '2348031234567',
    '8031234567',
    '0803-123-4567',
  ])('normalises %s to E.164', (input) => {
    expect(nigerianPhoneField.parse(input)).toBe('+2348031234567');
  });

  it.each(['0603123456', '12345', '+44 7700 900123', '080312345678'])(
    'rejects phone %s',
    (input) => {
      expect(nigerianPhoneField.safeParse(input).success).toBe(false);
    },
  );

  it('normalises email addresses', () => {
    expect(emailField.parse('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(emailField.safeParse('not-an-email').success).toBe(false);
  });

  it('validates NIN and NUBAN lengths', () => {
    expect(ninField.safeParse('12345678901').success).toBe(true);
    expect(ninField.safeParse('1234567890').success).toBe(false);
    expect(ninField.safeParse('1234567890a').success).toBe(false);
    expect(nubanField.safeParse('0123456789').success).toBe(true);
    expect(nubanField.safeParse('012345678').success).toBe(false);
  });
});

describe('auth schemas', () => {
  it('strips fields the client must not control', () => {
    const parsed = registerCustomerSchema.parse({
      fullName: 'Ada Obi',
      email: 'ada@example.com',
      password: 'a-long-password',
      accountType: 'ADMIN',
      roles: ['super_admin'],
    });
    expect(parsed).not.toHaveProperty('accountType');
    expect(parsed).not.toHaveProperty('roles');
  });

  it('enforces the password length policy for new passwords only', () => {
    expect(
      registerCustomerSchema.safeParse({ fullName: 'Ada Obi', email: 'a@b.ng', password: 'short' })
        .success,
    ).toBe(false);
    // Existing passwords are not re-validated against policy at login.
    expect(loginSchema.safeParse({ email: 'a@b.ng', password: 'short' }).success).toBe(true);
  });

  it('requires at least one agent service and de-duplicates', () => {
    const base = {
      fullName: 'Tunde B',
      email: 't@b.ng',
      password: 'a-long-password',
      phone: '08031234567',
      sex: 'MALE',
    };
    expect(registerAgentSchema.safeParse({ ...base, serviceTypes: [] }).success).toBe(false);
    expect(
      registerAgentSchema.parse({ ...base, serviceTypes: ['LANDLORD', 'LANDLORD'] }).serviceTypes,
    ).toEqual(['LANDLORD']);
  });

  it('rejects reusing the current password', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'same-password-1',
        newPassword: 'same-password-1',
      }).success,
    ).toBe(false);
  });

  it('requires a note when rejecting an agent', () => {
    expect(adminUpdateAgentVerificationSchema.safeParse({ status: 'REJECTED' }).success).toBe(
      false,
    );
    expect(
      adminUpdateAgentVerificationSchema.safeParse({ status: 'REJECTED', note: 'Blurry ID' })
        .success,
    ).toBe(true);
    expect(adminUpdateAgentVerificationSchema.safeParse({ status: 'PENDING' }).success).toBe(false);
  });
});
