import { LayerLabel, layerMeta, type EvidenceLayer } from '../legal/layer';

const order: readonly EvidenceLayer[] = ['source', 'synthesis', 'metadata', 'note'];

/** The four evidence layers, shown as the stacked system the product is built around. */
export function TrustLayers() {
  return (
    <ol className="m-layers" aria-label="The four layers of a research answer">
      {order.map((layer) => (
        <li key={layer} className="layer" data-layer={layer}>
          <div className="layer-head">
            <LayerLabel layer={layer} />
          </div>
          <p>{layerMeta[layer].description}</p>
        </li>
      ))}
    </ol>
  );
}
