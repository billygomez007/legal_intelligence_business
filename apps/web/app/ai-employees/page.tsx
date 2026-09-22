import { WorkspaceShell } from '../../components/workspace-shell';

import { WorkspaceCard } from '../../components/workspace-ui';

const employees = [
  {
    name: 'Research Associate',
    role: 'Legal research and evidence-grounded analysis',
  },

  {
    name: 'Legal Assistant',
    role: 'Matter support, drafting preparation and organization',
  },

  {
    name: 'Document Analyst',
    role: 'Document review and structured legal information',
  },

  {
    name: 'Practice Assistant',
    role: 'Operational support across the legal workspace',
  },
] as const;

export default function AiEmployeesPage() {
  return (
    <WorkspaceShell
      eyebrow="AI workforce"
      title="AI Employees"
      description="Your Law Afrique AI legal team, operating inside organization and human-review boundaries."
    >
      <div className="ai-employee-grid">
        {employees.map((employee) => (
          <WorkspaceCard key={employee.name} title={employee.name} description={employee.role}>
            <div className="feature-status-indicator">
              <span />
              Foundation ready
            </div>

            <p className="feature-card-note">
              Live task execution will be connected through authorized AI Tasks and the grounded
              research/work-product pipeline.
            </p>
          </WorkspaceCard>
        ))}
      </div>
    </WorkspaceShell>
  );
}
