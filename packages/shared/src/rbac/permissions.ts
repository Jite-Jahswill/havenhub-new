/**
 * Canonical permission catalogue. The API seeds these into the `permissions`
 * table and enforces them; clients may read a user's permissions (from
 * `/auth/me`) only to tailor navigation — never as a security boundary.
 *
 * Keys follow `<resource>.<action>`. Add new permissions here, then run the
 * RBAC seed so they exist in the database.
 */
export const PERMISSIONS = {
  'users.view': 'View customer and agent accounts',
  'users.create': 'Create user accounts',
  'users.update': 'Edit user account details',
  'users.block': 'Suspend, block and reactivate accounts',
  'users.delete': 'Delete user accounts',

  'agents.view': 'View agent profiles and verification submissions',
  'agents.verify': 'Approve or reject agent verification',
  'agents.suspend': 'Suspend or block agents',

  'properties.view': 'View all properties, including unpublished',
  'properties.create': 'Create properties on behalf of agents',
  'properties.update': 'Edit any property',
  'properties.approve': 'Approve, reject and moderate properties',
  'properties.delete': 'Delete properties',
  'properties.feature': 'Feature properties',
  'amenities.manage': 'Create and manage the amenity catalogue',

  'bookings.view': 'View all bookings and their price breakdowns',
  'payments.view': 'View payments and transactions',
  'payments.refund': 'Review and process refunds',
  'payments.withdrawals': 'Review and process agent withdrawals',
  'payments.settings': 'Configure commission, VAT and platform fees',

  'subscriptions.view': 'View agent subscriptions, subscription payments and metrics',
  'subscriptions.manage': 'Cancel, suspend and reactivate agent subscriptions',
  'subscriptions.plans': 'Create and edit subscription plans, prices and limits',

  'blog.create': 'Create blog posts',
  'blog.edit': 'Edit blog posts',
  'blog.publish': 'Publish and unpublish blog posts',

  'seo.manage': 'Manage SEO settings',
  'settings.manage': 'Manage platform settings',
  'audit.view': 'View the audit log',
  'roles.manage': 'Create roles and assign them to administrators',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
