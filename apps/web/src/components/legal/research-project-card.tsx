import Link from 'next/link';
import { FolderOpen } from 'lucide-react';
import type { ResearchProject } from '../../data/types';
import { relativeTime } from '../../lib/format';
import { routes } from '../../lib/routes';
import { ResearchStatusLabel } from '../ui/status';

export function ResearchProjectCard({
  project,
  asOf,
}: {
  project: ResearchProject;
  /** Demo clock for relative times. Falls back to the calendar date when omitted. */
  asOf?: string;
}) {
  return (
    <article className="project-card">
      <div className="project-top">
        <span className="icon-tile sm">
          <FolderOpen size={18} strokeWidth={1.6} aria-hidden="true" />
        </span>
        <ResearchStatusLabel status={project.status} />
      </div>
      <p className="micro">{project.reference}</p>
      <h3>
        <Link href={routes.researchProject(project.id)}>{project.title}</Link>
      </h3>
      <p className="project-question">{project.question}</p>
      <div className="project-footer">
        <span>{project.practiceArea}</span>
        <span>
          {project.authorityIds.length} saved{' '}
          {project.authorityIds.length === 1 ? 'authority' : 'authorities'}
        </span>
        <time dateTime={project.updated}>
          {asOf ? relativeTime(project.updated, asOf) : project.updated.slice(0, 10)}
        </time>
      </div>
    </article>
  );
}
