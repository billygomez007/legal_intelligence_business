import { Search } from 'lucide-react';
import { LayerLabel } from '../legal/layer';
import { DemoBadge } from '../legal/badges';
import { previewLabel } from '../../content/marketing';

/**
 * A static illustration of the product's central idea: an answer whose AI synthesis and primary
 * source are separate layers. It is presentational (hidden from assistive technology, with a text
 * caption instead) and every string in it is synthetic.
 */
export function ProductPreview() {
  return (
    <figure className="m-preview" aria-label={previewLabel}>
      <div className="m-preview-frame" aria-hidden="true">
        <div className="m-preview-bar">
          <span />
          <span />
          <span />
          <DemoBadge label={previewLabel} />
        </div>
        <div className="m-preview-body">
          <div className="m-preview-question">
            <Search size={16} />
            <span>How should contract authorities be organised?</span>
          </div>
          <div className="layer" data-layer="synthesis">
            <div className="layer-head">
              <LayerLabel layer="synthesis" detail="example, no model run" />
            </div>
            <p>
              This is where a generated summary would appear, always labelled and always separate
              from the source.
            </p>
          </div>
          <div className="layer" data-layer="source">
            <div className="layer-head">
              <LayerLabel layer="source" detail="synthetic fixture" />
            </div>
            <p className="m-preview-source">
              SYNTHETIC SOURCE TEXT. This fictional passage stands in for a real judgment.
            </p>
            <p className="micro">DEMO-CASE-001 · Version DEMO-v1 · Human reviewed · demo</p>
          </div>
        </div>
      </div>
      <figcaption className="micro">
        {previewLabel}: an example of how an answer keeps AI synthesis apart from primary source
        text. Synthetic content.
      </figcaption>
    </figure>
  );
}
