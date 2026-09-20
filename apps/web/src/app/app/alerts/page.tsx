import { AlertManager } from '../../../components/demo-interactions';
import { PageHeader } from '../../../components/ui/primitives';
import { webClients } from '../../../data/mock-clients';
export const metadata = { title: 'Alerts' };
export default async function AlertsPage() {
  return (
    <>
      <PageHeader
        eyebrow="FOLLOW THE DEVELOPMENTS"
        title="Legal alerts"
        description="Preview topic, case, legislation and regulatory watches."
      />
      <AlertManager initialAlerts={await webClients.alerts.list()} />
    </>
  );
}
