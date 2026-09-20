import Link from 'next/link';
import { BriefcaseBusiness, CalendarDays, ContactRound, Mail, Phone, Plus } from 'lucide-react';

import { routes } from '../../../lib/routes';

export const metadata = {
  title: 'Clients',
};

const clients = [
  {
    id: 'DEMO-CLIENT-001',
    name: 'Sample Client A',
    email: 'client-a@example.test',
    phone: '+233 000 000 001',
    matters: 2,
    nextAppointment: '22 Sep 2026 · 09:30',
  },
  {
    id: 'DEMO-CLIENT-002',
    name: 'Sample Client B',
    email: 'client-b@example.test',
    phone: '+233 000 000 002',
    matters: 1,
    nextAppointment: '22 Sep 2026 · 13:00',
  },
  {
    id: 'DEMO-CLIENT-003',
    name: 'Sample Client C',
    email: 'client-c@example.test',
    phone: '+233 000 000 003',
    matters: 1,
    nextAppointment: 'No appointment scheduled',
  },
];

export default function ClientsPage() {
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">FIRM WORKSPACE</p>
          <h1>Clients</h1>
          <p className="muted">
            Keep client contact information connected to matters, appointments and firm activity.
          </p>
        </div>

        <button className="button" type="button" disabled>
          <Plus size={16} aria-hidden="true" />
          New client
        </button>
      </section>

      <div className="stack">
        {clients.map((client) => (
          <article className="panel panel-padded" key={client.id}>
            <div className="section-heading">
              <div>
                <span className="demo-badge">Demonstration</span>
                <h2 className="mt-3">{client.name}</h2>
              </div>

              <ContactRound size={22} aria-hidden="true" />
            </div>

            <div className="metadata-grid">
              <div>
                <dt>
                  <Mail size={13} aria-hidden="true" /> Email
                </dt>
                <dd>{client.email}</dd>
              </div>

              <div>
                <dt>
                  <Phone size={13} aria-hidden="true" /> Phone
                </dt>
                <dd>{client.phone}</dd>
              </div>

              <div>
                <dt>
                  <BriefcaseBusiness size={13} aria-hidden="true" /> Matters
                </dt>
                <dd>{client.matters}</dd>
              </div>

              <div>
                <dt>
                  <CalendarDays size={13} aria-hidden="true" /> Next appointment
                </dt>
                <dd>{client.nextAppointment}</dd>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 mt-5">
              <Link className="button secondary" href={routes.matters}>
                View matters
              </Link>

              <Link className="button secondary" href={routes.appointments}>
                View appointments
              </Link>
            </div>
          </article>
        ))}
      </div>

      <p className="micro mt-4">
        Synthetic client records only. No real client, confidential or privileged information is
        stored in this demonstration environment.
      </p>
    </>
  );
}
