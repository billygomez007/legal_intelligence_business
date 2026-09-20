import Link from 'next/link';
import {
  AuthorityCard,
  CitationChip,
  CourtBadge,
  LayerPanel,
  MetadataPanel,
  PassageViewer,
  ProvisionTree,
  RecordHeader,
  RightsBadge,
  SourceCard,
  VerificationBadge,
  type MetadataItem,
} from '../components/legal';
import { DemoNotes } from '../components/notes/demo-notes';
import { EmptyState } from '../components/ui/primitives';
import type { Authority, SourceReference } from '../data/types';
import { formatShortDate } from '../lib/format';
import { routes } from '../lib/routes';

export function AuthorityDetail({
  authority,
  source,
  related,
  view,
}: {
  authority: Authority;
  source: SourceReference;
  related: Authority[];
  view: string;
}) {
  const isCase = authority.kind === 'case';
  const detail = isCase ? routes.case : routes.legislation;
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'full', label: isCase ? 'Full judgment' : 'Provisions' },
    { id: 'citations', label: isCase ? 'Citations' : 'Amendment history' },
    { id: 'related', label: 'Related authorities' },
    { id: 'notes', label: 'Notes' },
  ];
  const selected = tabs.some((t) => t.id === view) ? view : 'overview';

  const metadata: MetadataItem[] =
    authority.kind === 'case'
      ? [
          { label: 'Citation / identifier', value: authority.identifier },
          { label: 'Court / source', value: authority.source },
          { label: 'Decision date (synthetic)', value: formatShortDate(authority.date) },
          { label: 'Document version', value: authority.version },
          { label: 'Judges', value: authority.judges.join(', ') },
          { label: 'Parties', value: authority.parties.join(' / ') },
        ]
      : [
          { label: 'Instrument number', value: authority.instrumentNumber },
          { label: 'Source', value: authority.source },
          { label: 'Record date (synthetic)', value: formatShortDate(authority.date) },
          { label: 'Document version', value: authority.version },
        ];

  const referencedLegislation = related.filter(
    (a) => authority.kind === 'case' && authority.legislationIds.includes(a.id),
  );
  const relatedCases = related.filter(
    (a) => authority.kind === 'case' && authority.relatedIds.includes(a.id),
  );

  return (
    <>
      <RecordHeader
        eyebrow={`${isCase ? 'Case' : 'Legislation'} · Ghana · synthetic record`}
        title={authority.title}
        backHref={routes.search}
        backLabel="Back to authorities"
        badges={
          <>
            <CourtBadge court={authority.source} />
            <time className="record-date" dateTime={authority.date}>
              {formatShortDate(authority.date)}
            </time>
            <CitationChip citation={{ authorityId: authority.id, label: authority.identifier }} />
            <VerificationBadge state={authority.verification} />
            <RightsBadge state={authority.rights} />
          </>
        }
        {...(authority.kind === 'legislation'
          ? {
              facts: [
                { label: 'Instrument number', value: authority.instrumentNumber },
                { label: 'Enactment', value: authority.enactment },
                { label: 'Commencement', value: authority.commencement },
                { label: 'Status', value: authority.status },
              ],
            }
          : {})}
      />
      <nav className="tabs" aria-label="Authority sections">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={detail(authority.id, tab.id)}
            aria-current={selected === tab.id ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="reading-layout">
        <div className="reading-main">
          {selected === 'overview' &&
            (authority.kind === 'case' ? (
              <>
                <LayerPanel
                  layer="synthesis"
                  label="Derived summary"
                  detail="demonstration · not the judgment text"
                  className="brief"
                >
                  {[
                    { title: 'Facts', text: authority.facts },
                    { title: 'Issues', text: authority.issues },
                    { title: 'Holding', text: authority.holding },
                    { title: 'Key reasoning', text: authority.reasoning },
                  ].map((part) => (
                    <section className="brief-section" key={part.title}>
                      <h2>{part.title}</h2>
                      <p>{part.text}</p>
                    </section>
                  ))}
                </LayerPanel>
                <section className="detail-section">
                  <h2>Authorities cited</h2>
                  {authority.citations.length ? (
                    authority.citations.map((citation) => (
                      <CitationChip key={citation.label} citation={citation} />
                    ))
                  ) : (
                    <p className="muted">No example citations supplied.</p>
                  )}
                </section>
                <section className="detail-section">
                  <h2>Legislation referenced</h2>
                  {referencedLegislation.length ? (
                    <div className="panel result-list">
                      {referencedLegislation.map((a) => (
                        <AuthorityCard key={a.id} authority={a} />
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No example legislation referenced.</p>
                  )}
                </section>
                <section className="detail-section">
                  <h2>Related cases</h2>
                  {relatedCases.length ? (
                    <div className="panel result-list">
                      {relatedCases.map((a) => (
                        <AuthorityCard key={a.id} authority={a} />
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No related example cases.</p>
                  )}
                </section>
              </>
            ) : (
              <>
                <ProvisionTree authorityId={authority.id} parts={authority.parts} />
                <section className="detail-section">
                  <h2>Cases citing this provision</h2>
                  {related.length ? (
                    <div className="panel result-list">
                      {related.map((a) => (
                        <AuthorityCard key={a.id} authority={a} />
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No example cases cite this provision.</p>
                  )}
                </section>
              </>
            ))}
          {selected === 'full' && (
            <>
              <h2 className="detail-heading">
                {isCase
                  ? 'Full judgment · synthetic source fixture'
                  : 'Provisions · synthetic text'}
              </h2>
              {authority.kind === 'legislation' && (
                <ProvisionTree authorityId={authority.id} parts={authority.parts} />
              )}
              <PassageViewer source={source} />
            </>
          )}
          {selected === 'citations' &&
            (authority.kind === 'case' ? (
              <section className="panel panel-padded stack">
                <h2>Example citation links</h2>
                <p className="micro">
                  These are fixture relationships. No real citation treatment has been established.
                </p>
                <div>
                  {authority.citations.length ? (
                    authority.citations.map((citation) => (
                      <CitationChip key={citation.label} citation={citation} />
                    ))
                  ) : (
                    <EmptyState title="No citations supplied" />
                  )}
                </div>
                <EmptyState
                  title="Case treatment is not connected"
                  description="Followed, applied, distinguished or overruled relationships require verified source support."
                />
              </section>
            ) : (
              <section className="panel panel-padded stack">
                <h2>Amendment history</h2>
                <ol className="timeline">
                  {authority.amendments.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ol>
              </section>
            ))}
          {selected === 'related' && (
            <section className="stack">
              <h2 className="detail-heading">
                {isCase ? 'Related authorities' : 'Cases citing this provision'}
              </h2>
              <p className="micro">
                Illustrative links only. No similarity search or citation analysis has run.
              </p>
              {related.length ? (
                <div className="panel result-list">
                  {related.map((a) => (
                    <AuthorityCard authority={a} key={a.id} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No related example authorities" />
              )}
            </section>
          )}
          {selected === 'notes' && <DemoNotes key={authority.id} initialNote="" />}
        </div>
        <aside className="source-rail" aria-label="Source document panel">
          <MetadataPanel items={metadata} />
          <SourceCard source={source} />
        </aside>
      </div>
    </>
  );
}
