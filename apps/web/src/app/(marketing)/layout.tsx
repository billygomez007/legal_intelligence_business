import type { ReactNode } from 'react';
import { MarketingNavbar } from '../../components/marketing/marketing-navbar';
import { PublicFooter } from '../../components/marketing/public-footer';

/** The public LexGhana site. It shares design tokens with the app but none of its shell. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <MarketingNavbar />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
