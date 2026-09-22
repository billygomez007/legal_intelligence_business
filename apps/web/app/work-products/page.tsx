import { WorkspaceShell } from '../../components/workspace-shell';

import { WorkspaceCard } from '../../components/workspace-ui';

import { workspaceGet } from '../../lib/workspace-api';

interface WorkProduct {
  readonly id: string;

  readonly title: string;

  readonly status: string;

  readonly currentRevisionNumber?: number | null;

  readonly updatedAt?: string;
}

export default async function WorkProductsPage() {
  const workProducts =
    (await workspaceGet<readonly WorkProduct[]>('/v1/workspace/work-products')) ?? [];

  return (
    <WorkspaceShell
      eyebrow="Professional output"
      title="Work Products"
      description="Real tenant work products with durable revision and review state."
    >
      <WorkspaceCard
        title="Work product library"
        description={`${workProducts.length} work product${workProducts.length === 1 ? '' : 's'} available.`}
      >
        {workProducts.length === 0 ? (
          <div className="workspace-table-empty">
            <p>No work products yet.</p>

            <span>Drafts and submitted legal work products will appear here.</span>
          </div>
        ) : (
          <div className="data-table">
            <div className="data-table-row data-table-head">
              <span>Work product</span>

              <span>Revision</span>

              <span>Status</span>

              <span>Updated</span>
            </div>

            {workProducts.map((product) => (
              <div key={product.id} className="data-table-row">
                <strong>{product.title}</strong>

                <span>{product.currentRevisionNumber ?? '—'}</span>

                <span className="status-badge">{product.status}</span>

                <span>{product.updatedAt ?? '—'}</span>
              </div>
            ))}
          </div>
        )}
      </WorkspaceCard>
    </WorkspaceShell>
  );
}
