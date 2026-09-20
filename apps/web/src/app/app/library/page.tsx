import { LibraryView, type SavedPassage } from '../../../components/library/library-view';
import { PageHeader } from '../../../components/ui/primitives';
import { webClients } from '../../../data/mock-clients';

export const metadata = { title: 'Library' };

export default async function LibraryPage() {
  const [authorities, projects, workspace] = await Promise.all([
    webClients.authorities.list(),
    webClients.research.list(),
    webClients.workspace.overview(),
  ]);
  const saved = new Set(workspace.savedAuthorityIds);
  const sources = await Promise.all(authorities.map((a) => webClients.authorities.source(a.id)));
  const byId = new Map(authorities.map((authority) => [authority.id, authority]));
  const passages: SavedPassage[] = [];
  for (const project of projects) {
    for (const source of sources) {
      for (const passage of source?.passages ?? []) {
        const authority = byId.get(passage.documentId);
        if (authority && project.passageIds.includes(passage.id)) {
          passages.push({ passage, authority, projectTitle: project.title });
        }
      }
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Saved research"
        title="Library"
        description="Your demonstration collection of cases, legislation, passages and research reports."
      />
      <LibraryView authorities={authorities.filter((a) => saved.has(a.id))} passages={passages} />
    </>
  );
}
