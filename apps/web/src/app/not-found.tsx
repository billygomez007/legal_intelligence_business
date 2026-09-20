import Link from 'next/link';
import { BrandMark } from '../components/brand/brand-mark';
import { routes } from '../lib/routes';

export default function RootNotFound() {
  return (
    <main className="standalone-page">
      <BrandMark href={routes.home} size="lg" />
      <p className="eyebrow">Page not found</p>
      <h1>This page isn’t part of LexGhana.</h1>
      <p className="muted">The address may be mistyped, or the page may have moved.</p>
      <div className="meta-row">
        <Link className="button" href={routes.home}>
          Go to LexGhana
        </Link>
        <Link className="button secondary" href={routes.app}>
          Open the demonstration workspace
        </Link>
      </div>
    </main>
  );
}
