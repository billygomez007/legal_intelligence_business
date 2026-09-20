import Link from 'next/link';
import { BookOpen, Scale } from 'lucide-react';
import type { LegalAuthority } from '../../data/types';
import { routes } from '../../lib/routes';
import { authorityHref, RightsBadge, VerificationBadge } from '../legal';
import { ListPanel } from '../ui/list-panel';

/**
 * One trust badge per row: the strongest verification state if there is one, otherwise the
 * source-rights state. Every badge carries its own "· demo" suffix.
 */
function TrustBadge({ authority }: { authority: LegalAuthority }) {
  return authority.verification === 'verified' || authority.verification === 'human-reviewed' ? (
    <VerificationBadge state={authority.verification} />
  ) : (
    <RightsBadge state={authority.rights} />
  );
}

export function SavedAuthoritiesPanel({ authorities }: { authorities: LegalAuthority[] }) {
  return (
    <ListPanel
      id="saved-title"
      title="Saved authorities"
      href={routes.library}
      className="dash-saved"
    >
      <ul className="row-list">
        {authorities.map((authority) => (
          <li className="list-row" key={authority.id}>
            <span className="icon-tile sm">
              {authority.kind === 'case' ? (
                <Scale size={18} strokeWidth={1.6} aria-hidden="true" />
              ) : (
                <BookOpen size={18} strokeWidth={1.6} aria-hidden="true" />
              )}
            </span>
            <div className="row-main">
              <Link className="row-title" href={authorityHref(authority)}>
                {authority.title}
              </Link>
              <p className="row-sub">
                {authority.source} · {authority.date.slice(0, 4)}
              </p>
            </div>
            <div className="row-trailing">
              <TrustBadge authority={authority} />
            </div>
          </li>
        ))}
      </ul>
      <p className="micro panel-note">Demonstration records. None is a real legal authority.</p>
    </ListPanel>
  );
}
