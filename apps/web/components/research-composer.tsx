'use client';

import { useState } from 'react';

export function ResearchComposer() {
  const [question, setQuestion] = useState('');

  const [taskId, setTaskId] = useState('');

  const [working, setWorking] = useState(false);

  const [result, setResult] = useState<unknown>(null);

  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div className="research-composer">
        <div className="research-composer-label">Grounded legal research</div>

        <input
          className="research-task-input"
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
          placeholder="Authorized AI Task ID"
        />

        <textarea
          className="research-textarea"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a Ghana legal research question..."
          rows={6}
        />

        <div className="research-composer-footer">
          <span>Authorized evidence only · Human review required</span>

          <button
            type="button"
            className="button-primary"
            disabled={working || taskId.trim().length === 0 || question.trim().length === 0}
            onClick={async () => {
              setWorking(true);

              setError(null);

              setResult(null);

              const response = await fetch(
                '/api/research',

                {
                  method: 'POST',

                  headers: {
                    'content-type': 'application/json',
                  },

                  body: JSON.stringify({
                    taskId: taskId.trim(),

                    question: question.trim(),
                  }),
                },
              );

              const body = await response.json().catch(() => null);

              if (!response.ok) {
                setError(body?.error?.code ?? 'Research request failed.');

                setWorking(false);

                return;
              }

              setResult(body?.data ?? body);

              setWorking(false);
            }}
          >
            {working ? 'Researching…' : 'Research'}
          </button>
        </div>
      </div>

      {error && <div className="workspace-error">{error}</div>}

      {result !== null && (
        <section className="research-result">
          <div className="workspace-eyebrow">Research result</div>

          <pre>{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
    </>
  );
}
