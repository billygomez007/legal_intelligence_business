import Link from 'next/link';
import { Building2, CheckCircle2, CreditCard, Download, ReceiptText, Users } from 'lucide-react';

export const metadata = {
  title: 'Billing & Subscription',
};

const invoices = [
  {
    id: 'DEMO-INV-001',
    date: '01 Sep 2026',
    amount: 'GHS 0.00',
    status: 'Demonstration',
  },
  {
    id: 'DEMO-INV-002',
    date: '01 Aug 2026',
    amount: 'GHS 0.00',
    status: 'Demonstration',
  },
];

export default function BillingPage() {
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>Billing & Subscription</h1>
          <p className="muted">Manage your LexGhana plan, seats, billing cycle and invoices.</p>
        </div>
      </section>

      <div className="settings-grid">
        <section className="panel panel-padded">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CURRENT PLAN</p>
              <h2>Professional Preview</h2>
            </div>

            <span className="demo-badge">Demonstration</span>
          </div>

          <p className="muted">
            Billing is not connected yet. This page shows the intended subscription experience only.
          </p>

          <div className="metadata-grid mt-5">
            <div>
              <dt>Plan</dt>
              <dd>Professional Preview</dd>
            </div>

            <div>
              <dt>Status</dt>
              <dd>Demonstration</dd>
            </div>

            <div>
              <dt>Billing cycle</dt>
              <dd>Monthly</dd>
            </div>

            <div>
              <dt>Next billing date</dt>
              <dd>Not active</dd>
            </div>
          </div>

          <div className="mt-5 flex gap-4 flex-wrap">
            <button className="button" type="button" disabled>
              Upgrade plan
            </button>

            <button className="button secondary" type="button" disabled>
              Manage subscription
            </button>
          </div>
        </section>

        <section className="panel panel-padded">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SEATS</p>
              <h2>Team access</h2>
            </div>

            <Users size={22} aria-hidden="true" />
          </div>

          <div className="activity-list">
            <div className="activity-item">
              <div>
                <strong>3</strong>
                <span>Seats included</span>
              </div>
            </div>

            <div className="activity-item">
              <div>
                <strong>1</strong>
                <span>Seat assigned</span>
              </div>
            </div>

            <div className="activity-item">
              <div>
                <strong>2</strong>
                <span>Seats available</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="settings-grid mt-6">
        <section className="panel panel-padded">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PAYMENT METHOD</p>
              <h2>Payment details</h2>
            </div>

            <CreditCard size={22} aria-hidden="true" />
          </div>

          <div className="empty-state">
            <CreditCard size={28} aria-hidden="true" />
            <h3>No payment method connected</h3>
            <p>Payment processing will be connected when subscription billing is implemented.</p>
          </div>
        </section>

        <section className="panel panel-padded">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ORGANIZATION</p>
              <h2>Billing entity</h2>
            </div>

            <Building2 size={22} aria-hidden="true" />
          </div>

          <div className="metadata-grid">
            <div>
              <dt>Workspace</dt>
              <dd>LexGhana Workspace</dd>
            </div>

            <div>
              <dt>Account type</dt>
              <dd>Law firm</dd>
            </div>

            <div>
              <dt>Billing country</dt>
              <dd>Ghana</dd>
            </div>

            <div>
              <dt>Currency</dt>
              <dd>GHS</dd>
            </div>
          </div>
        </section>
      </div>

      <section className="mt-6">
        <div className="section-heading">
          <div>
            <p className="eyebrow">INVOICES</p>
            <h2>Billing history</h2>
          </div>

          <ReceiptText size={20} aria-hidden="true" />
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th aria-label="Download" />
              </tr>
            </thead>

            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.id}</td>
                  <td>{invoice.date}</td>
                  <td>{invoice.amount}</td>
                  <td>
                    <span className="demo-badge">
                      <CheckCircle2 size={12} aria-hidden="true" />
                      {invoice.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      type="button"
                      disabled
                      aria-label={`Download ${invoice.id}`}
                    >
                      <Download size={15} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="micro mt-3">
          Demonstration billing records only. No payment processor or live subscription is
          connected.
        </p>
      </section>

      <section className="ghana-callout">
        <div>
          <p className="eyebrow">LEXGHANA FOR FIRMS</p>
          <h2>Need a larger workspace?</h2>
          <p>
            Future firm plans can support more researchers, shared knowledge, administration
            controls and enterprise requirements.
          </p>
        </div>

        <Link className="button secondary" href="/app/organization">
          View organization
        </Link>
      </section>
    </>
  );
}
