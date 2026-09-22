'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

export function CreateMatterForm() {
  const router = useRouter();

  const [open, setOpen] = useState(false);

  const [working, setWorking] = useState(false);

  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="button-primary" onClick={() => setOpen(true)}>
        New matter
      </button>
    );
  }

  return (
    <form
      className="inline-create-form"
      onSubmit={async (event) => {
        event.preventDefault();

        setWorking(true);

        setError(null);

        const form = new FormData(event.currentTarget);

        const response = await fetch(
          '/api/workspace?resource=matters',

          {
            method: 'POST',

            headers: {
              'content-type': 'application/json',
            },

            body: JSON.stringify({
              clientName: form.get('clientName'),

              name: form.get('name'),

              reference: form.get('reference'),
            }),
          },
        );

        if (!response.ok) {
          const body = await response.json().catch(() => null);

          setError(body?.error?.code ?? 'Unable to create matter.');

          setWorking(false);

          return;
        }

        setWorking(false);

        setOpen(false);

        router.refresh();
      }}
    >
      <input name="clientName" placeholder="Client name" required />

      <input name="name" placeholder="Matter name" required />

      <input name="reference" placeholder="Reference (optional)" />

      {error && <span className="form-error">{error}</span>}

      <div className="inline-create-actions">
        <button type="button" className="button-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>

        <button type="submit" className="button-primary" disabled={working}>
          {working ? 'Creating…' : 'Create matter'}
        </button>
      </div>
    </form>
  );
}
