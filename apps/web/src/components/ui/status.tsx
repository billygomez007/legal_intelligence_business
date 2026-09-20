import type { ResearchStatus } from '../../data/types';

const tone: Record<ResearchStatus, string> = {
  'In progress': 'info',
  'Needs review': 'warning',
  Draft: 'muted',
};

/** A status with a coloured dot. The label is always text, so colour is never the only signal. */
export function ResearchStatusLabel({ status }: { status: ResearchStatus }) {
  return <span className={`status ${tone[status]}`}>{status}</span>;
}
