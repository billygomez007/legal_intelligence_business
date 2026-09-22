'use client';

import Link from 'next/link';

import { usePathname } from 'next/navigation';

import {
  Bell,
  Bot,
  BriefcaseBusiness,
  Cable,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  ContactRound,
  CreditCard,
  FileStack,
  FolderOpen,
  Gavel,
  LayoutDashboard,
  Library,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

interface NavigationItem {
  readonly href: string;

  readonly label: string;

  readonly icon: LucideIcon;

  readonly exact?: boolean;

  readonly also?: readonly string[];

  readonly badge?: string;
}

const primaryNavigation: readonly NavigationItem[] = [
  {
    href: '/dashboard',

    label: 'Dashboard',

    icon: LayoutDashboard,

    exact: true,
  },

  {
    href: '/access-law',

    label: 'Access the Law',

    icon: Gavel,
  },

  {
    href: '/search',

    label: 'Search',

    icon: Search,
  },

  {
    href: '/research',

    label: 'Research',

    icon: FolderOpen,
  },

  {
    href: '/matters',

    label: 'Matters',

    icon: BriefcaseBusiness,
  },

  {
    href: '/appointments',

    label: 'Appointments',

    icon: CalendarDays,
  },

  {
    href: '/calendar',

    label: 'Deadlines & Calendar',

    icon: CalendarClock,
  },

  {
    href: '/documents',

    label: 'Documents',

    icon: FileStack,
  },

  {
    href: '/library',

    label: 'Library',

    icon: Library,
  },

  {
    href: '/work-products',

    label: 'Work Products',

    icon: FileStack,
  },

  {
    href: '/approvals',

    label: 'Approvals',

    icon: CheckCheck,
  },

  {
    href: '/alerts',

    label: 'Alerts',

    icon: Bell,
  },
];

const secondaryNavigation: readonly NavigationItem[] = [
  {
    href: '/ai-employees',

    label: 'AI Employees',

    icon: Bot,

    badge: 'AI',
  },

  {
    href: '/clients',

    label: 'Clients',

    icon: ContactRound,
  },

  {
    href: '/organization',

    label: 'Organization',

    icon: Users,
  },

  {
    href: '/billing',

    label: 'Billing & Subscription',

    icon: CreditCard,
  },

  {
    href: '/integrations',

    label: 'Integrations',

    icon: Cable,
  },

  {
    href: '/settings',

    label: 'Settings',

    icon: Settings,
  },
];

function pathMatches(
  item: NavigationItem,

  pathname: string,
): boolean {
  if (item.exact === true) {
    return pathname === item.href;
  }

  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }

  return (
    item.also?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ?? false
  );
}

function NavList({
  items,
  pathname,
}: {
  readonly items: readonly NavigationItem[];

  readonly pathname: string;
}) {
  return (
    <ul className="premium-nav-list">
      {items.map((item) => {
        const selected = pathMatches(item, pathname);

        const Icon = item.icon;

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={selected ? 'premium-nav-item premium-nav-item-active' : 'premium-nav-item'}
              aria-current={selected ? 'page' : undefined}
            >
              <span className="premium-nav-icon">
                <Icon size={18} strokeWidth={1.65} aria-hidden="true" />
              </span>

              <span className="premium-nav-label">{item.label}</span>

              {item.badge && <span className="premium-nav-badge">{item.badge}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function WorkspaceNav() {
  const pathname = usePathname();

  return (
    <nav className="premium-sidebar-nav" aria-label="Main navigation">
      <div className="premium-nav-section">
        <div className="premium-nav-section-label">Workspace</div>

        <NavList items={primaryNavigation} pathname={pathname} />
      </div>

      <div className="premium-nav-divider" />

      <div className="premium-nav-section">
        <div className="premium-nav-section-label">Business</div>

        <NavList items={secondaryNavigation} pathname={pathname} />
      </div>
    </nav>
  );
}
