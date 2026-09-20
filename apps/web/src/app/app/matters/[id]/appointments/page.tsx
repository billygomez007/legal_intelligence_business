import Link from 'next/link';
import { CalendarDays, Clock3, MapPin, Plus } from 'lucide-react';
import { notFound } from 'next/navigation';

import { getMatterWorkspace } from '../../../../../data/matter-workspace';

export default async function MatterAppointmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  return (
    <>
      <section className="matter-section-header">
        <div>
          <p className="eyebrow">MATTER SCHEDULE</p>
          <h2>Appointments</h2>
          <p className="muted">Meetings and conferences connected specifically to this matter.</p>
        </div>

        <button className="button" type="button" disabled>
          <Plus size={15} aria-hidden="true" />
          New appointment
        </button>
      </section>

      <div className="stack">
        {matter.appointments.map((appointment) => (
          <article className="panel panel-padded" key={appointment.id}>
            <div className="matter-row">
              <span className="matter-row-icon">
                <CalendarDays size={18} aria-hidden="true" />
              </span>

              <div className="grow">
                <h3>{appointment.title}</h3>

                <div className="inline-meta">
                  <span>
                    <CalendarDays size={13} aria-hidden="true" />
                    {appointment.date}
                  </span>

                  <span>
                    <Clock3 size={13} aria-hidden="true" />
                    {appointment.time}
                  </span>

                  <span>
                    <MapPin size={13} aria-hidden="true" />
                    {appointment.location}
                  </span>
                </div>
              </div>

              <span className="court-badge">{appointment.type}</span>
            </div>
          </article>
        ))}
      </div>

      <Link className="text-link mt-5" href="/app/appointments">
        View all workspace appointments
      </Link>
    </>
  );
}
