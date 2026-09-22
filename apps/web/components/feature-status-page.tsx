import { WorkspaceShell } from './workspace-shell';

import { WorkspaceCard } from './workspace-ui';

export interface FeatureStatusPageProps {
  readonly eyebrow: string;

  readonly title: string;

  readonly description: string;

  readonly capability: string;

  readonly statusText?: string;
}

export function FeatureStatusPage({
  eyebrow,
  title,
  description,
  capability,
  statusText = 'Workspace foundation is available. The live workflow for this module is being connected to the Law Afrique backend.',
}: FeatureStatusPageProps) {
  return (
    <WorkspaceShell eyebrow={eyebrow} title={title} description={description}>
      <WorkspaceCard title={capability} description={statusText}>
        <div className="feature-status-panel">
          <div className="feature-status-indicator">
            <span />
            Workspace module
          </div>

          <p>
            This area is part of the authenticated Law Afrique product shell. It will use the same
            organization, membership, permissions and tenant-isolation model as Matters and Legal
            Research.
          </p>
        </div>
      </WorkspaceCard>
    </WorkspaceShell>
  );
}
