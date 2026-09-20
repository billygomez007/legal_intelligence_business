import { notFound } from 'next/navigation';
import { webClients } from '../../../data/mock-clients';
import { AuthorityDetail } from '../../../views/authority-detail';
export default async function AuthorityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [authority, source, all] = await Promise.all([
    webClients.authorities.get(id),
    webClients.authorities.source(id),
    webClients.authorities.list(),
  ]);
  if (authority?.kind !== 'case' || !source) notFound();
  const ids = [
    ...authority.relatedIds,
    ...authority.legislationIds,
    ...authority.citations.map((c) => c.authorityId),
  ];
  return (
    <AuthorityDetail
      authority={authority}
      source={source}
      related={all.filter((a) => ids.includes(a.id))}
      view={typeof query['view'] === 'string' ? query['view'] : 'overview'}
    />
  );
}
