import { z } from 'zod';

import { AgentServiceType, Sex } from '../enums/agent.js';
import {
  emailField,
  emailTokenField,
  fullNameField,
  newPasswordField,
  nigerianPhoneField,
  passwordField,
} from './fields.js';

export const registerCustomerSchema = z.object({
  fullName: fullNameField,
  email: emailField,
  phone: nigerianPhoneField.optional(),
  password: newPasswordField,
});
export type RegisterCustomerInput = z.input<typeof registerCustomerSchema>;

export const registerAgentSchema = z.object({
  fullName: fullNameField,
  email: emailField,
  phone: nigerianPhoneField,
  password: newPasswordField,
  sex: z.enum(Sex),
  serviceTypes: z
    .array(z.enum(AgentServiceType))
    .min(1, 'Choose at least one service you offer')
    .transform((types) => [...new Set(types)]),
  businessName: z.string().trim().max(160).optional(),
});
export type RegisterAgentInput = z.input<typeof registerAgentSchema>;

export const loginSchema = z.object({
  email: emailField,
  password: passwordField,
});
export type LoginInput = z.input<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  /** Token-mode clients send the refresh token in the body; web uses a cookie. */
  refreshToken: z.string().min(20).max(300).optional(),
});

export const verifyEmailSchema = z.object({ token: emailTokenField });

export const emailOnlySchema = z.object({ email: emailField });

export const resetPasswordSchema = z.object({
  token: emailTokenField,
  password: newPasswordField,
});
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: passwordField,
    newPassword: newPasswordField,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one',
  });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
