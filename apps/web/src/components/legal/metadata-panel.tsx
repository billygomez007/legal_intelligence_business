import type { ReactNode } from 'react';
import { LayerPanel } from './layer';

export interface MetadataItem {
  label: string;
  value: ReactNode;
}

/** Structured metadata as a labelled definition list, visually separate from source and synthesis. */
export function MetadataPanel({ items, title }: { items: MetadataItem[]; title?: string }) {
  return (
    <LayerPanel layer="metadata" detail="demonstration" className="metadata-panel">
      {title ? <h2 className="layer-title">{title}</h2> : null}
      <dl className="metadata-grid">
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </LayerPanel>
  );
}
