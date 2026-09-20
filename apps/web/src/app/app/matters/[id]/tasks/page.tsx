import { CheckCircle2, Circle, Clock3, Plus } from 'lucide-react';
import { notFound } from 'next/navigation';

import { getMatterWorkspace } from '../../../../../data/matter-workspace';

export default async function MatterTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  return (
    <>
      <section className="matter-section-header">
        <div>
          <p className="eyebrow">TEAM WORK</p>
          <h2>Tasks</h2>
          <p className="muted">Track matter-specific work, ownership, priorities and due dates.</p>
        </div>

        <button className="button" type="button" disabled>
          <Plus size={15} aria-hidden="true" />
          New task
        </button>
      </section>

      <div className="stack">
        {matter.tasks.map((task) => (
          <article className="panel panel-padded" key={task.id}>
            <div className="matter-row">
              <span className="matter-row-icon">
                {task.status === 'Done' ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : task.status === 'In progress' ? (
                  <Clock3 size={18} aria-hidden="true" />
                ) : (
                  <Circle size={18} aria-hidden="true" />
                )}
              </span>

              <div className="grow">
                <h3>{task.title}</h3>
                <p className="micro">
                  Assigned to {task.assignee} · Due {task.due}
                </p>
              </div>

              <div className="matter-row-actions">
                <span className="court-badge">{task.priority}</span>
                <span className="demo-badge">{task.status}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
