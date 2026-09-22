import Image from 'next/image';
import Link from 'next/link';

export interface BrandMarkProps {
  readonly href?: string;

  readonly priority?: boolean;

  readonly variant?: 'sidebar' | 'header' | 'mobile' | 'full';

  readonly className?: string;
}

const logoForVariant = {
  sidebar: '/brand/law-afrique-logo-sidebar.png',

  header: '/brand/law-afrique-logo-header.png',

  mobile: '/brand/law-afrique-logo-mobile.png',

  full: '/brand/law-afrique-logo.png',
} as const;

export function BrandMark({
  href,
  priority = false,
  variant = 'sidebar',
  className = '',
}: BrandMarkProps) {
  const content = (
    <span
      className={['law-afrique-logo', `law-afrique-logo-${variant}`, className]
        .filter(Boolean)
        .join(' ')}
    >
      <Image
        src={logoForVariant[variant]}
        alt="Law Afrique — Legal Intelligence"
        width={900}
        height={300}
        priority={priority}
        className="law-afrique-logo-image"
      />
    </span>
  );

  if (href === undefined) {
    return content;
  }

  return (
    <Link href={href} className="law-afrique-logo-link" aria-label="Law Afrique">
      {content}
    </Link>
  );
}
