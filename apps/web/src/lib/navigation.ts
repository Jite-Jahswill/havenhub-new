import type { AccountType, AuthUser, Permission } from '@havenhub/shared';
import {
  AppWindow,
  Award,
  BarChart3,
  BedDouble,
  Bell,
  BellRing,
  BookOpen,
  Briefcase,
  CircleHelp,
  FileText,
  Images,
  Inbox,
  LayoutTemplate,
  Settings2,
  Building2,
  CalendarCheck,
  CalendarDays,
  CreditCard,
  Gauge,
  Heart,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Map,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Package,
  Palmtree,
  Percent,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Ticket,
  User,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export const DASHBOARD_PATH: Record<AccountType, string> = {
  CUSTOMER: '/account',
  AGENT: '/agent',
  ADMIN: '/admin',
};

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Set for modules that arrive in a later phase; shown with a "Soon" tag. */
  phase?: number;
  /** Shows a live unread count: chat messages or in-app notifications. */
  badge?: 'messages' | 'notifications';
  description?: string;
  /** Admin items are hidden when the admin lacks this permission. The API enforces it regardless. */
  permission?: Permission;
  /** Alternative to `permission`: shown when the admin holds any of these. */
  anyPermission?: Permission[];
  /** Optional section heading shown above this item in the sidebar. */
  group?: string;
}

