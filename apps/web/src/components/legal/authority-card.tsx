import Link from 'next/link';
import { BookOpen, Scale } from 'lucide-react';
import type { LegalAuthority } from '../../data/types';
import { formatShortDate } from '../../lib/format';
import { routes } from '../../lib/routes';
import { RightsBadge, VerificationBadge } from './badges';

export function authorityHref(authority: LegalAuthority) {
  return authority.kind === 'case' ? routes.case(authority.id) : routes.legislation(authority.id);
}

/**
 * A dense, scannable row for any authority: title, citation/identifier, court or source, date,
 * excerpt and verification state. Used by search results, saved lists and related-authority lists.
 */
export function AuthorityCard({
  authority,
  passageCount,
}: {
  authority: LegalAuthority;
  /** Number of source passages that matched a search, when known. */
  passageCount?: number;
}) {
  const Icon = authority.kind === 'case' ? Scale : BookOpen;
  return (
    <article className="authority-row">
      <span className="icon-tile sm">
        <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
      </span>
      <div className="authority-body">
        <div className="authority-head">
          <h3>
            <Link href={authorityHref(authority)}>{authority.title}</Link>
          </h3>
          <VerificationBadge state={authority.verification} />
        </div>
        <div className="inline-meta">
          <span>{authority.kind === 'case' ? 'Case' : 'Legislation'}</span>
          <span className="identifier">{authority.identifier}</span>
          <span>{authority.source}</span>
          <time dateTime={authority.date}>{formatShortDate(authority.date)}</time>
          <span>{authority.practiceArea}</span>
        </div>
        <p className="excerpt">{authority.excerpt}</p>
        <div className="meta-row">
          <RightsBadge state={authority.rights} />
          {passageCount ? (
            <span className="micro">
              {passageCount} matching source {passageCount === 1 ? 'passage' : 'passages'}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function CaseCard({ authority }: { authority: LegalAuthority }) {
  return <AuthorityCard authority={authority} />;
}

export function LegislationCard({ authority }: { authority: LegalAuthority }) {
  return <AuthorityCard authority={authority} />;
}
