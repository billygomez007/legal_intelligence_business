import { notFound } from 'next/navigation';
import { FileText } from 'lucide-react';
import { AuthorityCard, MetadataPanel, SourcePassage } from '../../../../components/legal';
import { DemoNotes } from '../../../../components/notes/demo-notes';
import { EmptyState, SectionHeading } from '../../../../components/ui/primitives';
import { ResearchStatusLabel } from '../../../../components/ui/status';
import { Timeline } from '../../../../components/ui/timeline';
import { webClients } from '../../../../data/mock-clients';
import { relativeTime } from '../../../../lib/format';
import { routes } from '../../../../lib/routes';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, workspace] = await Promise.all([
    webClients.research.get(id),
    webClients.workspace.overview(),
  ]);
  if (!project) notFound();
  const authorities = (await webClients.authorities.list()).filter((a) =>
    project.authorityIds.includes(a.id),
  );
  const sources = await Promise.all(
    project.authorityIds.map((authorityId) => webClients.authorities.source(authorityId)),
  );
  const passages = sources
    .flatMap((source) => source?.passages ?? [])
    .filter((p) => project.passageIds.includes(p.id));
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">{project.reference} · Demonstration project</p>
          <h1>{project.title}</h1>
          <p className="muted">Research workspace · Temporary notes · No persistence</p>
        </div>
        <ResearchStatusLabel status={project.status} />
      </header>
      <section className="panel question-panel" aria-labelledby="question-label">
        <p className="eyebrow" id="question-label">
          Research question
        </p>
        <h2 className="display">{project.question}</h2>
      </section>
      <div className="reading-layout">
        <div className="reading-main stack">
          <section>
            <SectionHeading title="Saved authorities" href={routes.search} link="Explore corpus" />
            {authorities.length ? (
              <div className="panel result-list">
                {authorities.map((authority) => (
                  <AuthorityCard authority={authority} key={authority.id} />
                ))}
              </div>
            ) : (
              <EmptyState />
            )}
          </section>
          <section>
            <SectionHeading title="Saved passages" />
            {passages.length ? (
              <div className="stack">
                {passages.map((passage) => (
                  <SourcePassage key={passage.id} passage={passage} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No saved passages"
                description="Source passages added to this matter will appear here."
              />
            )}
          </section>
          <DemoNotes key={project.id} initialNote={project.note} />
        </div>
        <aside className="source-rail" aria-label="Project details">
          <MetadataPanel
            title="Project details"
            items={[
              { label: 'Reference', value: project.reference },
              { label: 'Practice area', value: project.practiceArea },
              { label: 'Court / source (placeholder)', value: project.source },
              { label: 'Last updated', value: relativeTime(project.updated, workspace.asOf) },
            ]}
          />
          <section className="panel panel-padded report-panel" aria-labelledby="report-title">
            <h2 id="report-title" className="panel-title">
              Research report
            </h2>
            <span className="icon-tile">
              <FileText size={22} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <h3>Build on your research</h3>
            <p className="muted">
              Source-linked report generation and export are not connected in this preview.
            </p>
          </section>
          <section className="panel panel-padded" aria-labelledby="history-title">
            <h2 id="history-title" className="panel-title">
              Research history
            </h2>
            <Timeline items={project.history} />
            <p className="micro">Synthetic activity · Not an audit log</p>
          </section>
        </aside>
      </div>
      <p className="micro page-foot">
        Saved passages are primary source text. Notes are yours alone and are never treated as
        authority.
      </p>
    </>
  );
}
