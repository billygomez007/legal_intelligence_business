import { notFound } from 'next/navigation';
import Link from 'next/link';
import { webClients } from '../../../data/mock-clients';
import {
  authorityHref,
  PassageViewer,
  VerificationBadge,
  RightsBadge,
} from '../../../components/legal';
import { PageHeader } from '../../../components/ui/primitives';
export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await webClients.authorities.source(id);
  if (!source) notFound();
  return (
    <>
      <PageHeader
        eyebrow="PRIMARY SOURCE · SYNTHETIC FIXTURE"
        title={source.authority.title}
        description="This document contains demonstration text only. It is not a legal authority."
        action={
          <Link className="button secondary" href={authorityHref(source.authority)}>
            Open structured overview
          </Link>
        }
      />
      <div className="panel panel-padded mb-6">
        <p className="eyebrow">Source provenance · demonstration</p>
        <dl className="metadata-grid">
          <div>
            <dt>Document ID</dt>
            <dd>{source.documentId}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{source.authority.version}</dd>
          </div>
          <div>
            <dt>Origin</dt>
            <dd>Locally authored synthetic UI fixture</dd>
          </div>
          <div>
            <dt>Collection</dt>
            <dd>Public demonstration corpus</dd>
          </div>
        </dl>
        <div className="meta-row mt-5">
          <VerificationBadge state={source.authority.verification} />
          <RightsBadge state={source.authority.rights} />
        </div>
      </div>
      <PassageViewer source={source} />
    </>
  );
}
