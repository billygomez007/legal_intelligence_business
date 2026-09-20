'use client';
import { useState } from 'react';
import type { LegalAnswer as LegalAnswerModel, SourceReference } from '../data/types';
import { LegalAnswer, SourceCard } from './legal';
import { Button, EmptyState } from './ui/primitives';
export function AskWorkbench({
  initialQuestion,
  answer,
  sources,
}: {
  initialQuestion: string;
  answer: LegalAnswerModel;
  sources: SourceReference[];
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [submitted, setSubmitted] = useState(false);
  const [showExample, setShowExample] = useState(false);
  return (
    <>
      <form
        className="panel panel-padded"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          setShowExample(false);
        }}
      >
        <label className="field">
          Your research question
          <textarea
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
              setSubmitted(false);
            }}
            required
            maxLength={1500}
            placeholder="Ask a legal research question..."
          />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit">Preview research workflow</Button>
          <p className="micro">
            No AI or live retrieval is connected. Do not enter confidential material.
          </p>
        </div>
      </form>
      {submitted && (
        <div role="status" className="notice mt-5">
          <div>
            <strong>No legal answer was generated</strong>
            <p>
              Research is not connected. The example below is fixed demonstration content and is
              unrelated to your question.
            </p>
          </div>
        </div>
      )}
      <div className="content-grid">
        <div>
          {showExample ? (
            <LegalAnswer answer={answer} />
          ) : (
            <EmptyState
              title="Your source-grounded answer will appear here"
              description="The future experience will present a concise answer, reasoning, authorities and caveats after approved-source retrieval."
            />
          )}
          <Button
            className="secondary mt-4"
            onClick={() => {
              setShowExample((value) => !value);
            }}
          >
            {showExample ? 'Hide fixed example' : 'View fixed demonstration answer'}
          </Button>
        </div>
        <aside className="source-rail" aria-label="Source documents">
          <h2 className="mb-4">{showExample ? 'Example sources' : 'Source documents'}</h2>
          {showExample ? (
            sources.map((source) => <SourceCard key={source.documentId} source={source} />)
          ) : (
            <EmptyState
              title="No sources retrieved"
              description="Source documents will remain separate from synthesis. Each source will expose its passage, version and verification status."
            />
          )}
        </aside>
      </div>
    </>
  );
}
