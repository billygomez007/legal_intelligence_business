import type { Metadata, Viewport } from 'next';
import { Inter, Source_Serif_4 } from 'next/font/google';
import type { ReactNode } from 'react';
import { themeColor } from '../design/tokens';
import './globals.css';

// Self-hosted at build time by next/font: no request to Google is made from the browser.
const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const serif = Source_Serif_4({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-source-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'LexGhana | Legal Intelligence',
    template: '%s | LexGhana',
  },
  description: 'LexGhana legal intelligence platform preview. Demonstration data only.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor, colorScheme: 'dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
