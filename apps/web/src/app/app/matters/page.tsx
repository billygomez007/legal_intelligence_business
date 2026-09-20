import Link from 'next/link';
import { BriefcaseBusiness, CalendarClock, FileText, FolderOpen, Plus, Users } from 'lucide-react';

import { routes } from '../../../lib/routes';

export const metadata = {
  title: 'Matters',
};

const matters = [
  {
    id: 'DEMO-MAT-001',
    title: 'Sample Contract Dispute',
    client: 'Sample Client A',
    practiceArea: 'Commercial',
    status: 'Active',
    nextEvent: 'Client conference · 22 Sep 2026',
    authorities: 5,
    documents: 8,
  },
  {
    id: 'DEMO-MAT-002',
    title: 'Sample Land Title Matter',
    client: 'Sample Client B',
    practiceArea: 'Land',
    status: 'Active',
    nextEvent: 'Filing deadline · 24 Sep 2026',
    authorities: 7,
    documents: 12,
  },
  {
    id: 'DEMO-MAT-003',
    title: 'Sample Employment Matter',
    client: 'Sample Client C',
    practiceArea: 'Employment',
    status: 'Review',
    nextEvent: 'Internal review · 26 Sep 2026',
    authorities: 4,
    documents: 5,
  },
];

export default function MattersPage() {
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">LEGAL WORK</p>
          <h1>Matters</h1>
          <p className="muted">
            Organize research, authorities, documents, appointments and deadlines around each
            matter.
          </p>
        </div>

        <button className="button" type="button" disabled>
          <Plus size={16} aria-hidden="true" />
          New matter
        </button>
      </section>

      <div className="stack">
        {matters.map((matter) => (
          <article className="panel panel-padded" key={matter.id}>
            <div className="section-heading">
              <div>
                <span className="demo-badge">Demonstration</span>
                <h2 className="mt-3">{matter.title}</h2>
                <p className="muted">
                  {matter.client} · {matter.practiceArea}
                </p>
              </div>

              <span className="badge verification human-reviewed">{matter.status}</span>
            </div>

            <div className="metadata-grid mt-4">
              <div>
                <dt>
                  <Users size={13} aria-hidden="true" /> Client
                </dt>
                <dd>{matter.client}</dd>
              </div>

              <div>
                <dt>
                  <CalendarClock size={13} aria-hidden="true" /> Next event
                </dt>
                <dd>{matter.nextEvent}</dd>
              </div>

              <div>
                <dt>
                  <FolderOpen size={13} aria-hidden="true" /> Authorities
                </dt>
                <dd>{matter.authorities}</dd>
              </div>

              <div>
                <dt>
                  <FileText size={13} aria-hidden="true" /> Documents
                </dt>
                <dd>{matter.documents}</dd>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 mt-5">
              <Link className="button secondary" href={routes.research}>
                Open research
              </Link>

              <Link className="button secondary" href={routes.appointments}>
                Appointments
              </Link>

              <Link className="button secondary" href={routes.calendar}>
                Deadlines
              </Link>
            </div>
          </article>
        ))}
      </div>

      <section className="ghana-callout">
        <div>
          <p className="eyebrow">MATTER INTELLIGENCE</p>
          <h2>One place for the legal work around every matter.</h2>
          <p>
            Matters are the foundation for connecting research, legal authorities, documents,
            appointments, deadlines, notes and future client billing.
          </p>
        </div>

        <BriefcaseBusiness size={44} aria-hidden="true" />
      </section>
    </>
  );
}
