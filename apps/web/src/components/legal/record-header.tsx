import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

/** Header for a single case, instrument or source: title, badges and an optional key-facts strip. */
export function RecordHeader({
  eyebrow,
  title,
  backHref,
  backLabel,
  badges,
  facts,
}: {
  eyebrow: string;
  title: string;
  backHref: string;
  backLabel: string;
  badges: ReactNode;
  facts?: { label: string; value: ReactNode }[];
}) {
  return (
    <header className="record-header">
      <Link className="text-link back-link" href={backHref}>
        <ArrowLeft size={14} aria-hidden="true" />
        {backLabel}
      </Link>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <div className="meta-row">{badges}</div>
      {facts ? (
        <dl className="fact-strip">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}
