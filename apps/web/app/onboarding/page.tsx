import { redirect } from 'next/navigation';

import { OrganizationOnboardingForm } from '../../components/organization-onboarding-form';

import { activeOrganization } from '../../lib/workspace-api';

import { validateLawAfriqueSession } from '../../lib/server-session';

export default async function OnboardingPage() {
  const authenticated = await validateLawAfriqueSession();

  if (!authenticated) {
    redirect('/sign-in');
  }

  const existing = await activeOrganization();

  if (existing !== null) {
    redirect('/dashboard');
  }

  return (
    <main className="organization-onboarding-page">
      <section className="organization-onboarding-card">
        <div className="organization-onboarding-brand">
          <span className="workspace-brand-mark">LA</span>

          <div>
            <strong>Law Afrique</strong>

            <span>Legal Intelligence</span>
          </div>
        </div>

        <div className="workspace-eyebrow">Workspace setup</div>

        <h1>Create your organization</h1>

        <p className="organization-onboarding-description">
          Your matters, legal research, documents, AI employees, clients and billing will live
          inside this secure organization workspace.
        </p>

        <OrganizationOnboardingForm />
      </section>
    </main>
  );
}
