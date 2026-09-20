import type { ReactNode } from 'react';
import { ListTree, PenLine, ScrollText, Sparkles, type LucideIcon } from 'lucide-react';

/**
 * The four kinds of content a legal research screen can show. They are presented differently on
 * purpose (colour, label, icon and border style) so a reader can never mistake a generated
 * summary for source text, or their own note for an authority.
 */
export type EvidenceLayer = 'source' | 'synthesis' | 'metadata' | 'note';

export const layerMeta: Record<
  EvidenceLayer,
  { label: string; icon: LucideIcon; description: string }
> = {
  source: {
    label: 'Primary source',
    icon: ScrollText,
    description: 'The text of the underlying document, shown as written.',
  },
  synthesis: {
    label: 'AI synthesis',
    icon: Sparkles,
    description: 'A generated or derived summary. It is not the source.',
  },
  metadata: {
    label: 'Structured metadata',
    icon: ListTree,
    description: 'Extracted fields such as court, date and citation.',
  },
  note: {
    label: 'User note',
    icon: PenLine,
    description: 'Your own writing. Never treated as an authority.',
  },
};

const order: readonly EvidenceLayer[] = ['source', 'synthesis', 'metadata', 'note'];

export function LayerLabel({
  layer,
  label,
  detail,
}: {
  layer: EvidenceLayer;
  label?: string;
  detail?: string;
}) {
  const { icon: Icon, label: defaultLabel } = layerMeta[layer];
  return (
    <span className="layer-label" data-layer={layer}>
      <Icon size={14} aria-hidden="true" />
      <span>
        {label ?? defaultLabel}
        {detail ? ` · ${detail}` : ''}
      </span>
    </span>
  );
}

/** A labelled container for one layer of content. Pass `ariaLabel` to expose it as a region. */
export function LayerPanel({
  layer,
  label,
  detail,
  ariaLabel,
  id,
  className = '',
  children,
}: {
  layer: EvidenceLayer;
  label?: string;
  detail?: string;
  ariaLabel?: string;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const Tag = ariaLabel ? 'section' : 'div';
  return (
    <Tag
      className={`layer ${className}`}
      data-layer={layer}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      {...(id ? { id } : {})}
    >
      <div className="layer-head">
        <LayerLabel layer={layer} {...(label ? { label } : {})} {...(detail ? { detail } : {})} />
      </div>
      {children}
    </Tag>
  );
}

/** A compact key explaining the four layers, shown wherever more than one appears. */
export function LayerLegend() {
  return (
    <dl className="layer-legend" aria-label="How to read this page">
      {order.map((layer) => (
        <div key={layer} data-layer={layer}>
          <dt>
            <LayerLabel layer={layer} />
          </dt>
          <dd>{layerMeta[layer].description}</dd>
        </div>
      ))}
    </dl>
  );
}
