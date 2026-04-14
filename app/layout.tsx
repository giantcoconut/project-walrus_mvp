import type { Metadata } from 'next';
import { Newsreader, Public_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { SiteHeader } from '../components/public/site-header';
import './globals.css';

const editorial = Newsreader({
  subsets: ['latin'],
  variable: '--font-editorial',
  weight: ['400', '500', '600'],
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-public-sans',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Aletheia Terminal',
  description: 'Provable publisher assertions, structured and minted on-chain.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${editorial.variable} ${publicSans.variable} grain font-sans`}>
        <div className="min-h-screen">
          <SiteHeader />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
