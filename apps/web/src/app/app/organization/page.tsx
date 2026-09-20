import Link from 'next/link';
import { EmptyState, PageHeader } from '../../../components/ui/primitives';
import { webClients } from '../../../data/mock-clients';
import { routes } from '../../../lib/routes';
export const metadata = { title: 'Organization' };
export default async function OrganizationPage() {
  const workspace = await webClients.workspace.overview();
  return (
    <>
      <PageHeader
        eyebrow="FIRM WORKSPACE"
        title="Organization"
        description="Example workspace · Organization management preview"
      />
      <div className="notice mb-6">
        <div>
          <strong>Administration is not connected</strong>
          <p>
            Roles below are illustrative labels. No permissions, tenant access or identity checks
            are implemented here.
          </p>
        </div>
      </div>
      <section>
        <h2 className="mb-4">Members & roles</h2>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Example organization members</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {workspace.members.map((member) => (
                <tr key={member.email}>
                  <td>{member.name}</td>
                  <td>{member.email}</td>
                  <td>{member.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="settings-grid mt-6">
        <section className="panel panel-padded">
          <h2>Workspaces</h2>
          <p className="micro mb-4">
            Preview the example research projects. No private workspace has been provisioned.
          </p>
          <Link className="text-link" href={routes.research}>
            Open research projects
          </Link>
        </section>
        <section>
          <EmptyState
            title="Private knowledge"
            description="Private document upload and tenant-isolated retrieval are not connected. This preview contains only public synthetic fixtures."
          />
        </section>
        <section>
          <EmptyState
            title="Billing"
            description="Subscriptions, payments and billing administration are not connected."
          />
        </section>
        <section>
          <EmptyState
            title="Security"
            description="Access policies, audit logs and session management will be provided by platform services."
          />
        </section>
      </div>
    </>
  );
}
