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
});
