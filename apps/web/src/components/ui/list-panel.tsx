import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

/** A titled panel with an optional "View all" link. The building block of dashboard columns. */
export function ListPanel({
  id,
  title,
  href,
  linkLabel = 'View all',
  className = '',
  children,
}: {
  id: string;
  title: string;
  href?: string;
  linkLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel dash-panel ${className}`} aria-labelledby={id}>
      <div className="panel-header">
        <h2 id={id} className="panel-title">
          {title}
        </h2>
        {href && (
          <Link className="text-link subtle" href={href}>
            {linkLabel}
            <span className="sr-only"> {title.toLowerCase()}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
