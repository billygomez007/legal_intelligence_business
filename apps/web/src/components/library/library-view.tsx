'use client';

import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { LegalAuthority, Passage } from '../../data/types';
import { formatShortDate } from '../../lib/format';
import { routes } from '../../lib/routes';
import { authorityHref, RightsBadge, SourcePassage, VerificationBadge } from '../legal';
import { EmptyState } from '../ui/primitives';

export interface SavedPassage {
  passage: Passage;
  authority: LegalAuthority;
  projectTitle: string;
}

type TabId = 'cases' | 'legislation' | 'passages' | 'reports';
type SortId = 'title' | 'date';

const tabOrder: readonly { id: TabId; label: string }[] = [
  { id: 'cases', label: 'Cases' },
  { id: 'legislation', label: 'Legislation' },
  { id: 'passages', label: 'Passages' },
  { id: 'reports', label: 'Research reports' },
];

/**
 * Saved research, by kind. A WAI-ARIA tab list with roving focus, plus a filter and sort shell.
 * Nothing here is persisted; the data is a read-only demonstration collection.
 */
export function LibraryView({
  authorities,
  passages,
}: {
  authorities: LegalAuthority[];
  passages: SavedPassage[];
}) {
  const [tab, setTab] = useState<TabId>('cases');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortId>('title');
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const needle = filter.trim().toLowerCase();
  const matches = (...values: string[]) =>
    !needle || values.some((value) => value.toLowerCase().includes(needle));

  const authoritiesOfKind = (kind: LegalAuthority['kind']) =>
    authorities
      .filter((a) => a.kind === kind)
      .filter((a) => matches(a.title, a.identifier, a.practiceArea, a.source))
      .sort((a, b) =>
        sort === 'title' ? a.title.localeCompare(b.title) : b.date.localeCompare(a.date),
      );
  const cases = authoritiesOfKind('case');
  const legislation = authoritiesOfKind('legislation');
  const visiblePassages = passages
    .filter((p) => matches(p.passage.text, p.authority.title, p.projectTitle))
    .sort((a, b) => a.authority.title.localeCompare(b.authority.title));

  const counts: Record<TabId, number> = {
    cases: authorities.filter((a) => a.kind === 'case').length,
    legislation: authorities.filter((a) => a.kind === 'legislation').length,
    passages: passages.length,
    reports: 0,
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = tabOrder.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabOrder.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabOrder.length) % tabOrder.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    const target = next === undefined ? undefined : tabOrder[next];
    if (!target) return;
    event.preventDefault();
    setTab(target.id);
    tabRefs.current[target.id]?.focus();
  };

  const table = (items: LegalAuthority[]) =>
    items.length ? (
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Saved authorities</caption>
          <thead>
            <tr>
              <th scope="col">Authority</th>
              <th scope="col">Court / source</th>
              <th scope="col">Date</th>
              <th scope="col">Verification</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link className="table-link" href={authorityHref(a)}>
                    {a.title}
                  </Link>
                  <span className="identifier block">{a.identifier}</span>
                </td>
                <td>{a.source}</td>
                <td>
                  <time dateTime={a.date}>{formatShortDate(a.date)}</time>
                </td>
                <td>
                  <VerificationBadge state={a.verification} />
                </td>
                <td>
                  <RightsBadge state={a.rights} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <EmptyState
        title="Nothing matches"
        description="Clear the filter to see everything saved in this section."
      />
    );

  return (
    <>
      <div className="library-toolbar">
        <div role="tablist" aria-label="Saved content" className="segmented">
          {tabOrder.map(({ id, label }, index) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${baseId}-panel`}
              tabIndex={tab === id ? 0 : -1}
              ref={(element) => {
                tabRefs.current[id] = element;
              }}
              onClick={() => {
                setTab(id);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
            >
              {label}
              <span className="segmented-count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="library-controls">
          <label className="field">
            <span className="sr-only">Filter saved items</span>
            <input
              type="search"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              placeholder="Filter saved items…"
              maxLength={200}
            />
          </label>
          <label className="field">
            <span className="sr-only">Sort by</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as SortId);
              }}
            >
              <option value="title">Title A–Z</option>
              <option value="date">Authority date, newest first</option>
            </select>
          </label>
        </div>
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        tabIndex={0}
        className="library-panel"
      >
        {tab === 'cases' && table(cases)}
        {tab === 'legislation' && table(legislation)}
        {tab === 'passages' &&
          (visiblePassages.length ? (
            <div className="stack">
              <p className="micro">
                Saved passages are shown as primary source, separate from any summary.
              </p>
              {visiblePassages.map(({ passage, authority, projectTitle }) => (
                <div key={passage.id} className="saved-passage">
                  <SourcePassage passage={passage} />
                  <p className="micro">
                    From{' '}
                    <Link className="text-link" href={routes.source(authority.id, passage.id)}>
                      {authority.title}
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </Link>{' '}
                    · saved in {projectTitle}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No saved passages"
              description="Passages saved to a research project will appear here."
            />
          ))}
        {tab === 'reports' && (
          <EmptyState
            title="No research reports yet"
            description="Report generation and export will be connected in a later stage."
          />
        )}
      </div>
    </>
  );
}
