import { z } from 'zod';

import { AgentServiceType, IdDocumentType, Sex } from '../enums/agent.js';
import { ninField, nubanField } from './fields.js';

export const updateAgentProfileSchema = z
  .object({
    businessName: z.string().trim().max(160).nullable(),
    bio: z.string().trim().max(1500).nullable(),
    sex: z.enum(Sex),
    serviceTypes: z
      .array(z.enum(AgentServiceType))
      .min(1)
      .transform((types) => [...new Set(types)]),
    addressLine: z.string().trim().min(3).max(240),
    city: z.string().trim().min(2).max(100),
    lga: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(60),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateAgentProfileInput = z.input<typeof updateAgentProfileSchema>;

export const submitAgentIdentitySchema = z.object({
  nin: ninField,
  idDocumentType: z.enum(IdDocumentType),
});
export type SubmitAgentIdentityInput = z.input<typeof submitAgentIdentitySchema>;

export const upsertPayoutAccountSchema = z.object({
  bankName: z.string().trim().min(2).max(100),
  bankCode: z
    .string()
    .trim()
    .regex(/^\d{3,6}$/, 'Enter a valid bank code'),
  accountNumber: nubanField,
  accountName: z.string().trim().min(2).max(160),
});
export type UpsertPayoutAccountInput = z.input<typeof upsertPayoutAccountSchema>;
