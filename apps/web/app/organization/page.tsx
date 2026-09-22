import { WorkspaceShell } from '../../components/workspace-shell';

import { WorkspaceCard } from '../../components/workspace-ui';

import { activeOrganization } from '../../lib/workspace-api';

export default async function OrganizationPage() {
  const organization = await activeOrganization();

  return (
    <WorkspaceShell
      eyebrow="Workspace administration"
      title="Organization"
      description="Manage the organization that owns this Law Afrique workspace."
    >
      <WorkspaceCard
        title={organization?.name ?? 'Organization'}
        description="Current authenticated organization"
      >
        <div className="principles-list">
          <div>
            <strong>Workspace type</strong>

            <span>{organization?.kind ?? '—'}</span>
          </div>

          <div>
            <strong>Status</strong>

            <span>{organization?.status ?? '—'}</span>
          </div>

          <div>
            <strong>Workspace slug</strong>

            <span>{organization?.slug ?? '—'}</span>
          </div>
        </div>
      </WorkspaceCard>
    </WorkspaceShell>
  );
}
