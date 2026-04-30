'use client';

import { useEffect, useState } from 'react';

import { ConnectButton } from '@rainbow-me/rainbowkit';

import { getIntuitionNetworkByChainId } from '../../src/intuition/public';

function formatAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect wallet';
}

type EnsIdentity = {
  ensAvatar: string | null;
  ensName: string | null;
};

type ConnectedWalletControlsProps = {
  account: {
    address: string;
  };
  chain: {
    id: number;
    name: string;
  };
  openAccountModal: () => void;
  openChainModal: () => void;
};

function ConnectedWalletControls({
  account,
  chain,
  openAccountModal,
  openChainModal,
}: ConnectedWalletControlsProps) {
  const [ensIdentity, setEnsIdentity] = useState<EnsIdentity>({
    ensAvatar: null,
    ensName: null,
  });
  const network = getIntuitionNetworkByChainId(chain.id ?? null);

  useEffect(() => {
    let cancelled = false;

    async function loadEnsIdentity() {
      try {
        const response = await fetch(
          `/api/ens/resolve?address=${encodeURIComponent(account.address)}`,
          { cache: 'no-store' },
        );

        if (!response.ok) {
          throw new Error('ENS lookup failed');
        }

        const data = (await response.json()) as EnsIdentity;

        if (!cancelled) {
          setEnsIdentity({
            ensAvatar: data.ensAvatar ?? null,
            ensName: data.ensName ?? null,
          });
        }
      } catch {
        if (!cancelled) {
          setEnsIdentity({ ensAvatar: null, ensName: null });
        }
      }
    }

    void loadEnsIdentity();

    return () => {
      cancelled = true;
    };
  }, [account.address]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={openChainModal}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-white/70 px-3 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1f8a62]/35" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#1f8a62]" />
        </span>
        {network?.name ?? chain.name}
        <span aria-hidden="true" className="text-xs leading-none text-muted">
          ▾
        </span>
      </button>
      <button
        type="button"
        onClick={openAccountModal}
        className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white/70 px-4 py-2 text-sm text-ink transition-colors duration-150 hover:border-ink hover:bg-ink hover:text-paper"
      >
        {ensIdentity.ensAvatar ? (
          <img
            src={ensIdentity.ensAvatar}
            alt={ensIdentity.ensName ? `${ensIdentity.ensName} avatar` : 'Wallet avatar'}
            className="h-5 w-5 rounded-full object-cover"
          />
        ) : null}
        {ensIdentity.ensName ?? formatAddress(account.address)}
      </button>
    </div>
  );
}

export function PublicWalletButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        authenticationStatus,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const ready = mounted && authenticationStatus !== 'loading';
        const connected =
          ready &&
          account != null &&
          chain != null &&
          (!authenticationStatus || authenticationStatus === 'authenticated');

        if (!ready) {
          return <div aria-hidden="true" className="h-10 w-[13.5rem] opacity-0" />;
        }

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper"
            >
              Connect wallet
            </button>
          );
        }

        return (
          <ConnectedWalletControls
            account={{ address: account.address! }}
            chain={{ id: chain.id, name: chain.name! }}
            openAccountModal={openAccountModal}
            openChainModal={openChainModal}
          />
        );
      }}
    </ConnectButton.Custom>
  );
}
