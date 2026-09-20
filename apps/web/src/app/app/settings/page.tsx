import { SettingsForm } from '../../../components/demo-interactions';
import { PageHeader } from '../../../components/ui/primitives';
export const metadata = { title: 'Settings' };
export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE"
        title="Settings"
        description="Explore profile and preference controls. Changes are not persisted."
      />
      <SettingsForm />
    </>
  );
}
