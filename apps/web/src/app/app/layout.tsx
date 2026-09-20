import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '../../components/shell/app-shell';
import { webClients } from '../../data/mock-clients';

export const metadata: Metadata = {
  title: { default: 'Workspace', template: '%s | LexGhana' },
};

/** Everything under /app is the authenticated research application and shares this shell. */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { profile } = await webClients.workspace.overview();
  return <AppShell profile={profile}>{children}</AppShell>;
}
