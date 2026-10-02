import { PERMISSION_KEYS, type Permission } from '@havenhub/shared';

export const SUPER_ADMIN_ROLE = 'super_admin';

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  /** `'*'` = every permission in the catalogue, including future ones. */
  permissions: Permission[] | '*';
}

/**
 * Built-in administrator roles. The seed keeps the database in sync with
 * these definitions; custom roles created later by admins are not touched.
 */
export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: SUPER_ADMIN_ROLE,
    name: 'Super Admin',
    description: 'Unrestricted access, including role management.',
    permissions: '*',
  },
  {
    key: 'admin',
    name: 'Admin',
    description:
      'Day-to-day platform administration without role, settings, commission/VAT, plan pricing or private conversation access.',
    permissions: PERMISSION_KEYS.filter(
      (p) =>
        ![
          'roles.manage',
          'settings.manage',
          'payments.settings',
          'subscriptions.plans',
          // Reading private conversations is limited to support roles.
          'conversations.view',
          'messages.moderate',
        ].includes(p),
    ),
  },
  {
    key: 'finance_admin',
    name: 'Finance Admin',
    description: 'Payments, refunds, agent withdrawals and subscription plans.',
    permissions: [
      'bookings.view',
      'payments.view',
      'payments.refund',
      'payments.withdrawals',
      'payments.settings',
      'subscriptions.view',
      'subscriptions.manage',
      'subscriptions.plans',
      'users.view',
      'agents.view',
      'audit.view',
    ],
  },
  {
    key: 'property_manager',
    name: 'Property Manager',
    description: 'Property moderation and featuring.',
    permissions: [
      'properties.view',
      'properties.create',
      'properties.update',
      'properties.approve',
      'properties.delete',
      'properties.feature',
      'amenities.manage',
      'experiences.view',
      'experiences.approve',
      'vacation_zones.manage',
      'agents.view',
      'users.view',
    ],
  },
  {
    key: 'support_admin',
    name: 'Support Admin',
    description: 'Customer and agent support.',
    permissions: [
      'users.view',
      'users.update',
      'users.block',
      'agents.view',
      'bookings.view',
      'subscriptions.view',
      'conversations.view',
      'messages.moderate',
    ],
  },
  {
    key: 'content_manager',
    name: 'Content Manager',
    description: 'Blog, destination and content publishing.',
    permissions: ['blog.create', 'blog.edit', 'blog.publish', 'vacation_zones.manage'],
  },
  {
    key: 'marketing_manager',
    name: 'Marketing Manager',
    description: 'Marketing content and campaigns.',
    permissions: ['blog.create', 'blog.edit', 'users.view'],
  },
  {
    key: 'seo_manager',
    name: 'SEO Manager',
    description: 'Search engine optimisation.',
    permissions: ['seo.manage', 'blog.edit'],
  },
  {
    key: 'operations_manager',
    name: 'Operations Manager',
    description: 'Agent verification and listing operations.',
    permissions: [
      'users.view',
      'agents.view',
      'agents.verify',
      'agents.suspend',
      'properties.view',
      'properties.approve',
      'experiences.view',
      'experiences.approve',
      'bookings.view',
    ],
  },
];

export const resolveRolePermissions = (role: SystemRoleDefinition): Permission[] =>
  role.permissions === '*' ? [...PERMISSION_KEYS] : role.permissions;
