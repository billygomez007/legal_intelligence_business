import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { Citation } from '../../data/types';
import { routes } from '../../lib/routes';

/** A citation that resolves to the exact source passage it points at. */
export function CitationChip({ citation }: { citation: Citation }) {
  return (
    <Link className="citation-chip" href={routes.source(citation.authorityId, citation.passageId)}>
      {citation.label}
      <ArrowUpRight size={12} aria-hidden="true" />
    </Link>
  );
}

export function LegalCitation({ citation }: { citation: Citation }) {
  return <CitationChip citation={citation} />;
}
