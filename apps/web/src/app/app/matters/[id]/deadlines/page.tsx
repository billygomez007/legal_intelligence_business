import Link from 'next/link';
import { AlertTriangle, CalendarClock, Plus } from 'lucide-react';
import { notFound } from 'next/navigation';

import { getMatterWorkspace } from '../../../../../data/matter-workspace';

export default async function MatterDeadlinesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  return (
    <>
      <section className="matter-section-header">
        <div>
          <p className="eyebrow">MATTER DATES</p>
          <h2>Deadlines</h2>
          <p className="muted">
            Due dates and matter events. Demonstration dates are not calculated legal deadlines.
          </p>
        </div>

        <button className="button" type="button" disabled>
          <Plus size={15} aria-hidden="true" />
          New deadline
        </button>
      </section>

      <div className="stack">
        {matter.deadlines.map((deadline) => (
          <article className="panel panel-padded" key={deadline.id}>
            <div className="matter-row">
              <span className="matter-row-icon">
                {deadline.priority === 'High' ? (
                  <AlertTriangle size={18} aria-hidden="true" />
                ) : (
                  <CalendarClock size={18} aria-hidden="true" />
                )}
              </span>

              <div className="grow">
                <h3>{deadline.title}</h3>
                <p className="micro">
                  {deadline.date} · {deadline.time} · {deadline.type}
                </p>
              </div>

              <span className="court-badge">{deadline.priority}</span>
            </div>
          </article>
        ))}
      </div>

      <p className="micro mt-4">
        LexGhana is not currently calculating statutory, limitation or procedural periods. Lawyers
        remain responsible for verifying every legal deadline.
      </p>

      <Link className="text-link mt-4" href="/app/calendar">
        View full deadlines & calendar workspace
      </Link>
    </>
  );
}
