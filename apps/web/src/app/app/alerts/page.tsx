import { AlertManager } from '../../../components/alerts/alert-manager';
import { PageHeader } from '../../../components/ui/primitives';
import { webClients } from '../../../data/mock-clients';

export const metadata = { title: 'Alerts' };

export default async function AlertsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Follow the developments"
        title="Legal alerts"
        description="Preview topic, case, legislation and regulatory watches. Demonstration state only."
      />
      <AlertManager initialAlerts={await webClients.alerts.list()} />
    </>
  );
}
