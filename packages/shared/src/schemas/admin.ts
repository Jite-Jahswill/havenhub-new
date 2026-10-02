import { z } from 'zod';

import { AccountType, UserStatus } from '../enums/account.js';
import { AgentVerificationStatus } from '../enums/agent.js';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminListUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  accountType: z.enum(AccountType).optional(),
  status: z.enum(UserStatus).optional(),
});
export type AdminListUsersQuery = z.input<typeof adminListUsersQuerySchema>;

export const adminListAgentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  verificationStatus: z.enum(AgentVerificationStatus).optional(),
});
export type AdminListAgentsQuery = z.input<typeof adminListAgentsQuerySchema>;

export const adminUpdateUserStatusSchema = z.object({
  status: z.enum(UserStatus),
  reason: z.string().trim().max(500).optional(),
});
export type AdminUpdateUserStatusInput = z.input<typeof adminUpdateUserStatusSchema>;

export const adminUpdateAgentVerificationSchema = z
  .object({
    status: z.enum([
      AgentVerificationStatus.UNDER_REVIEW,
      AgentVerificationStatus.VERIFIED,
      AgentVerificationStatus.REJECTED,
      AgentVerificationStatus.SUSPENDED,
      AgentVerificationStatus.BLOCKED,
    ]),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.status !== AgentVerificationStatus.REJECTED || Boolean(v.note), {
    path: ['note'],
    message: 'Explain why the verification was rejected',
  });
export type AdminUpdateAgentVerificationInput = z.input<typeof adminUpdateAgentVerificationSchema>;

export const adminSetUserRolesSchema = z.object({
  roleKeys: z
    .array(z.string().trim().min(2).max(60))
    .max(20)
    .transform((keys) => [...new Set(keys)]),
});
export type AdminSetUserRolesInput = z.input<typeof adminSetUserRolesSchema>;
