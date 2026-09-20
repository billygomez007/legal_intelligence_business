import { ResearchProjectCard } from '../../../components/legal';
import { EmptyState, PageHeader } from '../../../components/ui/primitives';
import { webClients } from '../../../data/mock-clients';
export const metadata = { title: 'Research' };
export default async function ResearchPage() {
  const projects = await webClients.research.list();
  return (
    <>
      <PageHeader
        eyebrow="MATTERS & PROJECTS"
        title="Your research, together."
        description="Keep authorities, source passages and working notes in one place. Demonstration projects only."
      />
      {projects.length ? (
        <div className="project-grid">
          {projects.map((project) => (
            <ResearchProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
      <p className="micro mt-6">
        Project creation, collaboration and persistence will be available after API integration.
      </p>
    </>
  );
}
