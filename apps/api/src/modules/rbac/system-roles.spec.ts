import { PERMISSION_KEYS, isPermission } from '@havenhub/shared';
import { describe, expect, it } from 'vitest';

import { SUPER_ADMIN_ROLE, SYSTEM_ROLES, resolveRolePermissions } from './system-roles';

describe('system roles', () => {
  it('have unique keys', () => {
    const keys = SYSTEM_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only reference catalogued permissions', () => {
    for (const role of SYSTEM_ROLES) {
      for (const permission of resolveRolePermissions(role)) {
        expect(isPermission(permission), `${role.key}: ${permission}`).toBe(true);
      }
    }
  });

  it('give only the super admin role management', () => {
    const holders = SYSTEM_ROLES.filter((r) => resolveRolePermissions(r).includes('roles.manage'));
    expect(holders.map((r) => r.key)).toEqual([SUPER_ADMIN_ROLE]);
  });

  it('give the super admin every permission', () => {
    const superAdmin = SYSTEM_ROLES.find((r) => r.key === SUPER_ADMIN_ROLE)!;
    expect(resolveRolePermissions(superAdmin)).toEqual(PERMISSION_KEYS);
  });

  it('grant applicant data and support replies explicitly, never through the general Admin role', () => {
    for (const permission of ['careers.applications', 'support.respond'] as const) {
      const admin = SYSTEM_ROLES.find((r) => r.key === 'admin')!;
      expect(resolveRolePermissions(admin)).not.toContain(permission);
    }
    const holders = (p: string) =>
      SYSTEM_ROLES.filter((r) => (resolveRolePermissions(r) as string[]).includes(p)).map(
        (r) => r.key,
      );
    expect(holders('careers.applications')).toEqual([SUPER_ADMIN_ROLE]);
    expect(holders('support.respond').sort()).toEqual([SUPER_ADMIN_ROLE, 'support_admin'].sort());
  });

  it('map the Phase 8 permissions explicitly', () => {
    const holders = (p: string) =>
      SYSTEM_ROLES.filter((r) => (resolveRolePermissions(r) as string[]).includes(p))
        .map((r) => r.key)
        .sort();
    // In-app announcements reach every user: admins and marketing only.
    expect(holders('notifications.send')).toEqual(
      ['admin', 'marketing_manager', SUPER_ADMIN_ROLE].sort(),
    );
    expect(holders('reviews.moderate')).toEqual(
      ['admin', 'property_manager', 'support_admin', SUPER_ADMIN_ROLE].sort(),
    );
    expect(holders('badges.manage')).toEqual(
      ['admin', 'content_manager', 'property_manager', SUPER_ADMIN_ROLE].sort(),
    );
    expect(holders('popups.manage')).toEqual(
      ['admin', 'content_manager', 'marketing_manager', SUPER_ADMIN_ROLE].sort(),
    );
    expect(holders('discounts.manage')).toEqual(
      ['admin', 'finance_admin', 'marketing_manager', SUPER_ADMIN_ROLE].sort(),
    );
    // SMTP credentials and maintenance mode: Super Admin only (not the general Admin).
    expect(holders('settings.smtp')).toEqual([SUPER_ADMIN_ROLE]);
    expect(holders('settings.maintenance')).toEqual([SUPER_ADMIN_ROLE]);
    expect(holders('settings.manage')).toEqual([SUPER_ADMIN_ROLE]);
    expect(holders('analytics.financial')).toEqual(
      ['admin', 'finance_admin', SUPER_ADMIN_ROLE].sort(),
    );
    expect(holders('analytics.view')).toEqual(
      ['admin', 'finance_admin', 'operations_manager', SUPER_ADMIN_ROLE].sort(),
    );
    expect(holders('audit.view')).toEqual(['admin', 'finance_admin', SUPER_ADMIN_ROLE].sort());
  });
});
