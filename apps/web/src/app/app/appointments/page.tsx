import Link from 'next/link';
import { CalendarDays, Clock3, MapPin, Plus, UserRound, Video } from 'lucide-react';

import { routes } from '../../../lib/routes';

export const metadata = {
  title: 'Appointments',
};

const appointments = [
  {
    id: 'DEMO-APT-001',
    title: 'Client conference',
    client: 'Sample Client A',
    matter: 'Sample Contract Dispute',
    date: '22 Sep 2026',
    time: '09:30',
    location: 'Accra Office',
    type: 'In person',
  },
  {
    id: 'DEMO-APT-002',
    title: 'Matter review',
    client: 'Sample Client B',
    matter: 'Sample Land Title Matter',
    date: '22 Sep 2026',
    time: '13:00',
    location: 'Secure video meeting',
    type: 'Video',
  },
  {
    id: 'DEMO-APT-003',
    title: 'Research review',
    client: 'Internal',
    matter: 'Example Companies Act Research',
    date: '23 Sep 2026',
    time: '11:00',
    location: 'LexGhana Workspace',
    type: 'Internal',
  },
];

export default function AppointmentsPage() {
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">PRACTICE WORKSPACE</p>
          <h1>Appointments</h1>
          <p className="muted">
            Manage client meetings, internal conferences and matter-related appointments.
          </p>
        </div>

        <button className="button" type="button" disabled>
          <Plus size={16} aria-hidden="true" />
          New appointment
        </button>
      </section>

      <section className="panel panel-padded">
        <div className="section-heading">
          <div>
            <p className="eyebrow">UPCOMING</p>
            <h2>Appointments</h2>
          </div>

          <CalendarDays size={22} aria-hidden="true" />
        </div>

        <div className="stack">
          {appointments.map((appointment) => (
            <article className="project-card" key={appointment.id}>
              <div className="section-heading">
                <div>
                  <span className="demo-badge">Demonstration</span>
                  <h3 className="mt-3">{appointment.title}</h3>
                </div>

                <span className="court-badge">{appointment.type}</span>
              </div>

              <div className="metadata-grid mt-4">
                <div>
                  <dt>
                    <UserRound size={13} aria-hidden="true" /> Client
                  </dt>
                  <dd>{appointment.client}</dd>
                </div>

                <div>
                  <dt>Matter</dt>
                  <dd>{appointment.matter}</dd>
                </div>

                <div>
                  <dt>
                    <CalendarDays size={13} aria-hidden="true" /> Date
                  </dt>
                  <dd>{appointment.date}</dd>
                </div>

                <div>
                  <dt>
                    <Clock3 size={13} aria-hidden="true" /> Time
                  </dt>
                  <dd>{appointment.time}</dd>
                </div>
              </div>

              <div className="inline-meta mt-4">
                {appointment.type === 'Video' ? (
                  <Video size={14} aria-hidden="true" />
                ) : (
                  <MapPin size={14} aria-hidden="true" />
                )}
                <span>{appointment.location}</span>
              </div>
            </article>
          ))}
        </div>

        <p className="micro mt-4">
          Demonstration appointments only. Calendar synchronization, reminders and external meeting
          integrations are not connected.
        </p>
      </section>

      <section className="ghana-callout">
        <div>
          <p className="eyebrow">CONNECTED PRACTICE</p>
          <h2>Appointments should remain connected to the legal matter.</h2>
          <p>
            Future appointments can connect to clients, matters, lawyers, deadlines, notes and
            follow-up tasks without mixing scheduling with legal advice.
          </p>
        </div>

        <Link className="button secondary" href={routes.calendar}>
          View deadlines & calendar
        </Link>
      </section>
    </>
  );
}
