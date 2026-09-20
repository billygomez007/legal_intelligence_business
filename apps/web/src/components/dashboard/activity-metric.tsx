import {
  ArrowDown,
  ArrowUp,
  Bell,
  FolderOpen,
  Bookmark,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityMetric as ActivityMetricData } from '../../data/types';

const icons: Record<ActivityMetricData['id'], LucideIcon> = {
  searches: FileText,
  authorities: Bookmark,
  projects: FolderOpen,
  alerts: Bell,
};

/** One research-activity figure: icon tile, value, label and period-over-period change. */
export function ActivityMetric({ metric }: { metric: ActivityMetricData }) {
  const Icon = icons[metric.id];
  const up = metric.change >= 0;
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <li className="metric">
      <span className="icon-tile round">
        <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
      </span>
      <div className="metric-body">
        <p className="metric-value">{metric.value}</p>
        <p className="metric-label">{metric.label}</p>
      </div>
      <p className={`metric-change ${up ? 'up' : 'down'}`}>
        <Arrow size={13} aria-hidden="true" />
        <span className="sr-only">{up ? 'Up' : 'Down'} </span>
        {Math.abs(metric.change)}%
      </p>
    </li>
  );
}
