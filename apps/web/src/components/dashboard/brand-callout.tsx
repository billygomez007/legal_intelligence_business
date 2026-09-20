import { Quote } from 'lucide-react';
import { LandmarkMotif } from '../brand/landmark-motif';

/** Wide brand statement. Deliberately makes no product claims beyond what the interface shows. */
export function BrandCallout() {
  return (
    <aside className="brand-callout dash-brand" aria-label="About LexGhana">
      <Quote className="callout-quote" size={44} strokeWidth={1.25} aria-hidden="true" />
      <div className="callout-body">
        <h2 className="display">Better legal information for a stronger Ghana.</h2>
        <p>
          LexGhana combines trusted legal sources with modern technology to help legal professionals
          research, analyse and practise with confidence.
        </p>
      </div>
      <LandmarkMotif className="callout-motif" />
    </aside>
  );
}
