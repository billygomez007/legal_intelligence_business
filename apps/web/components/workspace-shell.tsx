import type { ReactNode } from 'react';

import { redirect } from 'next/navigation';

import { activeOrganization } from '../lib/workspace-api';

import { validateLawAfriqueSession } from '../lib/server-session';

import { BrandMark } from './brand/brand-mark';

import { SignOutButton } from './sign-out-button';

import { WorkspaceNav } from './workspace-nav';

export interface WorkspaceShellProps {
  readonly eyebrow: string;

  readonly title: string;

  readonly description: string;

  readonly children: ReactNode;

  readonly actions?: ReactNode;
}

export async function WorkspaceShell({
  eyebrow,
  title,
  description,
  children,
  actions,
}: WorkspaceShellProps) {
  const authenticated = await validateLawAfriqueSession();

  if (!authenticated) {
    redirect('/sign-in');
  }

  const organization = await activeOrganization();

  if (organization === null) {
    redirect('/onboarding');
  }

  return (
    <div className="workspace-frame premium-workspace-frame">
      <aside className="workspace-sidebar premium-sidebar">
        <div className="premium-sidebar-inner">
          <header className="premium-sidebar-brand">
            <BrandMark href="/dashboard" priority variant="sidebar" />
          </header>

          <div className="premium-workspace-switcher">
            <span>Workspace</span>

            <strong>{organization.name}</strong>

            <small>{organization.kind}</small>
          </div>

          <WorkspaceNav />

          <footer className="premium-sidebar-footer">
            <div className="premium-secure-session">
              <span className="premium-secure-dot" />

              <span>Secure session</span>
            </div>

            <SignOutButton />

            <p className="premium-brand-line">
              <span>African Law.</span>

              <span>Deeper Insight.</span>

              <span>Greater Impact.</span>
            </p>
          </footer>
        </div>
      </aside>

      <main className="workspace-main premium-workspace-main">
        <header className="workspace-header">
          <div>
            <div className="workspace-eyebrow">{eyebrow}</div>

            <h1 className="workspace-title">{title}</h1>

            <p className="workspace-description">{description}</p>
          </div>

          {actions && <div className="workspace-header-actions">{actions}</div>}
        </header>

        <section className="workspace-content">{children}</section>
      </main>
    </div>
  );
}
