import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Plus,
  Scale,
} from 'lucide-react';

import { routes } from '../../../lib/routes';

export const metadata = {
  title: 'Deadlines & Calendar',
};

const events = [
  {
    id: 'DEMO-DEADLINE-001',
    title: 'Sample filing deadline',
    matter: 'Sample Land Title Matter',
    date: '24 Sep 2026',
    time: '16:00',
    kind: 'Filing deadline',
    priority: 'High',
  },
  {
    id: 'DEMO-DEADLINE-002',
    title: 'Sample internal review',
    matter: 'Sample Contract Dispute',
    date: '26 Sep 2026',
    time: '10:00',
    kind: 'Internal deadline',
    priority: 'Normal',
  },
  {
    id: 'DEMO-DEADLINE-003',
    title: 'Sample hearing preparation',
    matter: 'Sample Employment Matter',
    date: '29 Sep 2026',
    time: '09:00',
    kind: 'Court preparation',
    priority: 'High',
  },
  {
    id: 'DEMO-DEADLINE-004',
    title: 'Sample research memo due',
    matter: 'Example Companies Act Research',
    date: '30 Sep 2026',
    time: '15:00',
    kind: 'Research deadline',
    priority: 'Normal',
  },
];

export default function CalendarPage() {
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">TIME & DEADLINES</p>
          <h1>Deadlines & Calendar</h1>
          <p className="muted">
            Keep procedural deadlines, internal due dates, hearings and matter events visible in one
            place.
          </p>
        </div>

        <button className="button" type="button" disabled>
          <Plus size={16} aria-hidden="true" />
          New deadline
        </button>
      </section>

      <section className="panel panel-padded">
        <div className="section-heading">
          <div>
            <p className="eyebrow">UPCOMING</p>
            <h2>Critical dates</h2>
          </div>

          <CalendarClock size={23} aria-hidden="true" />
        </div>

        <div className="stack">
          {events.map((event) => (
            <article className="project-card" key={event.id}>
              <div className="section-heading">
                <div>
                  <span className="demo-badge">Demonstration</span>
                  <h3 className="mt-3">{event.title}</h3>
                  <p className="muted">{event.matter}</p>
                </div>

                <span
                  className={
                    event.priority === 'High'
                      ? 'badge verification machine-extracted'
                      : 'court-badge'
                  }
                >
                  {event.priority === 'High' ? (
                    <AlertTriangle size={12} aria-hidden="true" />
                  ) : (
                    <CheckCircle2 size={12} aria-hidden="true" />
                  )}
                  {event.priority}
                </span>
              </div>

              <div className="metadata-grid mt-4">
                <div>
                  <dt>
                    <CalendarClock size={13} aria-hidden="true" /> Date
                  </dt>
                  <dd>{event.date}</dd>
                </div>

                <div>
                  <dt>
                    <Clock3 size={13} aria-hidden="true" /> Time
                  </dt>
                  <dd>{event.time}</dd>
                </div>

                <div>
                  <dt>
                    <FileText size={13} aria-hidden="true" /> Event type
                  </dt>
                  <dd>{event.kind}</dd>
                </div>

                <div>
                  <dt>
                    <Scale size={13} aria-hidden="true" /> Matter
                  </dt>
                  <dd>{event.matter}</dd>
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="micro mt-4">
          Demonstration deadlines only. The current interface does not calculate statutory,
          procedural or limitation periods and must not be relied on for legal deadlines.
        </p>
      </section>

      <section className="ghana-callout">
        <div>
          <p className="eyebrow">PRACTICE SAFETY</p>
          <h2>Keep meetings and legal deadlines separate but connected.</h2>
          <p>
            Appointments manage people and meetings. Deadlines & Calendar manages due dates,
            hearings and matter events. Both can eventually feed a unified lawyer schedule.
          </p>
        </div>

        <Link className="button secondary" href={routes.appointments}>
          View appointments
        </Link>
      </section>
    </>
  );
}
