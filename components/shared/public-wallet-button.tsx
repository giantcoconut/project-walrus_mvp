'use client';

import { useAccountModal, useChainModal, useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';

import { getIntuitionNetworkByChainId } from '../../src/intuition/public';

function formatAddress(address?: string) {
  if (!address) {
    return 'Connect wallet';
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function PublicWalletButton() {
  const { address, isConnected, status } = useAccount();
  const chainId = useChainId();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { openChainModal } = useChainModal();
  const network = getIntuitionNetworkByChainId(chainId ?? null);

  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={openConnectModal ?? undefined}
        className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper"
      >
        {status === 'connecting' || status === 'reconnecting' ? 'Connecting...' : 'Connect wallet'}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={openChainModal ?? undefined}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-white/70 px-3 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1f8a62]/35" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#1f8a62]" />
        </span>
        {network?.name ?? `Chain ${chainId}`}
      </button>
      <button
        type="button"
        onClick={openAccountModal ?? undefined}
        className="inline-flex rounded-full border border-ink/15 bg-white/70 px-4 py-2 text-sm text-ink transition-colors duration-150 hover:border-ink hover:bg-ink hover:text-paper"
      >
        {formatAddress(address)}
      </button>
    </div>
  );
}
