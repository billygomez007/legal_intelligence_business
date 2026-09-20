import { SettingsForm } from '../../../components/settings/settings-form';
import { PageHeader } from '../../../components/ui/primitives';
import { webClients } from '../../../data/mock-clients';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { profile } = await webClients.workspace.overview();
  return (
    <>
      <PageHeader
        eyebrow="Your workspace"
        title="Settings"
        description="Explore profile and preference controls. Changes are not persisted."
      />
      <SettingsForm profile={profile} />
    </>
  );
}
