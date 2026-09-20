import { TriangleAlert } from 'lucide-react';
import type { LegalAnswer as LegalAnswerModel } from '../../data/types';
import { LayerPanel } from './layer';
import { LegalCitation } from './citation';

/** The AI synthesis layer. Always labelled, and always states whether a model actually ran. */
export function LegalAnswer({ answer }: { answer: LegalAnswerModel }) {
  return (
    <LayerPanel
      layer="synthesis"
      detail="fixed demonstration · no model run"
      ariaLabel="AI synthesis example"
      className="synthesis"
    >
      <h2 className="layer-title">Example research answer</h2>
      <p>{answer.answerText}</p>
      <h3>Legal reasoning</h3>
      <p>{answer.reasoning}</p>
      <h3>Authorities</h3>
      <div>
        {answer.citations.map((citation) => (
          <LegalCitation key={citation.label} citation={citation} />
        ))}
      </div>
      <div className="caveat">
        <h3>
          <TriangleAlert size={15} aria-hidden="true" /> Caveats & limitations
        </h3>
        <p>{answer.caveats}</p>
      </div>
      <details className="audit-details">
        <summary>Research trace</summary>
        <dl>
          <dt>Model / version</dt>
          <dd>
            {answer.model} / {answer.modelVersion}
          </dd>
          <dt>Retrieval IDs</dt>
          <dd>
            {answer.retrievalIds.length
              ? answer.retrievalIds.join(', ')
              : 'None; retrieval has not run'}
          </dd>
          <dt>Source documents</dt>
          <dd>{answer.sourceDocumentIds.join(', ')}</dd>
          <dt>Source passages</dt>
          <dd>{answer.sourcePassageIds.join(', ')}</dd>
          <dt>Example creation time</dt>
          <dd>{answer.createdAt}</dd>
          <dt>Verification</dt>
          <dd>{answer.verification}</dd>
        </dl>
      </details>
    </LayerPanel>
  );
}
