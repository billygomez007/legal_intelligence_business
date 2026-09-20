import Link from 'next/link';
import { Scale } from 'lucide-react';

type BrandSize = 'md' | 'lg';

/**
 * The LexGhana lock-up: scales mark, serif wordmark and the "Legal Intelligence" descriptor.
 * Pass `href` to make it a link (sidebar, navbar, footer); omit it for a static lock-up.
 */
export function BrandMark({
  href,
  size = 'md',
  label = 'LexGhana — Legal Intelligence',
}: {
  href?: string;
  size?: BrandSize;
  label?: string;
}) {
  const content = (
    <>
      <Scale className="brand-icon" strokeWidth={1.5} aria-hidden="true" />
      <span className="brand-text">
        <span className="brand-name">LexGhana</span>
        <span className="brand-descriptor">Legal Intelligence</span>
      </span>
    </>
  );
  const className = `brand brand-${size}`;
  return href ? (
    <Link href={href} className={className} aria-label={label}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
