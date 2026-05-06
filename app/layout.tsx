import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { RootChrome } from '../components/shared/root-chrome';
import { WalletProvider } from '../components/shared/wallet-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aletheia Terminal',
  description: 'Provable publisher assertions, structured and minted on-chain.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="grain font-sans">
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
