import { CreateMatterForm } from '../../components/create-matter-form';

import { WorkspaceShell } from '../../components/workspace-shell';

import { WorkspaceCard } from '../../components/workspace-ui';

import { activeOrganization, workspaceGet } from '../../lib/workspace-api';

interface Matter {
  readonly id: string;

  readonly clientId: string;

  readonly name: string;

  readonly reference?: string | null;

  readonly status: string;
}

interface Client {
  readonly id: string;

  readonly name: string;
}

export default async function MattersPage() {
  const organization = await activeOrganization();

  const data =
    organization === null
      ? null
      : await workspaceGet<{
          readonly clients: readonly Client[];

          readonly matters: readonly Matter[];
        }>('/v1/workspace/matters');

  const clients = data?.clients ?? [];

  const matters = data?.matters ?? [];

  const clientNames = new Map(clients.map((client) => [String(client.id), client.name]));

  return (
    <WorkspaceShell
      eyebrow="Case workspace"
      title="Matters"
      description="Real tenant-isolated matters stored in the Law Afrique workspace."
      actions={<CreateMatterForm />}
    >
      {organization === null ? (
        <WorkspaceCard
          title="Organisation required"
          description="Your account does not yet have an active organisation membership."
        >
          <div className="workspace-table-empty">
            <p>No active organisation is available.</p>
          </div>
        </WorkspaceCard>
      ) : (
        <WorkspaceCard
          title={`All matters · ${organization.name}`}
          description={`${matters.length} matter${matters.length === 1 ? '' : 's'} in this organisation.`}
        >
          {matters.length === 0 ? (
            <div className="workspace-table-empty">
              <p>No matters yet.</p>

              <span>Use New matter to create your first real workspace matter.</span>
            </div>
          ) : (
            <div className="data-table">
              <div className="data-table-row data-table-head">
                <span>Matter</span>

                <span>Client</span>

                <span>Reference</span>

                <span>Status</span>
              </div>

              {matters.map((matter) => (
                <div key={matter.id} className="data-table-row">
                  <strong>{matter.name}</strong>

                  <span>{clientNames.get(String(matter.clientId)) ?? '—'}</span>

                  <span>{matter.reference ?? '—'}</span>

                  <span className="status-badge">{matter.status}</span>
                </div>
              ))}
            </div>
          )}
        </WorkspaceCard>
      )}
    </WorkspaceShell>
  );
}
