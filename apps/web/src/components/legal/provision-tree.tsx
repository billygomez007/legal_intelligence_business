'use client';

import Link from 'next/link';
import { useId, useRef } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import type { Legislation } from '../../data/types';
import { routes } from '../../lib/routes';

/**
 * Collapsible Part → Section tree. Built on native <details>, so every part is keyboard-operable and
 * announced correctly without custom key handling; the toolbar adds expand/collapse-all.
 */
export function ProvisionTree({
  authorityId,
  parts,
}: {
  authorityId: string;
  parts: Legislation['parts'];
}) {
  const titleId = useId();
  const panels = useRef<(HTMLDetailsElement | null)[]>([]);
  const setAll = (open: boolean) => {
    for (const panel of panels.current) if (panel) panel.open = open;
  };
  return (
    <section className="provision-tree" aria-labelledby={titleId}>
      <div className="provision-toolbar">
        <h2 id={titleId}>Parts & sections</h2>
        <div className="meta-row">
          <button
            type="button"
            className="button secondary sm"
            onClick={() => {
              setAll(true);
            }}
          >
            Expand all
          </button>
          <button
            type="button"
            className="button secondary sm"
            onClick={() => {
              setAll(false);
            }}
          >
            Collapse all
          </button>
        </div>
      </div>
      {parts.map((part, index) => (
        <details
          open
          key={part.title}
          ref={(element) => {
            panels.current[index] = element;
          }}
        >
          <summary>
            <ChevronRight className="tree-chevron" size={16} aria-hidden="true" />
            <span className="tree-title">{part.title}</span>
            <span className="tree-count">
              {part.provisions.length} {part.provisions.length === 1 ? 'section' : 'sections'}
            </span>
          </summary>
          <ul>
            {part.provisions.map((provision) => (
              <li key={provision.id}>
                <Link href={routes.source(authorityId, provision.passageId)}>
                  <span>
                    <strong>{provision.label}</strong> · {provision.heading}
                  </span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
