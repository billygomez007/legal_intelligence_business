import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

export interface QuickAction {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}

export function QuickActionCard({ action }: { action: QuickAction }) {
  return (
    <Link href={action.href} className="quick-card">
      <span className="quick-body">
        <span className="icon-tile">{action.icon}</span>
        <span className="quick-text">
          <span className="quick-title">{action.title}</span>
          <span className="quick-desc">{action.description}</span>
        </span>
      </span>
    </Link>
  );
}

export function QuickActions({ actions, href }: { actions: QuickAction[]; href: string }) {
  return (
    <section className="dash-quick" aria-labelledby="quick-title">
      <div className="panel-header">
        <h2 id="quick-title" className="panel-title">
          Quick actions
        </h2>
        <Link className="text-link subtle" href={href}>
          View all
          <span className="sr-only"> quick actions</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <div className="quick-grid">
        {actions.map((action) => (
          <QuickActionCard key={action.title} action={action} />
        ))}
      </div>
    </section>
  );
}
