import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { previewLabel } from '../../content/marketing';
import { routes } from '../../lib/routes';
import { DemoBadge } from '../legal/badges';

/**
 * Honest stand-in for routes that exist in the navigation but not yet as features (sign-in, get
 * started). It says so plainly and offers the one thing that does work: the demonstration workspace.
 */
export function PlaceholderPage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="m-standalone" aria-labelledby="placeholder-title">
      <DemoBadge label={previewLabel} />
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="placeholder-title">{title}</h1>
      <div className="m-prose">{children}</div>
      <div className="m-hero-actions">
        <Link className="button" href={routes.app}>
          Open the demonstration workspace
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link className="button secondary" href={routes.home}>
          Back to LexGhana
        </Link>
      </div>
    </section>
  );
}
