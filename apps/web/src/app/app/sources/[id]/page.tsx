import { notFound } from 'next/navigation';
import {
  authorityHref,
  MetadataPanel,
  PassageViewer,
  RecordHeader,
  RightsBadge,
  VerificationBadge,
} from '../../../../components/legal';
import { webClients } from '../../../../data/mock-clients';
import { routes } from '../../../../lib/routes';

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await webClients.authorities.source(id);
  if (!source) notFound();
  const { authority } = source;
  return (
    <>
      <RecordHeader
        eyebrow="Primary source · synthetic fixture"
        title={authority.title}
        backHref={authorityHref(authority)}
        backLabel="Open structured overview"
        badges={
          <>
            <VerificationBadge state={authority.verification} />
            <RightsBadge state={authority.rights} />
          </>
        }
      />
      <p className="muted source-note">
        This document contains demonstration text only. It is not a legal authority.
      </p>
      <div className="reading-layout">
        <div className="reading-main">
          <PassageViewer source={source} />
        </div>
        <aside className="source-rail" aria-label="Source provenance">
          <MetadataPanel
            title="Source provenance"
            items={[
              { label: 'Document ID', value: source.documentId },
              { label: 'Version', value: authority.version },
              { label: 'Origin', value: 'Locally authored synthetic UI fixture' },
              { label: 'Collection', value: 'Public demonstration corpus' },
            ]}
          />
          <a className="text-link" href={routes.search}>
            Back to search
          </a>
        </aside>
      </div>
    </>
  );
}
