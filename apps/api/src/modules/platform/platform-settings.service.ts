import { Injectable } from '@nestjs/common';
import {
  MAINTENANCE_RETRY_AFTER_SECONDS,
  MODERATED_LISTING_TYPES,
  POLICY_AREAS,
  publicPolicies,
  type ModeratedListingType,
  type PlatformPoliciesView,
  type PlatformSettingsView,
  type PlatformStatusView,
  type updateMaintenanceSchema,
  type updateModerationPolicySchema,
  type updatePlatformPoliciesSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import type { RequestMeta } from '../../common/http/request-meta';
import type { PlatformSettings, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { CmsCacheService } from '../cms/cms-cache.service';
import { SiteService } from '../cms/site.service';
import { MaintenanceStateService } from './maintenance';
import { POLICY_COLUMN } from './moderation-policy.service';
import { parsePolicies, PlatformPoliciesService } from './platform-policies.service';

type Tx = Prisma.TransactionClient;

/** Maintenance mode, the per-listing-type moderation policy and the platform policies. */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly maintenance: MaintenanceStateService,
    private readonly site: SiteService,
    private readonly policies: PlatformPoliciesService,
    private readonly cms: CmsCacheService,
  ) {}

  async view(): Promise<PlatformSettingsView> {
    return toView(await this.row());
  }

  /** Public: whether maintenance is on, with the CMS branding and contact details. */
  async status(): Promise<PlatformStatusView> {
    const [state, site, policies] = await Promise.all([
      this.maintenance.state(),
      this.site.publicSite(),
      this.policies.get(),
    ]);
    return {
      maintenance: { ...state, retryAfterSeconds: MAINTENANCE_RETRY_AFTER_SECONDS },
      site: {
        name: site.siteName,
        logo: site.logo,
        contactEmail: site.contact.email,
        contactPhone: site.contact.phone,
        contactAddress: site.contact.address,
      },
      policies: publicPolicies(policies),
    };
  }

  async updateMaintenance(
    actor: AuthContext,
    input: z.output<typeof updateMaintenanceSchema>,
    meta: RequestMeta,
  ): Promise<PlatformSettingsView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx);
      const updated = await tx.platformSettings.update({
        where: { id: 1 },
        data: {
          ...(input.enabled !== undefined ? { maintenanceEnabled: input.enabled } : {}),
          ...(input.message !== undefined ? { maintenanceMessage: input.message } : {}),
          ...(input.returnText !== undefined ? { maintenanceReturnText: input.returnText } : {}),
          maintenanceUpdatedAt: new Date(),
          updatedById: actor.user.id,
        },
      });
      const snapshot = (r: PlatformSettings) => ({
        enabled: r.maintenanceEnabled,
        message: r.maintenanceMessage,
        returnText: r.maintenanceReturnText,
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action:
            current.maintenanceEnabled === updated.maintenanceEnabled
              ? 'platform.maintenance.updated'
              : updated.maintenanceEnabled
                ? 'platform.maintenance.enabled'
                : 'platform.maintenance.disabled',
          resourceType: 'platform_settings',
          resourceId: '1',
          before: snapshot(current),
          after: snapshot(updated),
          meta,
        },
        tx,
      );
      return updated;
    });
    await this.maintenance.publish();
    return toView(row);
  }

  async updateModeration(
    actor: AuthContext,
    input: z.output<typeof updateModerationPolicySchema>,
    meta: RequestMeta,
  ): Promise<PlatformSettingsView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx);
      const data: Prisma.PlatformSettingsUncheckedUpdateInput = { updatedById: actor.user.id };
      for (const type of MODERATED_LISTING_TYPES) {
        const value = input[type];
        if (value !== undefined) data[POLICY_COLUMN[type]] = value;
      }
      const updated = await tx.platformSettings.update({ where: { id: 1 }, data });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'platform.moderation_policy.updated',
          resourceType: 'platform_settings',
          resourceId: '1',
          before: policy(current),
          after: policy(updated),
          meta,
        },
        tx,
      );
      return updated;
    });
    return toView(row);
  }

  async viewPolicies(): Promise<PlatformPoliciesView> {
    const row = await this.row();
    return {
      policies: parsePolicies(row.policies),
      updatedAt: row.policiesUpdatedAt?.toISOString() ?? null,
    };
  }

  /**
   * Merges the changed values into the stored document. Only the areas that
   * changed are recorded in the audit log, before and after.
   */
  async updatePolicies(
    actor: AuthContext,
    input: z.output<typeof updatePlatformPoliciesSchema>,
    meta: RequestMeta,
  ): Promise<PlatformPoliciesView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx);
      const before = parsePolicies(current.policies);
      const after = parsePolicies(current.policies);
      const changed: string[] = [];
      for (const area of POLICY_AREAS) {
        const patch = input[area];
        if (!patch) continue;
        const merged = { ...before[area], ...patch };
        if (JSON.stringify(merged) === JSON.stringify(before[area])) continue;
        (after as Record<string, unknown>)[area] = merged;
        changed.push(area);
      }
      if (changed.length === 0) return current;
      const updated = await tx.platformSettings.update({
        where: { id: 1 },
        data: {
          policies: after,
          policiesUpdatedAt: new Date(),
          updatedById: actor.user.id,
        },
      });
      const pick = (p: object) =>
        Object.fromEntries(
          changed.map((a) => [a, (p as Record<string, unknown>)[a]]),
        ) as Prisma.InputJsonObject;
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'platform.policies.updated',
          resourceType: 'platform_settings',
          resourceId: '1',
          before: pick(before),
          after: pick(after),
          meta,
        },
        tx,
      );
      return updated;
    });
    await this.policies.publish();
    // Cached public pages (homepage sections, sitemap) depend on the events policy.
    await this.cms.invalidate();
    return {
      policies: parsePolicies(row.policies),
      updatedAt: row.policiesUpdatedAt?.toISOString() ?? null,
    };
  }

  private async row(): Promise<PlatformSettings> {
    const existing = await this.prisma.platformSettings.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    return this.prisma.platformSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  }

  private async locked(tx: Tx): Promise<PlatformSettings> {
    await tx.$executeRaw`INSERT INTO platform_settings (id, updated_at) VALUES (1, now()) ON CONFLICT (id) DO NOTHING`;
    await tx.$queryRaw`SELECT id FROM platform_settings WHERE id = 1 FOR UPDATE`;
    return tx.platformSettings.findUniqueOrThrow({ where: { id: 1 } });
  }
}

const policy = (r: PlatformSettings) =>
  Object.fromEntries(MODERATED_LISTING_TYPES.map((t) => [t, r[POLICY_COLUMN[t]]])) as Record<
    ModeratedListingType,
    boolean
  >;

const toView = (r: PlatformSettings): PlatformSettingsView => ({
  maintenance: {
    enabled: r.maintenanceEnabled,
    message: r.maintenanceMessage,
    returnText: r.maintenanceReturnText,
    updatedAt: (r.maintenanceUpdatedAt ?? r.updatedAt).toISOString(),
  },
  moderation: policy(r),
});
