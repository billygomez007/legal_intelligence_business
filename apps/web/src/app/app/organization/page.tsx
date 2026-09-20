import Link from 'next/link';
import { CreditCard, DatabaseZap, FolderOpen, ShieldCheck, UserCog, Users } from 'lucide-react';
import { PageHeader } from '../../../components/ui/primitives';
import { ResearchStatusLabel } from '../../../components/ui/status';
import { webClients } from '../../../data/mock-clients';
import { routes } from '../../../lib/routes';

export const metadata = { title: 'Organization' };

const sections = [
  { id: 'members', label: 'Members' },
  { id: 'roles', label: 'Roles' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'knowledge', label: 'Private knowledge' },
  { id: 'billing', label: 'Billing' },
  { id: 'security', label: 'Security' },
];

export default async function OrganizationPage() {
  const [workspace, projects] = await Promise.all([
    webClients.workspace.overview(),
    webClients.research.list(),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Firm workspace"
        title="Organization"
        description={`${workspace.profile.organisationType} · Example workspace · Organization management preview`}
      />
      <div className="notice">
        <div>
          <strong>Administration is not connected</strong>
          <p>
            Everything below is illustrative. No permissions, tenant access or identity checks are
            implemented here.
          </p>
        </div>
      </div>
      <nav className="anchor-nav" aria-label="Organization sections">
        <ul>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="org-sections">
        <section id="members" className="org-section" aria-labelledby="members-title">
          <h2 id="members-title">
            <Users size={18} aria-hidden="true" /> Members
          </h2>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Example organization members</caption>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {workspace.members.map((member) => (
                  <tr key={member.email}>
                    <td>{member.name}</td>
                    <td>{member.email}</td>
                    <td>{member.role}</td>
                    <td>
                      <span
                        className={`status ${member.status === 'Active' ? 'success' : 'warning'}`}
                      >
                        {member.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section id="roles" className="org-section" aria-labelledby="roles-title">
          <h2 id="roles-title">
            <UserCog size={18} aria-hidden="true" /> Roles
          </h2>
          <ul className="role-grid">
            {workspace.roles.map((role) => (
              <li className="panel panel-padded" key={role.name}>
                <h3>{role.name}</h3>
                <p className="muted">{role.summary}</p>
              </li>
            ))}
          </ul>
          <p className="micro">Role names are labels only. They grant no permissions here.</p>
        </section>
        <section id="workspaces" className="org-section" aria-labelledby="workspaces-title">
          <h2 id="workspaces-title">
            <FolderOpen size={18} aria-hidden="true" /> Workspaces
          </h2>
          <div className="panel panel-padded">
            <ul className="row-list">
              {projects.map((project) => (
                <li className="list-row simple" key={project.id}>
                  <Link className="row-title" href={routes.researchProject(project.id)}>
                    {project.title}
                  </Link>
                  <ResearchStatusLabel status={project.status} />
                </li>
              ))}
            </ul>
            <p className="micro panel-note">
              Example research projects. No private workspace has been provisioned.
            </p>
          </div>
        </section>
        <div className="org-pair">
          <section id="knowledge" className="org-section" aria-labelledby="knowledge-title">
            <h2 id="knowledge-title">
              <DatabaseZap size={18} aria-hidden="true" /> Private knowledge
            </h2>
            <div className="empty-state">
              <p>
                Private document upload and tenant-isolated retrieval are not connected. This
                preview contains only public synthetic fixtures.
              </p>
            </div>
          </section>
          <section id="billing" className="org-section" aria-labelledby="billing-title">
            <h2 id="billing-title">
              <CreditCard size={18} aria-hidden="true" /> Billing
            </h2>
            <div className="empty-state">
              <p>Subscriptions, payments and billing administration are not connected.</p>
            </div>
          </section>
        </div>
        <section id="security" className="org-section" aria-labelledby="security-title">
          <h2 id="security-title">
            <ShieldCheck size={18} aria-hidden="true" /> Security
          </h2>
          <div className="empty-state">
            <p>
              Access policies, audit logs and session management will be provided by platform
              services. None is active in this demonstration.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
