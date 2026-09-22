import { WorkspaceShell } from '../../components/workspace-shell';

import { WorkspaceCard } from '../../components/workspace-ui';

import { workspaceGet } from '../../lib/workspace-api';

interface ApprovalItem {
  readonly work_product_id: string;

  readonly title: string;

  readonly status: string;

  readonly current_revision_number: number | null;

  readonly updated_at: string;
}

export default async function ApprovalsPage() {
  const approvals = (await workspaceGet<readonly ApprovalItem[]>('/v1/workspace/approvals')) ?? [];

  return (
    <WorkspaceShell
      eyebrow="Human review"
      title="Approvals"
      description="Submitted legal work awaiting human review."
    >
      <WorkspaceCard
        title="Approval queue"
        description={`${approvals.length} item${approvals.length === 1 ? '' : 's'} awaiting review.`}
      >
        {approvals.length === 0 ? (
          <div className="workspace-table-empty">
            <p>Nothing awaiting approval.</p>

            <span>Submitted work products will appear here for authorised human review.</span>
          </div>
        ) : (
          <div className="data-table">
            <div className="data-table-row data-table-head">
              <span>Work product</span>

              <span>Revision</span>

              <span>Status</span>

              <span>Updated</span>
            </div>

            {approvals.map((item) => (
              <div key={item.work_product_id} className="data-table-row">
                <strong>{item.title}</strong>

                <span>{item.current_revision_number ?? '—'}</span>

                <span className="status-badge">{item.status}</span>

                <span>{String(item.updated_at)}</span>
              </div>
            ))}
          </div>
        )}
      </WorkspaceCard>
    </WorkspaceShell>
  );
}
