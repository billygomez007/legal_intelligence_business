'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Banknote,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  FileText,
  LayoutDashboard,
  StickyNote,
} from 'lucide-react';

const tabs = [
  { slug: 'overview', label: 'Overview', icon: LayoutDashboard },
  { slug: 'research', label: 'Research', icon: BookOpen },
  { slug: 'documents', label: 'Documents', icon: FileText },
  { slug: 'tasks', label: 'Tasks', icon: CheckSquare },
  { slug: 'appointments', label: 'Appointments', icon: CalendarDays },
  { slug: 'deadlines', label: 'Deadlines', icon: CalendarClock },
  { slug: 'notes', label: 'Notes', icon: StickyNote },
  { slug: 'activity', label: 'Activity', icon: Activity },
  { slug: 'billing', label: 'Client billing', icon: Banknote },
] as const;

export function MatterTabs({ matterId }: { matterId: string }) {
  const pathname = usePathname();

  return (
    <nav className="matter-tabs" aria-label="Matter workspace">
      {tabs.map(({ slug, label, icon: Icon }) => {
        const href = `/app/matters/${matterId}/${slug}`;
        const active = pathname === href;

        return (
          <Link
            key={slug}
            href={href}
            className="matter-tab"
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
