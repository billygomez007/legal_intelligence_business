import { notFound } from 'next/navigation';
import { webClients } from '../../../data/mock-clients';
import { AuthorityCard, SourcePassage } from '../../../components/legal';
import { DemoNotes } from '../../../components/demo-interactions';
import { EmptyState, PageHeader, SectionHeading } from '../../../components/ui/primitives';
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await webClients.research.get(id);
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
      <PageHeader
        eyebrow={`${project.reference} · DEMONSTRATION PROJECT`}
        title={project.title}
        description="Research workspace · Temporary notes · No persistence"
      />
      <section className="panel panel-padded">
        <p className="eyebrow">Research question</p>
        <h2>{project.question}</h2>
      </section>
      <div className="content-grid">
        <div className="stack">
          <section>
            <SectionHeading title="Saved authorities" href="/search" link="Explore corpus" />
            {authorities.length ? (
              <div className="panel">
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
        <aside className="stack">
          <section>
            <SectionHeading title="Research report" />
            <EmptyState
              title="Build on your research"
              description="Source-linked report generation and export are not connected in this preview."
            />
          </section>
          <section className="panel panel-padded">
            <h2>Research history</h2>
            <ol className="history">
              {project.history.map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ol>
            <p className="micro">Synthetic activity · Not an audit log</p>
          </section>
        </aside>
      </div>
    </>
  );
}
