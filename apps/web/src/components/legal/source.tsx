import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { Passage, SourceReference } from '../../data/types';
import { routes } from '../../lib/routes';
import { Unavailable } from '../ui/primitives';
import { authorityHref } from './authority-card';
import { RightsBadge, VerificationBadge } from './badges';
import { CitationChip } from './citation';
import { LayerPanel } from './layer';

/** One passage of primary source text. Serif, with its locator and version, and an anchor target. */
export function SourcePassage({
  passage,
  anchor = true,
}: {
  passage: Passage;
  /** Set false when the same passage is already anchored elsewhere on the page. */
  anchor?: boolean;
}) {
  return (
    <LayerPanel
      layer="source"
      detail="synthetic fixture"
      {...(anchor ? { id: passage.id } : {})}
      className="source-passage"
    >
      <p className="passage-locator">{passage.locator}</p>
      <blockquote>{passage.text}</blockquote>
      <p className="micro">
        Document: {passage.documentId} · Version: {passage.version}
      </p>
    </LayerPanel>
  );
}

export function PassageViewer({
  source,
  anchors = true,
}: {
  source: SourceReference;
  anchors?: boolean;
}) {
  if (source.authority.rights !== 'available')
    return <Unavailable restricted={source.authority.rights === 'restricted'} />;
  return (
    <div className="stack">
      {source.passages.map((passage) => (
        <SourcePassage key={passage.id} passage={passage} anchor={anchors} />
      ))}
    </div>
  );
}

export function SourceCard({ source }: { source: SourceReference }) {
  const { authority } = source;
  return (
    <article className="source-card">
      <p className="eyebrow">Source document · demonstration</p>
      <h3>
        <Link href={authorityHref(authority)}>{authority.title}</Link>
      </h3>
      <p className="micro">
        {authority.source} · {authority.date}
      </p>
      <CitationChip citation={{ authorityId: source.documentId, label: authority.identifier }} />
      <div className="meta-row">
        <VerificationBadge state={authority.verification} />
        <RightsBadge state={authority.rights} />
      </div>
      <PassageViewer source={source} anchors={false} />
      <Link className="text-link" href={routes.source(source.documentId)}>
        Open source document <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
    </article>
  );
}
