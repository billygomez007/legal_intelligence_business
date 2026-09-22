import { WorkspaceShell } from '../../components/workspace-shell';

import { WorkspaceCard } from '../../components/workspace-ui';

import { workspaceGet } from '../../lib/workspace-api';

interface Client {
  readonly id: string;

  readonly name: string;

  readonly reference?: string | null;

  readonly status?: string;
}

export default async function ClientsPage() {
  const data = await workspaceGet<{
    readonly clients: readonly Client[];

    readonly matters: readonly unknown[];
  }>('/v1/workspace/matters');

  const clients = data?.clients ?? [];

  return (
    <WorkspaceShell
      eyebrow="Practice management"
      title="Clients"
      description="Real organization-scoped client records used by your matters."
    >
      <WorkspaceCard
        title="Client directory"
        description={`${clients.length} client${clients.length === 1 ? '' : 's'} in this workspace.`}
      >
        {clients.length === 0 ? (
          <div className="workspace-table-empty">
            <p>No clients yet.</p>

            <span>A client is created when you create the first matter for that client.</span>
          </div>
        ) : (
          <div className="data-table">
            <div className="data-table-row data-table-head">
              <span>Client</span>

              <span>Reference</span>

              <span>Status</span>

              <span>Source</span>
            </div>

            {clients.map((client) => (
              <div key={client.id} className="data-table-row">
                <strong>{client.name}</strong>

                <span>{client.reference ?? '—'}</span>

                <span>{client.status ?? 'active'}</span>

                <span>Workspace</span>
              </div>
            ))}
          </div>
        )}
      </WorkspaceCard>
    </WorkspaceShell>
  );
}
