import { Gavel, Landmark, ScrollText, Star, type LucideIcon } from 'lucide-react';
import type { LegalUpdate, LegalUpdateCategory } from '../../data/types';
import { relativeTime } from '../../lib/format';
import { routes } from '../../lib/routes';
import { ListPanel } from '../ui/list-panel';

const presentation: Record<LegalUpdateCategory, { icon: LucideIcon; tone: string }> = {
  'New judgments': { icon: Gavel, tone: 'info' },
  'Legislation updates': { icon: Landmark, tone: 'metadata' },
  'Followed topics': { icon: Star, tone: 'gold' },
  'Regulatory updates': { icon: ScrollText, tone: 'warning' },
};

export function LegalUpdatesPanel({ updates, asOf }: { updates: LegalUpdate[]; asOf: string }) {
  return (
    <ListPanel
      id="updates-title"
      title="Legal updates"
      href={routes.alerts}
      className="dash-updates"
    >
      <ul className="row-list">
        {updates.map((update) => {
          const { icon: Icon, tone } = presentation[update.category];
          return (
            <li className="list-row" key={update.id}>
              <span className={`icon-tile sm round tone-${tone}`}>
                <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <div className="row-main">
                <p className="row-title">{update.title}</p>
                <p className="row-sub">{update.description}</p>
              </div>
              <div className="row-trailing">
                <time dateTime={update.at}>{relativeTime(update.at, asOf)}</time>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="micro panel-note">Illustrative updates, not real legal developments.</p>
    </ListPanel>
  );
}
