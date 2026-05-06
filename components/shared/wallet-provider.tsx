'use client';

import '@rainbow-me/rainbowkit/styles.css';

import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';

import { walletConfig } from '../../src/site/wallet-config';

const rainbowTheme = lightTheme({
  accentColor: '#231714',
  accentColorForeground: '#f8f2ea',
  borderRadius: 'medium',
  fontStack: 'system',
  overlayBlur: 'small',
});

function WalletAvatar({
  address,
  ensImage,
  size,
}: {
  address: string;
  ensImage?: string | null;
  size: number;
}) {
  if (ensImage) {
    return (
      <img
        src={ensImage}
        alt={`${address} avatar`}
        width={size}
        height={size}
        className="rounded-full object-cover"
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-full bg-[#efe7d8] text-[#231714]"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span style={{ fontSize: Math.max(12, Math.floor(size * 0.38)), lineHeight: 1 }}>
        {address.slice(2, 4).toUpperCase()}
      </span>
    </div>
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme} modalSize="compact" avatar={WalletAvatar}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
