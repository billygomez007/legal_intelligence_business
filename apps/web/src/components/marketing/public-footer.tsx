import Link from 'next/link';
import { footer } from '../../content/marketing';
import { routes } from '../../lib/routes';
import { BrandMark } from '../brand/brand-mark';

export function PublicFooter() {
  return (
    <footer className="m-footer">
      <div className="m-container">
        <div className="m-footer-top">
          <div className="m-footer-brand">
            <BrandMark href={routes.home} />
            <p className="m-footer-closing">{footer.closing}</p>
            <p className="brand-line-inline">
              {footer.tagline.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
          </div>
          <nav aria-label="Footer" className="m-footer-columns">
            {footer.columns.map((column) => (
              <div key={column.title}>
                <h2>{column.title}</h2>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="m-footer-bottom">
          <p className="micro">LexGhana · Legal Intelligence · Platform preview</p>
          <p className="micro">Demonstration environment. Synthetic data only. Not legal advice.</p>
        </div>
      </div>
    </footer>
  );
}
