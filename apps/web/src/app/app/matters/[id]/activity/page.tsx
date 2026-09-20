import { Activity } from 'lucide-react';
import { notFound } from 'next/navigation';

import { getMatterWorkspace } from '../../../../../data/matter-workspace';

export default async function MatterActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  return (
    <>
      <section className="matter-section-header">
        <div>
          <p className="eyebrow">MATTER HISTORY</p>
          <h2>Activity</h2>
          <p className="muted">
            See the demonstration history of research, documents, appointments and workspace
            changes.
          </p>
        </div>
      </section>

      <div className="matter-activity-list">
        {matter.activity.map((item) => (
          <article className="matter-activity-item" key={item.id}>
            <span className="matter-activity-icon">
              <Activity size={16} aria-hidden="true" />
            </span>

            <div>
              <h3>{item.action}</h3>
              <p>{item.detail}</p>
              <span className="micro">
                {item.actor} · {item.timestamp}
              </span>
            </div>
          </article>
        ))}
      </div>

      <p className="micro mt-4">
        Demonstration activity only. This is not yet the production audit ledger.
      </p>
    </>
  );
}
