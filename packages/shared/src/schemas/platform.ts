import { z } from 'zod';

import {
  ANALYTICS_MAX_RANGE_DAYS,
  MODERATED_LISTING_TYPES,
  SMTP_PORTS,
  SmtpSecurity,
} from '../enums/platform.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';
import { daysBetween } from '../utils/stay.js';
import { emailField } from './fields.js';
import { paginationQuerySchema } from './admin.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z
  .string()
  .regex(ISO_DATE, 'Use the format YYYY-MM-DD')
  // Round-trip: Date.parse would quietly roll 2026-02-30 over to 2 March.
  .refine((v) => {
    const date = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
  }, 'Enter a valid date');

const nonEmpty = (v: object) => Object.keys(v).length > 0;
const NOTHING = { message: 'Nothing to update' };

// ── RBAC ──

const permissionList = z
  .array(z.enum(PERMISSION_KEYS as [string, ...string[]]))
  .min(1, 'Choose at least one permission')
  .max(PERMISSION_KEYS.length)
  .transform((keys) => [...new Set(keys)]);

const roleName = z.string().trim().min(2, 'Enter a name').max(100);
const roleDescription = z
  .string()
  .trim()
  .max(500)
  .transform((v) => v || null)
  .nullable();

export const createRoleSchema = z
  .object({
    name: roleName,
    description: roleDescription.optional(),
    permissions: permissionList,
  })
  .strict();
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: roleName,
    description: roleDescription,
    permissions: permissionList,
  })
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

// ── Audit log ──

export const auditLogQuerySchema = paginationQuerySchema
  .extend({
    /** Actor id, or part of the actor's email address or name. */
    actor: z.string().trim().max(254).optional(),
    /** Exact action, or a prefix ending in "." (e.g. "property."). */
    action: z.string().trim().max(100).optional(),
    resourceType: z.string().trim().max(60).optional(),
    resourceId: z.string().trim().max(64).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: 'The end date must be on or after the start date',
  });
export type AuditLogQuery = z.input<typeof auditLogQuerySchema>;

// ── Analytics ──

/** Inclusive calendar dates in Nigerian time (WAT). Defaults: the last 30 days. */
export const analyticsQuerySchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: 'The end date must be on or after the start date',
  })
  .refine((q) => !q.from || !q.to || daysBetween(q.from, q.to) < ANALYTICS_MAX_RANGE_DAYS, {
    path: ['from'],
    message: `Choose a range of at most ${ANALYTICS_MAX_RANGE_DAYS} days`,
  });
export type AnalyticsQuery = z.input<typeof analyticsQuerySchema>;

// ── SMTP ──

/** A DNS name or an IP literal; private and reserved addresses are refused by the API. */
const smtpHost = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter the SMTP server')
  .max(253)
  .refine(
    (v) =>
      /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(
        v,
      ) ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(v) ||
      /^[0-9a-f:]+$/.test(v),
    'Enter a host name such as smtp.example.com',
  );

export const updateSmtpSettingsSchema = z
  .object({
    host: smtpHost,
    port: z.coerce
      .number()
      .int()
      .refine((p) => (SMTP_PORTS as readonly number[]).includes(p), {
        message: `Use one of the mail ports ${SMTP_PORTS.join(', ')}`,
      }),
    security: z.enum(SmtpSecurity),
    username: z
      .string()
      .trim()
      .max(254)
      .transform((v) => v || null)
      .nullable(),
    /**
     * Write-only. Omit to keep the stored password; send `null` to remove
     * it. It is never returned by the API.
     */
    password: z.string().min(1).max(512).nullable().optional(),
    fromEmail: emailField,
    fromName: z.string().trim().min(1, 'Enter a sender name').max(100),
  })
  .strict();
export type UpdateSmtpSettingsInput = z.input<typeof updateSmtpSettingsSchema>;

// ── Platform ──

export const updateMaintenanceSchema = z
  .object({
    enabled: z.boolean(),
    message: z
      .string()
      .trim()
      .max(500)
      .transform((v) => v || null)
      .nullable(),
    returnText: z
      .string()
      .trim()
      .max(200)
      .transform((v) => v || null)
      .nullable(),
  })
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);
export type UpdateMaintenanceInput = z.input<typeof updateMaintenanceSchema>;

/** `true` = publication of that listing type needs admin review. */
export const updateModerationPolicySchema = z
  .object(
    Object.fromEntries(MODERATED_LISTING_TYPES.map((t) => [t, z.boolean()])) as Record<
      (typeof MODERATED_LISTING_TYPES)[number],
      z.ZodBoolean
    >,
  )
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);
export type UpdateModerationPolicyInput = z.input<typeof updateModerationPolicySchema>;
