import { FileText, Gavel, Landmark, Newspaper, ScrollText, type LucideIcon } from 'lucide-react';
import { routes } from '../../lib/routes';
import { SearchBox } from '../search/search-box';

export const researchScopes: readonly { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'cases', label: 'Cases', icon: FileText },
  { value: 'legislation', label: 'Legislation', icon: Landmark },
  { value: 'principles', label: 'Legal principles', icon: Gavel },
  { value: 'procedure', label: 'Procedural rules', icon: ScrollText },
  { value: 'developments', label: 'Recent developments', icon: Newspaper },
];

/**
 * The dashboard's focal point. A plain GET form to /app/ask: it works without JavaScript and does
 * not call any model. The scope pills are checkboxes, so they are keyboard-operable by default.
 */
export function AskLawHero() {
  return (
    <section className="panel ask-hero" aria-labelledby="ask-hero-title">
      <p className="eyebrow">Ask the Law</p>
      <h2 id="ask-hero-title" className="display ask-hero-title">
        Get clear answers from Ghanaian law
      </h2>
      <p className="ask-hero-copy">Search cases, legislation and verified legal authorities.</p>
      <form action={routes.ask} method="get">
        <SearchBox
          id="dashboard-question"
          label="Legal research question"
          placeholder="Ask a legal research question..."
          buttonLabel="Search"
        />
        <fieldset className="pill-group">
          <legend className="sr-only">Research scope</legend>
          {researchScopes.map(({ value, label, icon: Icon }) => (
            <label className="pill" key={value}>
              <input type="checkbox" name="scope" value={value} />
              <Icon size={16} aria-hidden="true" />
              {label}
            </label>
          ))}
        </fieldset>
      </form>
      <p className="micro">
        Interface preview. AI research is not connected and no legal advice is given.
      </p>
    </section>
  );
}
