import type { ReactNode } from 'react';

/** A homepage section: eyebrow, serif heading, optional intro, then content. `dark` deepens the band. */
export function MarketingSection({
  id,
  eyebrow,
  title,
  intro,
  tone = 'default',
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro?: string;
  /** `elevated` lifts the band slightly; `dark` is the deepest, gold-edged band used for security. */
  tone?: 'default' | 'elevated' | 'dark';
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`m-section ${tone === 'default' ? '' : tone}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="m-container">
        <div className="m-section-head">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={`${id}-title`} className="display">
            {title}
          </h2>
          {intro ? <p className="m-lead">{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
