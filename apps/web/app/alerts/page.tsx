import { FeatureStatusPage } from '../../components/feature-status-page';

export default function AlertsPage() {
  return (
    <FeatureStatusPage
      eyebrow="Monitoring"
      title="Alerts"
      description="Track legal, matter and workspace changes that need attention."
      capability="Legal alerts"
    />
  );
}
