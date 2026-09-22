import { ResearchComposer } from '../../components/research-composer';

import { WorkspaceShell } from '../../components/workspace-shell';

import { WorkspaceCard } from '../../components/workspace-ui';

export default function ResearchPage() {
  return (
    <WorkspaceShell
      eyebrow="Grounded intelligence"
      title="Legal Research"
      description="Run the existing authorised Law Afrique grounded-research workflow from the real workspace."
    >
      <ResearchComposer />

      <WorkspaceCard
        title="Research controls"
        description="Law Afrique research remains task-authorised, Ghana-scoped, evidence-grounded and subject to human review."
      >
        <div className="principles-list">
          <div>
            <strong>Tenant authority</strong>

            <span>
              Organisation scope is resolved server-side from the authenticated session and active
              membership.
            </span>
          </div>

          <div>
            <strong>Evidence provenance</strong>

            <span>Synthesis uses only authorised retrieval evidence.</span>
          </div>

          <div>
            <strong>Human review</strong>

            <span>AI-generated research remains non-authoritative.</span>
          </div>
        </div>
      </WorkspaceCard>
    </WorkspaceShell>
  );
}
