import {
  Bell,
  FolderOpen,
  LayoutDashboard,
  Library,
  MessageSquareText,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { routes } from '../../lib/routes';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match only this exact path (the dashboard, which is a prefix of every other app route). */
  exact?: boolean;
  /** Extra path prefixes that keep this item highlighted, e.g. record detail pages. */
  also?: readonly string[];
}

export const primaryNavigation: readonly NavItem[] = [
  { href: routes.app, label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: routes.ask, label: 'Ask the Law', icon: MessageSquareText },
  {
    href: routes.search,
    label: 'Search',
    icon: Search,
    // Case, legislation and source pages are reached from search results.
    also: ['/app/cases', '/app/legislation', '/app/sources'],
  },
  { href: routes.research, label: 'Research', icon: FolderOpen },
  { href: routes.library, label: 'Library', icon: Library },
  { href: routes.alerts, label: 'Alerts', icon: Bell },
];

export const secondaryNavigation: readonly NavItem[] = [
  { href: routes.organization, label: 'Organization', icon: Users },
  { href: routes.settings, label: 'Settings', icon: Settings },
];

export const allNavigation: readonly NavItem[] = [...primaryNavigation, ...secondaryNavigation];

export function isActive(item: NavItem, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (item.exact) return path === item.href;
  return [item.href, ...(item.also ?? [])].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
