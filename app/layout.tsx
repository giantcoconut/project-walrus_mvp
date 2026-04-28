import type { Metadata } from 'next';
import { Newsreader, Public_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { RootChrome } from '../components/shared/root-chrome';
import { WalletProvider } from '../components/shared/wallet-provider';
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
        <WalletProvider>
          <div className="min-h-screen">
            <RootChrome />
            <main>{children}</main>
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
