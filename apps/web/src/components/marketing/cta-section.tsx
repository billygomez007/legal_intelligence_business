import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { finalCta } from '../../content/marketing';
import { LandmarkMotif } from '../brand/landmark-motif';

export function CTASection() {
  return (
    <section className="m-cta" aria-labelledby="cta-title">
      <LandmarkMotif className="m-cta-motif" />
      <div className="m-container m-cta-inner">
        <h2 id="cta-title" className="display">
          {finalCta.headline}
        </h2>
        <div className="m-hero-actions">
          <Link className="button lg" href={finalCta.primary.href}>
            {finalCta.primary.label}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link className="button secondary lg" href={finalCta.secondary.href}>
            {finalCta.secondary.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
