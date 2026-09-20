import Link from 'next/link';
import { AuthorityCard } from '../../components/legal';
import { SearchFilters } from '../../components/search-filters';
import { EmptyState, PageHeader } from '../../components/ui/primitives';
import { emptySearch, webClients } from '../../data/mock-clients';
export const metadata = { title: 'Search' };
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = { ...emptySearch };
  for (const key of Object.keys(query) as (keyof typeof query)[]) {
    const value = params[key === 'text' ? 'q' : key];
    query[key] = typeof value === 'string' ? value.slice(0, 1500) : '';
  }
  const [authorities, results] = await Promise.all([
    webClients.authorities.list(),
    webClients.search.search(query),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="LEGAL AUTHORITIES"
        title="Search the law"
        description="Explore the demonstration corpus by authority, topic or provision."
      />
      <form action="/search" className="search-layout">
        <aside>
          <SearchFilters query={query} authorities={authorities} />
          <button type="submit" className="button w-full">
            Apply filters
          </button>
          <Link className="text-link mt-4" href="/search">
            Clear all filters
          </Link>
        </aside>
        <section aria-label="Search results">
          <div className="search-tools">
            <label className="sr-only" htmlFor="legal-query">
              Search authorities
            </label>
            <input
              id="legal-query"
              name="q"
              defaultValue={query.text}
              placeholder="Search by keyword, title or demonstration identifier"
              maxLength={1500}
            />
            <button className="button">Search</button>
          </div>
          <p className="results-label">
            {results.length} demonstration {results.length === 1 ? 'result' : 'results'} · Local
            fixture filtering only
          </p>
          <div className="panel">
            {results.length ? (
              results.map(({ authority }) => (
                <AuthorityCard authority={authority} key={authority.id} />
              ))
            ) : (
              <EmptyState
                title="No demonstration authorities match"
                description="Try another keyword or clear the filters. This preview searches only four synthetic records."
                href="/search"
                action="Reset search"
              />
            )}
          </div>
        </section>
      </form>
    </>
  );
}
