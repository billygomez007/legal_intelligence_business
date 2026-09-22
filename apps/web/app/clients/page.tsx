import { ClientManager } from '../../components/client-manager';

import { WorkspaceShell } from '../../components/workspace-shell';

import { workspaceGet } from '../../lib/workspace-api';

interface Client {
  readonly id: string;

  readonly name: string;

  readonly reference: string | null;

  readonly status: 'active' | 'archived';
}

export default async function ClientsPage() {
  const clients = (await workspaceGet<readonly Client[]>('/v1/workspace/clients')) ?? [];

  return (
    <WorkspaceShell
      eyebrow="Practice management"
      title="Clients"
      description="Manage the real client records connected to this organization."
    >
      <ClientManager clients={clients} />
    </WorkspaceShell>
  );
}
