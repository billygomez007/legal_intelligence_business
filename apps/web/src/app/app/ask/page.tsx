import { AskWorkbench } from '../../../components/ask-workbench';
import { researchScopes } from '../../../components/search/research-scopes';
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
  const scopeParam = params['scope'];
  const known = new Set(researchScopes.map((scope) => scope.value));
  const initialScopes = (
    Array.isArray(scopeParam) ? scopeParam : scopeParam ? [scopeParam] : []
  ).filter((value) => known.has(value));
  return (
    <>
      <PageHeader
        eyebrow="Source-grounded research"
        title="Ask the Law"
        description="Put a research question, then inspect the authorities behind any answer. A future AI experience, shown here with synthetic data."
      />
      <AskWorkbench
        initialQuestion={typeof params['q'] === 'string' ? params['q'].slice(0, 1500) : ''}
        initialScopes={initialScopes}
        answer={answer}
        sources={sources.filter((s) => s !== undefined)}
      />
    </>
  );
}
