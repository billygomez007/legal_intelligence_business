import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  note,
}: {
  readonly label: string;

  readonly value: string;

  readonly note: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-label">{label}</div>

      <div className="stat-value">{value}</div>

      <div className="stat-note">{note}</div>
    </article>
  );
}

export function WorkspaceCard({
  title,
  description,
  children,
}: {
  readonly title: string;

  readonly description?: string;

  readonly children: ReactNode;
}) {
  return (
    <section className="workspace-card">
      <div className="workspace-card-heading">
        <h2>{title}</h2>

        {description && <p>{description}</p>}
      </div>

      {children}
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;

  readonly description: string;

  readonly action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-symbol">+</div>

      <h3>{title}</h3>

      <p>{description}</p>

      {action}
    </div>
  );
}

export function PrimaryAction({ children }: { readonly children: ReactNode }) {
  return (
    <button type="button" className="button-primary">
      {children}
    </button>
  );
}

export function SecondaryAction({ children }: { readonly children: ReactNode }) {
  return (
    <button type="button" className="button-secondary">
      {children}
    </button>
  );
}

export function StatusBadge({ children }: { readonly children: ReactNode }) {
  return <span className="status-badge">{children}</span>;
}
