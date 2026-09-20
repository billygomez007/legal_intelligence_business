import Link from 'next/link';
import { Banknote, Clock3, Plus, ReceiptText } from 'lucide-react';
import { notFound } from 'next/navigation';

import { getMatterWorkspace } from '../../../../../data/matter-workspace';

export default async function MatterBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  const totalHours = matter.billing.reduce((sum, entry) => sum + entry.hours, 0);
  const totalAmount = matter.billing.reduce((sum, entry) => sum + entry.amount, 0);

  return (
    <>
      <section className="matter-section-header">
        <div>
          <p className="eyebrow">CLIENT BILLING · DEMONSTRATION</p>
          <h2>Client billing</h2>
          <p className="muted">
            Matter-level time and fee records. This is separate from the firm&apos;s LexGhana
            subscription billing.
          </p>
        </div>

        <button className="button" type="button" disabled>
          <Plus size={15} aria-hidden="true" />
          Add time entry
        </button>
      </section>

      <div className="matter-billing-summary">
        <article className="matter-metric">
          <Clock3 size={18} aria-hidden="true" />
          <strong>{totalHours.toFixed(1)}</strong>
          <span>Demo hours</span>
        </article>

        <article className="matter-metric">
          <Banknote size={18} aria-hidden="true" />
          <strong>GHS {totalAmount.toFixed(2)}</strong>
          <span>Demo unbilled amount</span>
        </article>

        <article className="matter-metric">
          <ReceiptText size={18} aria-hidden="true" />
          <strong>0</strong>
          <span>Live invoices</span>
        </article>
      </div>

      <div className="table-scroll mt-6">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Professional</th>
              <th>Hours</th>
              <th>Rate</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {matter.billing.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.date}</td>
                <td>{entry.description}</td>
                <td>{entry.professional}</td>
                <td>{entry.hours.toFixed(1)}</td>
                <td>GHS {entry.rate.toFixed(2)}</td>
                <td>GHS {entry.amount.toFixed(2)}</td>
                <td>
                  <span className="demo-badge">{entry.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="notice mt-6">
        <Banknote size={19} aria-hidden="true" />
        <div>
          <strong>Client billing and LexGhana subscription billing are separate.</strong>
          <p className="micro">
            This tab is for a law firm&apos;s own matter fees and time entries. The Billing &
            Subscription workspace manages what the firm pays LexGhana.
          </p>
        </div>
      </div>

      <Link className="text-link mt-4" href="/app/billing">
        Go to LexGhana Billing & Subscription
      </Link>
    </>
  );
}
