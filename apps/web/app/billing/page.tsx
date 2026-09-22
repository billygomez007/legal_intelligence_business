import { FeatureStatusPage } from '../../components/feature-status-page';

export default function BillingPage() {
  return (
    <FeatureStatusPage
      eyebrow="Subscription"
      title="Billing & Subscription"
      description="Manage the Law Afrique plan, subscription and organization billing."
      capability="Billing workspace"
      statusText="The billing interface is restored in the product shell. Live subscription and payment-provider integration will be connected separately."
    />
  );
}
