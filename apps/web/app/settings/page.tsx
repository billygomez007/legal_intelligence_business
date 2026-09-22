import { WorkspaceShell } from '../../components/workspace-shell';

import { WorkspaceCard } from '../../components/workspace-ui';

export default function SettingsPage() {
  return (
    <WorkspaceShell
      eyebrow="Administration"
      title="Settings"
      description="Manage the organisation, members, security and workspace configuration."
    >
      <div className="settings-grid">
        <WorkspaceCard
          title="Organisation"
          description="Organisation profile and workspace information."
        >
          <div className="settings-placeholder">Organisation settings</div>
        </WorkspaceCard>

        <WorkspaceCard
          title="Members & roles"
          description="Workspace membership and role-based access."
        >
          <div className="settings-placeholder">Member management</div>
        </WorkspaceCard>

        <WorkspaceCard title="Security" description="Authentication and session security.">
          <div className="settings-security-list">
            <div>
              <span>Google identity</span>

              <strong>Active</strong>
            </div>

            <div>
              <span>HttpOnly session</span>

              <strong>Active</strong>
            </div>

            <div>
              <span>Cryptographic validation</span>

              <strong>Active</strong>
            </div>
          </div>
        </WorkspaceCard>

        <WorkspaceCard title="Jurisdictions" description="Authorised legal research jurisdictions.">
          <div className="settings-placeholder">Jurisdiction configuration</div>
        </WorkspaceCard>
      </div>
    </WorkspaceShell>
  );
}
