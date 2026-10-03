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

  'experiences.view': 'View all events, tours, hotels and cleaning services, including unpublished',
  'experiences.approve': 'Approve, reject and moderate events, tours, hotels and cleaning services',
  'vacation_zones.manage': 'Create, edit and publish vacation zones (destinations)',

  'bookings.view': 'View all bookings and their price breakdowns',
  'payments.view': 'View payments and transactions',
  'payments.refund': 'Review and process refunds',
  'payments.withdrawals': 'Review and process agent withdrawals',
  'payments.settings': 'Configure commission, VAT and platform fees',

  'subscriptions.view': 'View agent subscriptions, subscription payments and metrics',
  'subscriptions.manage': 'Cancel, suspend and reactivate agent subscriptions',
  'subscriptions.plans': 'Create and edit subscription plans, prices and limits',

  'conversations.view': 'Read customer–agent conversations for support (every view is audited)',
  'messages.moderate': 'Remove messages and close or reopen conversations',

  'blog.create': 'Create blog posts',
  'blog.edit': 'Edit blog posts, categories and tags',
  'blog.publish': 'Publish, schedule and unpublish blog posts',
  'blog.delete': 'Archive and permanently delete blog posts',

  'content.site': 'Edit site settings, homepage sections and testimonials',
  'content.pages': 'Create, edit and publish pages (about, contact, terms, privacy…)',
  'content.media': 'Upload and manage CMS images',
  'help.manage': 'Manage help centre categories, articles and FAQs',
  'careers.manage': 'Create, edit, publish and close job postings',
  'careers.applications': 'View job applicants, their CVs and update application status',
  'marketing.subscribers': 'View and manage newsletter subscribers',
  'marketing.campaigns': 'Create and edit email campaigns',
  'marketing.send': 'Schedule, send and cancel email campaigns',
  'support.respond': 'Answer support conversations from customers and agents',

  'seo.manage': 'Manage SEO settings',
  'settings.manage': 'Manage platform settings, including the moderation policy',
  'settings.smtp': 'Configure the outgoing email (SMTP) server and send test emails',
  'settings.maintenance': 'Switch maintenance mode on and off and edit its message',
  'analytics.view': 'View platform analytics (users, listings, bookings)',
  'analytics.financial': 'View financial analytics (revenue, refunds, commission, VAT)',
  'audit.view': 'View the audit log, including changes, IP addresses and devices',
  'roles.manage': 'Create roles and assign them to administrators',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
