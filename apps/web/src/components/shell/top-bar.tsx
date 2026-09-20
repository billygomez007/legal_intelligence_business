import Link from 'next/link';
import { Bell } from 'lucide-react';
import { routes } from '../../lib/routes';
import type { UserProfile } from '../../data/types';
import { CommandSearch } from './command-search';
import { MobileNav } from './mobile-nav';

/** Compact utility header: drawer trigger (small screens), global search and alerts. */
export function TopBar({ profile }: { profile: UserProfile }) {
  return (
    <header className="topbar">
      <MobileNav profile={profile} />
      <div className="topbar-spacer" />
      <CommandSearch />
      <Link
        href={routes.alerts}
        className="icon-button notify"
        aria-label="Alerts and notifications"
      >
        <Bell size={18} aria-hidden="true" />
        <span className="notify-dot" aria-hidden="true" />
      </Link>
    </header>
  );
}
