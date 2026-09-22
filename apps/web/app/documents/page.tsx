import { WorkspaceShell } from '../../components/workspace-shell';

import { WorkspaceCard } from '../../components/workspace-ui';

import { workspaceGet } from '../../lib/workspace-api';

interface MatterDocument {
  readonly id: string;

  readonly matterId: string;

  readonly name: string;

  readonly description: string | null;

  readonly status: string;
}

export default async function DocumentsPage() {
  const documents =
    (await workspaceGet<readonly MatterDocument[]>('/v1/workspace/documents')) ?? [];

  return (
    <WorkspaceShell
      eyebrow="Private knowledge"
      title="Documents"
      description="Real tenant-isolated matter document records from the Law Afrique database."
    >
      <WorkspaceCard
        title="Document library"
        description={`${documents.length} document${documents.length === 1 ? '' : 's'} available.`}
      >
        {documents.length === 0 ? (
          <div className="workspace-table-empty">
            <p>No documents yet.</p>

            <span>
              Matter documents created through the secure document domain will appear here.
            </span>
          </div>
        ) : (
          <div className="data-table">
            <div className="data-table-row data-table-head">
              <span>Document</span>

              <span>Matter</span>

              <span>Description</span>

              <span>Status</span>
            </div>

            {documents.map((document) => (
              <div key={document.id} className="data-table-row">
                <strong>{document.name}</strong>

                <span>{document.matterId}</span>

                <span>{document.description ?? '—'}</span>

                <span className="status-badge">{document.status}</span>
              </div>
            ))}
          </div>
        )}
      </WorkspaceCard>
    </WorkspaceShell>
  );
}
