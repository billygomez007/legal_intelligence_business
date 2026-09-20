'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import type { LegalAnswer as LegalAnswerModel, SourceReference } from '../data/types';
import { LayerLegend, LegalAnswer, SourceCard } from './legal';
import { researchScopes } from './search/research-scopes';
import { Button, EmptyState } from './ui/primitives';

export function AskWorkbench({
  initialQuestion,
  initialScopes = [],
  answer,
  sources,
}: {
  initialQuestion: string;
  initialScopes?: string[];
  answer: LegalAnswerModel;
  sources: SourceReference[];
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [submitted, setSubmitted] = useState(false);
  const [showExample, setShowExample] = useState(false);
  return (
    <>
      <form
        className="panel ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          setShowExample(false);
        }}
      >
        <label className="field">
          <span>Your research question</span>
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
        <fieldset className="pill-group">
          <legend className="sr-only">Research scope</legend>
          {researchScopes.map(({ value, label, icon: Icon }) => (
            <label className="pill" key={value}>
              <input
                type="checkbox"
                name="scope"
                value={value}
                defaultChecked={initialScopes.includes(value)}
              />
              <Icon size={16} aria-hidden="true" />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="ask-form-foot">
          <Button type="submit" className="lg">
            <Search size={16} aria-hidden="true" />
            Preview research workflow
          </Button>
          <p className="micro">
            No AI or live retrieval is connected. Do not enter confidential material.
          </p>
        </div>
      </form>
      {submitted && (
        <div role="status" className="notice">
          <div>
            <strong>No legal answer was generated</strong>
            <p>
              Research is not connected. The example below is fixed demonstration content and is
              unrelated to your question.
            </p>
          </div>
        </div>
      )}
      <LayerLegend />
      <div className="reading-layout">
        <div className="reading-main">
          <h2 className="sr-only">Answer</h2>
          {showExample ? (
            <LegalAnswer answer={answer} />
          ) : (
            <EmptyState
              title="Your source-grounded answer will appear here"
              description="The future experience will present a concise answer, reasoning, authorities and caveats after approved-source retrieval."
            />
          )}
          <Button
            className="secondary"
            onClick={() => {
              setShowExample((value) => !value);
            }}
          >
            {showExample ? 'Hide fixed example' : 'View fixed demonstration answer'}
          </Button>
        </div>
        <aside className="source-rail" aria-label="Source documents">
          <h2 className="rail-title">{showExample ? 'Example sources' : 'Source documents'}</h2>
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
