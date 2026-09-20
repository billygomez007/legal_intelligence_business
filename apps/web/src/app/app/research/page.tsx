import { Plus } from 'lucide-react';
import { ResearchProjectCard } from '../../../components/legal';
import { EmptyState, PageHeader } from '../../../components/ui/primitives';
import { webClients } from '../../../data/mock-clients';

export const metadata = { title: 'Research' };

export default async function ResearchPage() {
  const [projects, workspace] = await Promise.all([
    webClients.research.list(),
    webClients.workspace.overview(),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Matters & projects"
        title="Your research, together."
        description="Keep authorities, source passages and working notes in one place. Demonstration projects only."
        action={
          <button className="button secondary" type="button" disabled>
            <Plus size={15} aria-hidden="true" />
            New project
          </button>
        }
      />
      <h2 className="sr-only">Projects</h2>
      {projects.length ? (
        <div className="project-grid">
          {projects.map((project) => (
            <ResearchProjectCard key={project.id} project={project} asOf={workspace.asOf} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
      <p className="micro page-foot">
        Project creation, collaboration and persistence will be available after API integration.
      </p>
    </>
  );
}
