import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { hero, previewLabel, previewNotice } from '../../content/marketing';
import { LandmarkMotif } from '../brand/landmark-motif';
import { DemoBadge } from '../legal/badges';
import { ProductPreview } from './product-preview';

export function MarketingHero() {
  return (
    <section className="m-hero" aria-labelledby="hero-title">
      <LandmarkMotif className="m-hero-motif" />
      <div className="m-container m-hero-grid">
        <div className="m-hero-copy">
          <div className="meta-row">
            <DemoBadge label={previewLabel} />
            <span className="micro">{previewNotice}</span>
          </div>
          <p className="eyebrow">{hero.eyebrow}</p>
          <h1 id="hero-title">{hero.headline}</h1>
          <p className="m-lead">{hero.message}</p>
          <div className="m-hero-actions">
            <Link className="button lg" href={hero.primary.href}>
              {hero.primary.label}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link className="button secondary lg" href={hero.secondary.href}>
              {hero.secondary.label}
            </Link>
          </div>
        </div>
        <ProductPreview />
      </div>
    </section>
  );
}
