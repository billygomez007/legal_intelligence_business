import { Plus, StickyNote } from 'lucide-react';
import { notFound } from 'next/navigation';

import { getMatterWorkspace } from '../../../../../data/matter-workspace';

export default async function MatterNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  return (
    <>
      <section className="matter-section-header">
        <div>
          <p className="eyebrow">INTERNAL WORK PRODUCT</p>
          <h2>Notes</h2>
          <p className="muted">
            Keep internal matter notes separate from source material and AI synthesis.
          </p>
        </div>

        <button className="button" type="button" disabled>
          <Plus size={15} aria-hidden="true" />
          New note
        </button>
      </section>

      <div className="stack">
        {matter.notes.map((note) => (
          <article className="panel panel-padded" key={note.id}>
            <div className="matter-row">
              <span className="matter-row-icon">
                <StickyNote size={18} aria-hidden="true" />
              </span>

              <div className="grow">
                <span className="demo-badge">User note · Demonstration</span>
                <h3 className="mt-3">{note.title}</h3>
                <p className="muted">{note.body}</p>
                <p className="micro">
                  {note.author} · {note.updated}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <p className="micro mt-4">
        Notes shown here are synthetic. Private notes require tenant-isolated storage before
        production use.
      </p>
    </>
  );
}
