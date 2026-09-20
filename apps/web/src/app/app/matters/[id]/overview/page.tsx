import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  FileText,
  StickyNote,
} from 'lucide-react';
import { notFound } from 'next/navigation';

import { getMatterWorkspace } from '../../../../../data/matter-workspace';

export default async function MatterOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  const metrics = [
    { label: 'Research items', value: matter.research.length, icon: BookOpen },
    { label: 'Documents', value: matter.documents.length, icon: FileText },
    {
      label: 'Open tasks',
      value: matter.tasks.filter((task) => task.status !== 'Done').length,
      icon: CheckSquare,
    },
    { label: 'Appointments', value: matter.appointments.length, icon: CalendarDays },
    { label: 'Deadlines', value: matter.deadlines.length, icon: CalendarClock },
    { label: 'Notes', value: matter.notes.length, icon: StickyNote },
  ];

  return (
    <>
      <section className="panel panel-padded">
        <p className="eyebrow">OVERVIEW</p>
        <h2>Matter summary</h2>
        <p className="muted">{matter.description}</p>

        <div className="matter-overview-grid mt-5">
          {metrics.map(({ label, value, icon: Icon }) => (
            <article className="matter-metric" key={label}>
              <Icon size={18} aria-hidden="true" />
              <strong>{value}</strong>
              <span>{label}</span>
            </article>
          ))}
        </div>
      </section>

      <div className="settings-grid mt-6">
        <section className="panel panel-padded">
          <div className="section-heading">
            <h2>Next appointments</h2>
          </div>

          <div className="stack">
            {matter.appointments.map((appointment) => (
              <article className="matter-compact-row" key={appointment.id}>
                <div>
                  <strong>{appointment.title}</strong>
                  <p className="micro">
                    {appointment.date} · {appointment.time}
                  </p>
                </div>

                <span className="court-badge">{appointment.type}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel-padded">
          <div className="section-heading">
            <h2>Upcoming deadlines</h2>
          </div>

          <div className="stack">
            {matter.deadlines.map((deadline) => (
              <article className="matter-compact-row" key={deadline.id}>
                <div>
                  <strong>{deadline.title}</strong>
                  <p className="micro">
                    {deadline.date} · {deadline.time}
                  </p>
                </div>

                <span className="court-badge">{deadline.priority}</span>
              </article>
            ))}
          </div>
        </section>
      </div>

      <p className="micro mt-4">
        Demonstration workspace only. No live client, confidential, privileged or court data is
        stored.
      </p>
    </>
  );
}