export const CUSTOMER_NAV: NavItem[] = [
  { href: '/account', label: 'Profile', icon: User },
  { href: '/account/bookings', label: 'Bookings', icon: CalendarCheck },
  { href: '/account/favorites', label: 'Favourites', icon: Heart },
  { href: '/account/messages', label: 'Messages', icon: MessageSquare, badge: 'messages' },
  { href: '/account/payments', label: 'Payments', icon: CreditCard },
  { href: '/account/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
  { href: '/account/settings', label: 'Settings', icon: Settings },
];

export const AGENT_NAV: NavItem[] = [
  { href: '/agent', label: 'Overview', icon: LayoutDashboard },
  { href: '/agent/properties', label: 'Properties', icon: Building2 },
  { href: '/agent/bookings', label: 'Bookings', icon: CalendarCheck },
  { href: '/agent/experiences', label: 'Experiences', icon: Ticket },
  { href: '/agent/messages', label: 'Messages', icon: MessageSquare, badge: 'messages' },
  { href: '/agent/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
  { href: '/agent/promotions', label: 'Promotions', icon: Tag },
  { href: '/agent/earnings', label: 'Earnings', icon: Wallet },
  { href: '/agent/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/agent/subscription', label: 'Subscription', icon: Package },
  { href: '/agent/profile', label: 'Profile', icon: User },
  { href: '/agent/settings', label: 'Settings', icon: Settings },
];

/** Every permission that opens at least one card in the settings hub. */
export const SETTINGS_PERMISSIONS: Permission[] = [
  'settings.manage',
  'settings.smtp',
  'settings.maintenance',
  'payments.settings',
  'subscriptions.plans',
  'content.site',
  'seo.manage',
  'careers.manage',
  'help.manage',
];

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: Gauge, permission: 'users.view' },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics.view' },

  { href: '/admin/users', label: 'Users', icon: Users, permission: 'users.view', group: 'People' },
  { href: '/admin/agents', label: 'Agents', icon: UserCheck, permission: 'agents.view' },

  {
    href: '/admin/properties',
    label: 'Properties',
    icon: Building2,
    permission: 'properties.view',
    group: 'Marketplace',
  },
  {
    href: '/admin/bookings',
    label: 'Bookings',
    icon: CalendarCheck,
    permission: 'bookings.view',
  },
  { href: '/admin/events', label: 'Events', icon: Ticket, permission: 'experiences.view' },
  { href: '/admin/hotels', label: 'Hotels', icon: BedDouble, permission: 'experiences.view' },
  { href: '/admin/tours', label: 'Tours', icon: Map, permission: 'experiences.view' },
  {
    href: '/admin/cleaning',
    label: 'Cleaning',
    icon: Sparkles,
    permission: 'experiences.view',
  },
  {
    href: '/admin/destinations',
    label: 'Destinations',
    icon: Palmtree,
    permission: 'vacation_zones.manage',
  },
  { href: '/admin/reviews', label: 'Reviews', icon: Star, permission: 'reviews.moderate' },
  { href: '/admin/badges', label: 'Badges', icon: Award, permission: 'badges.manage' },
  {
    href: '/admin/amenities',
    label: 'Amenities',
    icon: ListChecks,
    permission: 'amenities.manage',
  },

  {
    href: '/admin/payments',
    label: 'Payments',
    icon: CreditCard,
    permission: 'payments.view',
    group: 'Finance',
  },
  {
    href: '/admin/subscriptions',
    label: 'Subscriptions',
    icon: Package,
    permission: 'subscriptions.view',
  },
  { href: '/admin/plans', label: 'Plans', icon: CalendarDays, permission: 'subscriptions.view' },
  {
    href: '/admin/discounts',
    label: 'Discounts',
    icon: Percent,
    permission: 'discounts.manage',
  },

  {
    href: '/admin/content',
    label: 'Site settings',
    icon: Settings2,
    permission: 'content.site',
    group: 'Content',
  },
  { href: '/admin/homepage', label: 'Homepage', icon: LayoutTemplate, permission: 'content.site' },
  { href: '/admin/pages', label: 'Pages', icon: FileText, permission: 'content.pages' },
  { href: '/admin/blog', label: 'Blog', icon: BookOpen, permission: 'blog.edit' },
  { href: '/admin/help', label: 'Help centre', icon: CircleHelp, permission: 'help.manage' },
  { href: '/admin/careers', label: 'Careers', icon: Briefcase, permission: 'careers.manage' },
  {
    href: '/admin/careers/applications',
    label: 'Applications',
    icon: Inbox,
    permission: 'careers.applications',
  },
  { href: '/admin/media', label: 'Media', icon: Images, permission: 'content.media' },
  { href: '/admin/seo', label: 'SEO', icon: Search, permission: 'seo.manage' },
  {
    href: '/admin/email-marketing',
    label: 'Email Marketing',
    icon: Megaphone,
    permission: 'marketing.campaigns',
  },
  {
    href: '/admin/popups',
    label: 'Pop-ups',
    icon: AppWindow,
    permission: 'popups.manage',
  },
  {
    href: '/admin/announcements',
    label: 'Announcements',
    icon: BellRing,
    permission: 'notifications.send',
  },

  {
    href: '/admin/conversations',
    label: 'Conversations',
    icon: MessagesSquare,
    permission: 'conversations.view',
    group: 'Platform',
  },
  { href: '/admin/support', label: 'Support', icon: LifeBuoy, permission: 'support.respond' },
  {
    href: '/admin/messages',
    label: 'Messages',
    icon: MessageSquare,
    permission: 'support.respond',
    badge: 'messages',
  },
  {
    href: '/admin/settings',
    label: 'Settings',
    icon: Settings,
    anyPermission: SETTINGS_PERMISSIONS,
  },
  { href: '/admin/rbac', label: 'Roles', icon: KeyRound, permission: 'roles.manage' },
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: ShieldCheck, permission: 'audit.view' },
];

export const NAV_BY_TYPE: Record<AccountType, NavItem[]> = {
  CUSTOMER: CUSTOMER_NAV,
  AGENT: AGENT_NAV,
  ADMIN: ADMIN_NAV,
};

export function visibleNav(user: AuthUser): NavItem[] {
  return NAV_BY_TYPE[user.accountType].filter(
    (item) =>
      (!item.permission || user.permissions.includes(item.permission)) &&
      (!item.anyPermission || item.anyPermission.some((p) => user.permissions.includes(p))),
  );
}

export function findPlaceholder(items: NavItem[], href: string): NavItem | undefined {
  return items.find((item) => item.href === href && item.phase !== undefined);
}

/** Only same-site relative paths are accepted after login (no open redirects). */
export function safeNextPath(next: string | undefined | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return null;
  return next;
}
