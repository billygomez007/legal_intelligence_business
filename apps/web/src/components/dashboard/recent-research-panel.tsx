import Link from 'next/link';
import { FileText } from 'lucide-react';
import type { ResearchProject } from '../../data/types';
import { relativeTime } from '../../lib/format';
import { routes } from '../../lib/routes';
import { ListPanel } from '../ui/list-panel';
import { ResearchStatusLabel } from '../ui/status';

export function RecentResearchPanel({
  projects,
  asOf,
}: {
  projects: ResearchProject[];
  asOf: string;
}) {
  return (
    <ListPanel
      id="recent-title"
      title="Recent research"
      href={routes.research}
      className="dash-recent"
    >
      <ul className="row-list">
        {projects.map((project) => (
          <li className="list-row" key={project.id}>
            <span className="icon-tile sm">
              <FileText size={18} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <div className="row-main">
              <Link className="row-title" href={routes.researchProject(project.id)}>
                {project.title}
              </Link>
              <p className="row-sub">
                {project.source} · {project.practiceArea}
              </p>
            </div>
            <div className="row-trailing">
              <time dateTime={project.updated}>{relativeTime(project.updated, asOf)}</time>
              <ResearchStatusLabel status={project.status} />
            </div>
          </li>
        ))}
      </ul>
      <p className="micro panel-note">Demonstration matters. Example courts and sources only.</p>
    </ListPanel>
  );
}
