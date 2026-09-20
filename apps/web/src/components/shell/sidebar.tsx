'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from '../brand/brand-mark';
import { routes } from '../../lib/routes';
import type { UserProfile } from '../../data/types';
import { isActive, primaryNavigation, secondaryNavigation, type NavItem } from './navigation';
import { UserMenu } from './user-menu';

function NavList({
  items,
  pathname,
  onNavigate,
}: {
  items: readonly NavItem[];
  pathname: string;
  onNavigate: (() => void) | undefined;
}) {
  return (
    <ul>
      {items.map((item) => {
        const active = isActive(item, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className="nav-item"
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                onNavigate?.();
              }}
            >
              <item.icon size={20} strokeWidth={1.6} aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The sidebar's contents. Rendered inside a fixed <aside> on desktop and inside the dialog drawer on
 * smaller screens, so both share one implementation and one active-state rule.
 */
export function Sidebar({
  profile,
  onNavigate,
}: {
  profile: UserProfile;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <div className="sidebar-inner">
      <div className="sidebar-brand">
        <BrandMark href={routes.app} />
      </div>
      <nav aria-label="Main navigation" className="sidebar-nav">
        <NavList items={primaryNavigation} pathname={pathname} onNavigate={onNavigate} />
        <hr className="nav-divider" />
        <NavList items={secondaryNavigation} pathname={pathname} onNavigate={onNavigate} />
      </nav>
      <div className="sidebar-foot">
        <UserMenu profile={profile} onNavigate={onNavigate} />
        <p className="brand-line">
          <span>Ghanaian Law.</span>
          <span>Deeper Insight.</span>
          <span>Greater Impact.</span>
        </p>
      </div>
    </div>
  );
}
