import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  FileText,
  FolderOpen,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import type {
  Citation,
  LegalAnswer as LegalAnswerModel,
  LegalAuthority,
  Passage,
  ResearchProject,
  RightsState,
  SourceReference,
  VerificationState,
} from '../data/types';
import { Unavailable } from './ui/primitives';
import { routes } from '../lib/routes';
const verificationLabels: Record<VerificationState, string> = {
  verified: 'Verified',
  'human-reviewed': 'Human reviewed',
  'machine-extracted': 'Machine extracted',
  unverified: 'Unverified',
};
export function DemoBadge({ label = 'Demonstration data' }: { label?: string }) {
  return <span className="demo-badge">{label}</span>;
}
export function VerificationBadge({ state }: { state: VerificationState }) {
  return (
    <span
      className={`badge verification ${state}`}
      title="Illustrative state only; no backend verification has occurred"
    >
      <ShieldCheck size={12} aria-hidden="true" />
      {verificationLabels[state]} · demo
    </span>
  );
}
export function RightsBadge({ state }: { state: RightsState }) {
  return (
    <span className={`badge rights-${state}`}>
      {state === 'restricted' && <LockKeyhole size={12} aria-hidden="true" />}
      {state === 'available'
        ? 'Source available'
        : state === 'restricted'
          ? 'Rights restricted'
          : 'Source unavailable'}{' '}
      · demo
    </span>
  );
}
export function CourtBadge({ court }: { court: string }) {
  return <span className="court-badge">{court}</span>;
}
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
export function authorityHref(authority: LegalAuthority) {
  return authority.kind === 'case' ? routes.case(authority.id) : routes.legislation(authority.id);
}
export function AuthorityCard({ authority }: { authority: LegalAuthority }) {
  return (
    <article className="authority-row">
      <span className="document-icon">
        {authority.kind === 'case' ? (
          <FileText size={20} aria-hidden="true" />
        ) : (
          <BookOpen size={20} aria-hidden="true" />
        )}
      </span>
      <div className="grow">
        <div className="inline-meta">
          <span>{authority.kind === 'case' ? 'Case' : 'Legislation'}</span>
          <span>{authority.identifier}</span>
          <span>{authority.date.slice(0, 4)}</span>
        </div>
        <h3>
          <Link href={authorityHref(authority)}>{authority.title}</Link>
        </h3>
        <p className="excerpt">{authority.excerpt}</p>
        <div className="meta-row">
          <CourtBadge court={authority.source} />
          <VerificationBadge state={authority.verification} />
          <RightsBadge state={authority.rights} />
        </div>
      </div>
      <ArrowUpRight className="row-arrow" size={18} aria-hidden="true" />
    </article>
  );
}
export function CaseCard({ authority }: { authority: LegalAuthority }) {
  return <AuthorityCard authority={authority} />;
}
export function LegislationCard({ authority }: { authority: LegalAuthority }) {
  return <AuthorityCard authority={authority} />;
}
export function SourcePassage({ passage }: { passage: Passage }) {
  return (
    <section className="source-passage" id={passage.id}>
      <div className="inline-meta">
        <strong>Primary source · synthetic fixture</strong>
        <span>{passage.locator}</span>
      </div>
      <blockquote>{passage.text}</blockquote>
      <p className="micro">
        Document: {passage.documentId} · Version: {passage.version}
      </p>
    </section>
  );
}
export function PassageViewer({ source }: { source: SourceReference }) {
  if (source.authority.rights !== 'available')
    return <Unavailable restricted={source.authority.rights === 'restricted'} />;
  return (
    <div className="stack">
      {source.passages.map((passage) => (
        <SourcePassage key={passage.id} passage={passage} />
      ))}
    </div>
  );
}
export function SourceCard({ source }: { source: SourceReference }) {
  return (
    <article className="source-card">
      <p className="eyebrow">Source document · demonstration</p>
      <h3>
        <Link href={authorityHref(source.authority)}>{source.authority.title}</Link>
      </h3>
      <p className="micro">
        {source.authority.source} · {source.authority.date}
      </p>
      <CitationChip
        citation={{ authorityId: source.documentId, label: source.authority.identifier }}
      />
      <div className="meta-row">
        <VerificationBadge state={source.authority.verification} />
        <RightsBadge state={source.authority.rights} />
      </div>
      <PassageViewer source={source} />
      <Link className="text-link" href={routes.source(source.documentId)}>
        Open source document <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
    </article>
  );
}
export function LegalAnswer({ answer }: { answer: LegalAnswerModel }) {
  return (
    <section className="synthesis" aria-label="AI synthesis example">
      <p className="eyebrow">AI synthesis · fixed demonstration · no model run</p>
      <h2>Example research answer</h2>
      <p>{answer.answerText}</p>
      <h3>Legal reasoning</h3>
      <p>{answer.reasoning}</p>
      <h3>Authorities</h3>
      {answer.citations.map((citation) => (
        <LegalCitation key={citation.label} citation={citation} />
      ))}
      <div className="caveat">
        <h3>Caveats & limitations</h3>
        <p>{answer.caveats}</p>
      </div>
      <details className="audit-details">
        <summary>Research trace</summary>
        <dl>
          <dt>Model / version</dt>
          <dd>
            {answer.model} / {answer.modelVersion}
          </dd>
          <dt>Retrieval IDs</dt>
          <dd>
            {answer.retrievalIds.length
              ? answer.retrievalIds.join(', ')
              : 'None; retrieval has not run'}
          </dd>
          <dt>Source documents</dt>
          <dd>{answer.sourceDocumentIds.join(', ')}</dd>
          <dt>Source passages</dt>
          <dd>{answer.sourcePassageIds.join(', ')}</dd>
          <dt>Example creation time</dt>
          <dd>{answer.createdAt}</dd>
          <dt>Verification</dt>
          <dd>{answer.verification}</dd>
        </dl>
      </details>
    </section>
  );
}
export function ResearchProjectCard({ project }: { project: ResearchProject }) {
  return (
    <article className="project-card">
      <FolderOpen size={21} aria-hidden="true" />
      <p className="micro">{project.reference}</p>
      <h3>
        <Link href={routes.researchProject(project.id)}>{project.title}</Link>
      </h3>
      <p>{project.question}</p>
      <div className="project-footer">
        <span>{project.authorityIds.length} saved authorities</span>
        <span>{project.updated.slice(0, 10)}</span>
      </div>
    </article>
  );
}
