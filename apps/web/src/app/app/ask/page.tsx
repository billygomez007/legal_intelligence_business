import { AskWorkbench } from '../../../components/ask-workbench';
import { PageHeader } from '../../../components/ui/primitives';
import { webClients } from '../../../data/mock-clients';
export const metadata = { title: 'Ask the Law' };
export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const answer = await webClients.research.exampleAnswer();
  const sources = await Promise.all(
    answer.sourceDocumentIds.map((id) => webClients.authorities.source(id)),
  );
  return (
    <>
      <PageHeader
        eyebrow="SOURCE-GROUNDED RESEARCH"
        title="Ask the Law"
        description="From a research question to inspectable authorities. Future AI experience, shown with synthetic data."
      />
      <AskWorkbench
        initialQuestion={typeof params['q'] === 'string' ? params['q'].slice(0, 1500) : ''}
        answer={answer}
        sources={sources.filter((s) => s !== undefined)}
      />
    </>
  );
}
