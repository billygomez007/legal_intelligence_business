'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

interface Client {
  readonly id: string;

  readonly name: string;

  readonly reference?: string | null;

  readonly status?: string;
}

export function ClientManager({ clients }: { readonly clients: readonly Client[] }) {
  const router = useRouter();

  const [name, setName] = useState('');

  const [reference, setReference] = useState('');

  const [working, setWorking] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function createClient() {
    setWorking(true);

    setError(null);

    const response = await fetch(
      '/api/workspace?resource=clients',

      {
        method: 'POST',

        headers: {
          'content-type': 'application/json',
        },

        body: JSON.stringify({
          name: name.trim(),

          reference: reference.trim(),
        }),
      },
    );

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setError(body?.error?.code ?? 'Unable to create client.');

      setWorking(false);

      return;
    }

    setName('');

    setReference('');

    setWorking(false);

    router.refresh();
  }

  async function toggleStatus(client: Client) {
    const nextStatus = client.status === 'archived' ? 'active' : 'archived';

    const response = await fetch(
      '/api/workspace?resource=clients',

      {
        method: 'PATCH',

        headers: {
          'content-type': 'application/json',
        },

        body: JSON.stringify({
          clientId: client.id,

          status: nextStatus,
        }),
      },
    );

    if (!response.ok) {
      setError('Unable to update client.');

      return;
    }

    router.refresh();
  }

  return (
    <div className="client-management-layout">
      <section className="workspace-card">
        <div className="workspace-card-heading">
          <div>
            <h2>Add client</h2>

            <p>Create a real client record inside this organization.</p>
          </div>
        </div>

        <form
          className="workspace-form"
          onSubmit={async (event) => {
            event.preventDefault();

            await createClient();
          }}
        >
          <label>
            <span>Client name</span>

            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Acme Ghana Ltd"
              minLength={2}
              required
            />
          </label>

          <label>
            <span>Reference</span>

            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="e.g. CLI-001"
            />
          </label>

          {error !== null && <div className="workspace-error">{error}</div>}

          <button
            type="submit"
            className="button-primary"
            disabled={working || name.trim().length < 2}
          >
            {working ? 'Creating…' : 'Create client'}
          </button>
        </form>
      </section>

      <section className="workspace-card">
        <div className="workspace-card-heading">
          <div>
            <h2>Client directory</h2>

            <p>
              {clients.length} client{clients.length === 1 ? '' : 's'} in this organization.
            </p>
          </div>
        </div>

        {clients.length === 0 ? (
          <div className="workspace-table-empty">No clients yet.</div>
        ) : (
          <div className="data-table">
            <div className="data-table-row data-table-head">
              <span>Client</span>

              <span>Reference</span>

              <span>Status</span>

              <span>Action</span>
            </div>

            {clients.map((client) => (
              <div key={client.id} className="data-table-row">
                <strong>{client.name}</strong>

                <span>{client.reference ?? '—'}</span>

                <span>{client.status ?? 'active'}</span>

                <button
                  type="button"
                  className="button-secondary compact-button"
                  onClick={() => void toggleStatus(client)}
                >
                  {client.status === 'archived' ? 'Reactivate' : 'Archive'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
