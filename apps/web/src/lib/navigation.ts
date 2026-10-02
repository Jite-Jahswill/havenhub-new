import type { AccountType, AuthUser, Permission } from '@havenhub/shared';
import {
  BarChart3,
  BedDouble,
  Bell,
  BookOpen,
  Briefcase,
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
  /** Shows the live unread-message count. */
  unreadBadge?: boolean;
  description?: string;
  /** Admin items are hidden when the admin lacks this permission. The API enforces it regardless. */
  permission?: Permission;
  /** Optional section heading shown above this item in the sidebar. */
  group?: string;
}

export const CUSTOMER_NAV: NavItem[] = [
  { href: '/account', label: 'Profile', icon: User },
  { href: '/account/bookings', label: 'Bookings', icon: CalendarCheck },
  { href: '/account/favorites', label: 'Favourites', icon: Heart },
  { href: '/account/messages', label: 'Messages', icon: MessageSquare, unreadBadge: true },
  { href: '/account/payments', label: 'Payments', icon: CreditCard },
  {
    href: '/account/notifications',
    label: 'Notifications',
    icon: Bell,
    phase: 5,
    description: 'Booking updates and messages in one place.',
  },
  { href: '/account/settings', label: 'Settings', icon: Settings },
];

export const AGENT_NAV: NavItem[] = [
  { href: '/agent', label: 'Overview', icon: LayoutDashboard },
  { href: '/agent/properties', label: 'Properties', icon: Building2 },
  { href: '/agent/bookings', label: 'Bookings', icon: CalendarCheck },
  { href: '/agent/experiences', label: 'Experiences', icon: Ticket },
  { href: '/agent/messages', label: 'Messages', icon: MessageSquare, unreadBadge: true },
  { href: '/agent/earnings', label: 'Earnings', icon: Wallet },
  {
    href: '/agent/analytics',
    label: 'Analytics',
    icon: BarChart3,
    phase: 8,
    description: 'Views, bookings, conversion and revenue.',
  },
  { href: '/agent/subscription', label: 'Subscription', icon: Package },
  { href: '/agent/profile', label: 'Profile', icon: User },
  { href: '/agent/settings', label: 'Settings', icon: Settings },
];

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: Gauge, permission: 'users.view' },

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
  {
    href: '/admin/reviews',
    label: 'Reviews',
    icon: Star,
    phase: 3,
    description: 'Reviews are tied to completed bookings, which arrive with payments.',
  },
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
  { href: '/admin/discounts', label: 'Discounts', icon: Percent, phase: 3 },

  {
    href: '/admin/blog',
    label: 'Blog',
    icon: BookOpen,
    phase: 7,
    permission: 'blog.edit',
    group: 'Content',
  },
  { href: '/admin/seo', label: 'SEO', icon: Search, phase: 7, permission: 'seo.manage' },
  { href: '/admin/email-marketing', label: 'Email Marketing', icon: Megaphone, phase: 7 },
  { href: '/admin/careers', label: 'Careers', icon: Briefcase, phase: 7 },

  {
    href: '/admin/conversations',
    label: 'Conversations',
    icon: MessagesSquare,
    permission: 'conversations.view',
    group: 'Platform',
  },
  { href: '/admin/support', label: 'Support', icon: LifeBuoy, phase: 5 },
  {
    href: '/admin/settings',
    label: 'Settings',
    icon: Settings,
    phase: 8,
    permission: 'settings.manage',
  },
  { href: '/admin/rbac', label: 'RBAC', icon: KeyRound, phase: 8, permission: 'roles.manage' },
  {
    href: '/admin/audit-logs',
    label: 'Audit Logs',
    icon: ShieldCheck,
    phase: 8,
    permission: 'audit.view',
  },
];

export const NAV_BY_TYPE: Record<AccountType, NavItem[]> = {
  CUSTOMER: CUSTOMER_NAV,
  AGENT: AGENT_NAV,
  ADMIN: ADMIN_NAV,
};

export function visibleNav(user: AuthUser): NavItem[] {
  return NAV_BY_TYPE[user.accountType].filter(
    (item) => !item.permission || user.permissions.includes(item.permission),
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
