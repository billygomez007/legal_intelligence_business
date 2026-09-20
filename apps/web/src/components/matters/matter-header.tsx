import Link from 'next/link';
import { ArrowLeft, BriefcaseBusiness, UserRound } from 'lucide-react';

import type { MatterWorkspaceRecord } from '../../data/matter-workspace';
import { MatterTabs } from './matter-tabs';

export function MatterHeader({ matter }: { matter: MatterWorkspaceRecord }) {
  return (
    <>
      <Link className="text-link back-link" href="/app/matters">
        <ArrowLeft size={14} aria-hidden="true" />
        All matters
      </Link>

      <section className="matter-header">
        <div>
          <p className="eyebrow">MATTER WORKSPACE · DEMONSTRATION</p>
          <h1>{matter.title}</h1>

          <div className="matter-header-meta">
            <span>
              <BriefcaseBusiness size={14} aria-hidden="true" />
              {matter.reference}
            </span>

            <span>
              <UserRound size={14} aria-hidden="true" />
              {matter.client}
            </span>

            <span>{matter.practiceArea}</span>
            <span className="demo-badge">{matter.status}</span>
          </div>
        </div>

        <div className="matter-lead">
          <span className="micro">Lead lawyer</span>
          <strong>{matter.leadLawyer}</strong>
          <span className="micro">Opened {matter.opened}</span>
        </div>
      </section>

      <MatterTabs matterId={matter.id} />
    </>
  );
}
