import Link from 'next/link';
import { BookOpen, Plus } from 'lucide-react';
import { notFound } from 'next/navigation';

import { getMatterWorkspace } from '../../../../../data/matter-workspace';

export default async function MatterResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = getMatterWorkspace(id);

  if (!matter) {
    notFound();
  }

  return (
    <>
      <section className="matter-section-header">
        <div>
          <p className="eyebrow">MATTER RESEARCH</p>
          <h2>Research</h2>
          <p className="muted">
            Keep matter-specific questions, authorities and legal research together.
          </p>
        </div>

        <Link className="button" href="/app/research">
          <Plus size={15} aria-hidden="true" />
          Open research workspace
        </Link>
      </section>

      <div className="stack">
        {matter.research.map((item) => (
          <article className="panel panel-padded" key={item.id}>
            <div className="matter-row">
              <span className="matter-row-icon">
                <BookOpen size={18} aria-hidden="true" />
              </span>

              <div className="grow">
                <span className="demo-badge">Demonstration</span>
                <h3 className="mt-3">{item.title}</h3>
                <p className="micro">
                  {item.type} · Updated {item.updated}
                </p>
              </div>

              <span className="court-badge">{item.status}</span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
