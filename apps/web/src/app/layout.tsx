import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '../components/shell';
import './globals.css';
export const metadata: Metadata = {
  title: {
    default: 'Legal Intelligence | Ghana research workspace',
    template: '%s | Legal Intelligence',
  },
  description: 'Demonstration legal research workspace. Synthetic records only.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
