import { WorkspaceShell } from '../../components/workspace-shell';

import { StatCard, WorkspaceCard } from '../../components/workspace-ui';

import { activeOrganization, workspaceGet } from '../../lib/workspace-api';

interface MatterData {
  readonly matters: readonly unknown[];
}

export default async function DashboardPage() {
  const organization = await activeOrganization();

  const [matterData, documents, workProducts, approvals] =
    organization === null
      ? [null, null, null, null]
      : await Promise.all([
          workspaceGet<MatterData>('/v1/workspace/matters'),

          workspaceGet<readonly unknown[]>('/v1/workspace/documents'),

          workspaceGet<readonly unknown[]>('/v1/workspace/work-products'),

          workspaceGet<readonly unknown[]>('/v1/workspace/approvals'),
        ]);

  return (
    <WorkspaceShell
      eyebrow="Workspace overview"
      title={organization === null ? 'Welcome to Law Afrique' : organization.name}
      description="Live workspace data from the tenant-isolated Law Afrique platform."
    >
      <div className="stats-grid">
        <StatCard
          label="Active matters"
          value={String(matterData?.matters.length ?? 0)}
          note="Real workspace records"
        />

        <StatCard
          label="Documents"
          value={String(documents?.length ?? 0)}
          note="Private matter material"
        />

        <StatCard
          label="Work products"
          value={String(workProducts?.length ?? 0)}
          note="Drafts and reviewed outputs"
        />

        <StatCard
          label="Pending approvals"
          value={String(approvals?.length ?? 0)}
          note="Human review queue"
        />
      </div>

      <WorkspaceCard
        title="Workspace status"
        description="Authentication, tenant authority and real database-backed product domains are connected."
      >
        <div className="principles-list">
          <div>
            <strong>Organisation</strong>

            <span>{organization?.name ?? 'No active organisation membership found'}</span>
          </div>

          <div>
            <strong>Session</strong>

            <span>HttpOnly browser session with server-side cryptographic validation</span>
          </div>

          <div>
            <strong>Tenant isolation</strong>

            <span>PostgreSQL RLS + IAM membership + permission checks</span>
          </div>
        </div>
      </WorkspaceCard>
    </WorkspaceShell>
  );
}
