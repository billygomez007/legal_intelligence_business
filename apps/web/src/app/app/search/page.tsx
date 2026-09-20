import Link from 'next/link';
import { X } from 'lucide-react';
import { AuthorityCard } from '../../../components/legal';
import { SearchFilters } from '../../../components/search-filters';
import { SearchBox } from '../../../components/search/search-box';
import { EmptyState, PageHeader } from '../../../components/ui/primitives';
import { emptySearch, webClients } from '../../../data/mock-clients';
import type { SearchQuery } from '../../../data/types';
import { routes } from '../../../lib/routes';

export const metadata = { title: 'Search' };

const filterLabels: Record<Exclude<keyof SearchQuery, 'text'>, string> = {
  jurisdiction: 'Jurisdiction',
  court: 'Court / source',
  kind: 'Document type',
  year: 'Year',
  practiceArea: 'Practice area',
  concept: 'Legal concept',
};

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

  /** The search URL with one criterion removed, for the active-filter chips. */
  const without = (key: keyof SearchQuery) => {
    const next = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      if (value && name !== key) next.set(name === 'text' ? 'q' : name, value);
    }
    const qs = next.toString();
    return qs ? `${routes.search}?${qs}` : routes.search;
  };
  const active = (Object.keys(filterLabels) as (keyof typeof filterLabels)[]).filter(
    (key) => query[key],
  );

  return (
    <>
      <PageHeader
        eyebrow="Legal authorities"
        title="Search the law"
        description="Explore the demonstration corpus by authority, topic or provision."
      />
      <form action={routes.search} className="search-form">
        <SearchBox
          id="legal-query"
          label="Search authorities"
          placeholder="Search by keyword, title or demonstration identifier"
          defaultValue={query.text}
        />
        <div className="search-layout">
          <aside className="search-rail" aria-label="Filters">
            <SearchFilters query={query} authorities={authorities} />
            <button type="submit" className="button secondary w-full">
              Apply filters
            </button>
            <Link className="text-link" href={routes.search}>
              Clear all filters
            </Link>
          </aside>
          <section aria-label="Search results" className="search-results">
            <div className="results-bar">
              <p className="results-label">
                {results.length} demonstration {results.length === 1 ? 'result' : 'results'} · Local
                fixture filtering only
              </p>
              {active.length > 0 || query.text ? (
                <ul className="filter-chips" aria-label="Active filters">
                  {query.text && (
                    <li>
                      <Link href={without('text')} aria-label="Remove search text">
                        “{query.text}” <X size={12} aria-hidden="true" />
                      </Link>
                    </li>
                  )}
                  {active.map((key) => (
                    <li key={key}>
                      <Link href={without(key)} aria-label={`Remove ${filterLabels[key]} filter`}>
                        {filterLabels[key]}: {query[key]} <X size={12} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="panel result-list">
              {results.length ? (
                results.map(({ authority, matchingPassageIds }) => (
                  <AuthorityCard
                    authority={authority}
                    key={authority.id}
                    passageCount={matchingPassageIds.length}
                  />
                ))
              ) : (
                <EmptyState
                  title="No demonstration authorities match"
                  description="Try another keyword or clear the filters. This preview searches only a handful of synthetic records."
                  href={routes.search}
                  action="Reset search"
                />
              )}
            </div>
          </section>
        </div>
      </form>
    </>
  );
}
