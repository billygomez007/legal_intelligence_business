import { LibraryView } from '../../../components/demo-interactions';
import { PageHeader } from '../../../components/ui/primitives';
import { webClients } from '../../../data/mock-clients';
export const metadata = { title: 'Library' };
export default async function LibraryPage() {
  const [authorities, projects] = await Promise.all([
    webClients.authorities.list(),
    webClients.research.list(),
  ]);
  const saved = new Set(projects.flatMap((p) => p.authorityIds));
  return (
    <>
      <PageHeader
        eyebrow="SAVED RESEARCH"
        title="Library"
        description="Your demonstration collection of cases, legislation, passages and research reports."
      />
      <LibraryView authorities={authorities.filter((a) => saved.has(a.id))} projects={projects} />
    </>
  );
}
