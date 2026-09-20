import Link from 'next/link';
import {
  AuthorityCard,
  CitationChip,
  PassageViewer,
  SourceCard,
  VerificationBadge,
  RightsBadge,
} from '../components/legal';
import { DemoNotes } from '../components/demo-interactions';
import { EmptyState } from '../components/ui/primitives';
import type { Authority, SourceReference } from '../data/types';
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
  const base = `/${authority.kind === 'case' ? 'cases' : 'legislation'}/${authority.id}`;
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'full', label: authority.kind === 'case' ? 'Full judgment' : 'Provisions' },
    { id: 'citations', label: authority.kind === 'case' ? 'Citations' : 'Amendment history' },
    { id: 'related', label: 'Related authorities' },
    { id: 'notes', label: 'Notes' },
  ];
  const selected = tabs.some((t) => t.id === view) ? view : 'overview';
  return (
    <>
      <Link className="text-link back-link" href="/search">
        ← Back to authorities
      </Link>
      <p className="eyebrow">{authority.kind} · Ghana · synthetic record</p>
      <h1 className="authority-title">{authority.title}</h1>
      <div className="meta-row">
        <CitationChip citation={{ authorityId: authority.id, label: authority.identifier }} />
        <VerificationBadge state={authority.verification} />
        <RightsBadge state={authority.rights} />
      </div>
      <nav className="tabs" aria-label="Authority sections">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={`${base}?view=${tab.id}`}
            aria-current={selected === tab.id ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="content-grid">
        <div>
          {selected === 'overview' && (
            <>
              <section className="panel panel-padded">
                <p className="eyebrow">Structured metadata · demonstration</p>
                <h2 className="mb-5">
                  {authority.kind === 'case' ? 'Case overview' : 'Instrument overview'}
                </h2>
                <dl className="metadata-grid">
                  <div>
                    <dt>Citation / identifier</dt>
                    <dd>{authority.identifier}</dd>
                  </div>
                  <div>
                    <dt>Court / source</dt>
                    <dd>{authority.source}</dd>
                  </div>
                  <div>
                    <dt>
                      {authority.kind === 'case'
                        ? 'Decision date (synthetic)'
                        : 'Record date (synthetic)'}
                    </dt>
                    <dd>{authority.date}</dd>
                  </div>
                  <div>
                    <dt>Document version</dt>
                    <dd>{authority.version}</dd>
                  </div>
                  {authority.kind === 'case' ? (
                    <>
                      <div>
                        <dt>Judges</dt>
                        <dd>{authority.judges.join(', ')}</dd>
                      </div>
                      <div>
                        <dt>Parties</dt>
                        <dd>{authority.parties.join(' / ')}</dd>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <dt>Instrument number</dt>
                        <dd>{authority.instrumentNumber}</dd>
                      </div>
                      <div>
                        <dt>Enactment</dt>
                        <dd>{authority.enactment}</dd>
                      </div>
                      <div>
                        <dt>Commencement</dt>
                        <dd>{authority.commencement}</dd>
                      </div>
                      <div>
                        <dt>Status (synthetic)</dt>
                        <dd>{authority.status}</dd>
                      </div>
                    </>
                  )}
                </dl>
              </section>
              {authority.kind === 'case' ? (
                <>
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
                  <section className="brief-section">
                    <h2>Authorities cited</h2>
                    {authority.citations.length ? (
                      authority.citations.map((citation) => (
                        <CitationChip key={citation.label} citation={citation} />
                      ))
                    ) : (
                      <p>No example citations supplied.</p>
                    )}
                  </section>
                  <section className="brief-section">
                    <h2>Legislation referenced</h2>
                    {related
                      .filter((a) => authority.legislationIds.includes(a.id))
                      .map((a) => (
                        <AuthorityCard key={a.id} authority={a} />
                      ))}
                  </section>
                  <section className="brief-section">
                    <h2>Related cases</h2>
                    {related
                      .filter((a) => authority.relatedIds.includes(a.id))
                      .map((a) => (
                        <AuthorityCard key={a.id} authority={a} />
                      ))}
                  </section>
                </>
              ) : (
                <ProvisionTree authority={authority} />
              )}
            </>
          )}
          {selected === 'full' && (
            <>
              <h2 className="mb-4">
                {authority.kind === 'case'
                  ? 'Full judgment · synthetic source fixture'
                  : 'Provisions · synthetic text'}
              </h2>
              {authority.kind === 'legislation' && <ProvisionTree authority={authority} />}
              <PassageViewer source={source} />
            </>
          )}
          {selected === 'citations' &&
            (authority.kind === 'case' ? (
              <section className="panel panel-padded">
                <h2>Example citation links</h2>
                <p className="micro my-3">
                  These are fixture relationships. No real citation treatment has been established.
                </p>
                {authority.citations.length ? (
                  authority.citations.map((citation) => (
                    <CitationChip key={citation.label} citation={citation} />
                  ))
                ) : (
                  <EmptyState title="No citations supplied" />
                )}
                <EmptyState
                  title="Case treatment is not connected"
                  description="Followed, applied, distinguished or overruled relationships require verified source support."
                />
              </section>
            ) : (
              <section className="panel panel-padded">
                <h2>Amendment history</h2>
                {authority.amendments.map((entry) => (
                  <p className="micro mt-4" key={entry}>
                    {entry}
                  </p>
                ))}
              </section>
            ))}
          {selected === 'related' && (
            <section>
              <h2 className="mb-4">
                {authority.kind === 'case' ? 'Related authorities' : 'Cases citing this provision'}
              </h2>
              <p className="micro mb-4">
                Illustrative links only. No similarity search or citation analysis has run.
              </p>
              {related.length ? (
                related.map((a) => <AuthorityCard authority={a} key={a.id} />)
              ) : (
                <EmptyState title="No related example authorities" />
              )}
            </section>
          )}
          {selected === 'notes' && <DemoNotes key={authority.id} initialNote="" />}
        </div>
        <aside className="source-rail" aria-label="Source document panel">
          <SourceCard source={source} />
        </aside>
      </div>
    </>
  );
}
function ProvisionTree({ authority }: { authority: Extract<Authority, { kind: 'legislation' }> }) {
  return (
    <section className="provision-tree" aria-label="Provision tree">
      <h2 className="mt-6">Parts & sections</h2>
      {authority.parts.map((part) => (
        <details open key={part.title}>
          <summary>{part.title}</summary>
          {part.provisions.map((provision) => (
            <Link key={provision.id} href={`/sources/${authority.id}#${provision.passageId}`}>
              {provision.label} · {provision.heading}
            </Link>
          ))}
        </details>
      ))}
    </section>
  );
}
