import { DocumentManager } from '../../components/document-manager';

import { WorkspaceShell } from '../../components/workspace-shell';

import { workspaceGet } from '../../lib/workspace-api';

interface Matter {
  readonly id: string;

  readonly name: string;

  readonly reference?: string | null;
}

interface MatterDocument {
  readonly id: string;

  readonly matterId: string;

  readonly name: string;

  readonly description: string | null;

  readonly status: string;

  readonly versionCount: number;

  readonly latestVersionNumber: number | null;
}

interface DocumentWorkspace {
  readonly documents: readonly MatterDocument[];

  readonly matters: readonly Matter[];
}

export default async function DocumentsPage() {
  const data = await workspaceGet<DocumentWorkspace>('/v1/workspace/documents');

  return (
    <WorkspaceShell
      eyebrow="Private knowledge"
      title="Documents"
      description="Secure tenant-isolated document records attached to your legal matters."
    >
      <DocumentManager documents={data?.documents ?? []} matters={data?.matters ?? []} />
    </WorkspaceShell>
  );
}
