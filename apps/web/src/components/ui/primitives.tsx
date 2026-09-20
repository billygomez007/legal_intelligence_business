import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileQuestion, SearchX, ShieldAlert } from 'lucide-react';
export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props} />;
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </header>
  );
}
export function SectionHeading({
  title,
  href,
  link = 'View all',
}: {
  title: string;
  href?: string;
  link?: string;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {href && (
        <Link className="text-link" href={href}>
          {link}
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
export function EmptyState({
  title = 'Nothing here yet',
  description = 'Your saved research will appear here.',
  href,
  action,
}: {
  title?: string;
  description?: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <SearchX size={24} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      {href && (
        <Link className="text-link" href={href}>
          {action ?? 'Explore authorities'}
        </Link>
      )}
    </div>
  );
}
export function ErrorState({ retry }: { retry?: () => void }) {
  return (
    <div role="alert" className="empty-state">
      <ShieldAlert aria-hidden="true" />
      <h2>We couldn’t load this view</h2>
      <p>Your request could not be completed. Please try again.</p>
      {retry && <Button onClick={retry}>Try again</Button>}
      <Link className="text-link" href="/">
        Return to dashboard
      </Link>
    </div>
  );
}
export function LoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading research view" className="loading-stack">
      <span className="sr-only">Loading research view</span>
      {[1, 2, 3].map((n) => (
        <div className="skeleton" key={n} />
      ))}
    </div>
  );
}
export function Unavailable({ restricted = false }: { restricted?: boolean }) {
  return (
    <div className="notice">
      <FileQuestion size={20} aria-hidden="true" />
      <div>
        <strong>{restricted ? 'Rights restricted' : 'Source unavailable'}</strong>
        <p>
          {restricted
            ? 'This demonstration source cannot be displayed. No passage or synthesized content is provided.'
            : 'No source document is available for this example. Verification cannot be established.'}
        </p>
      </div>
    </div>
  );
}
