import type {
  Metadata,
} from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Law Afrique',
  description:
    'Legal intelligence platform for African legal work.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
