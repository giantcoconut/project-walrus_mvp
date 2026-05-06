'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAccount, useChainId } from 'wagmi';

import {
  getIntuitionNetworkByChainId,
  type PublicIntuitionNetwork,
} from '../../src/intuition/public';
import type { ProtocolActivityFilter, ProtocolActivityScope } from '../../src/site/protocol-activity';

interface ActivityControlsProps {
  initialQuery: string;
  initialFilter: ProtocolActivityFilter;
  initialScope: ProtocolActivityScope;
  initialNetwork: PublicIntuitionNetwork;
  resultCount: number;
}

const FILTER_OPTIONS: Array<{ value: ProtocolActivityFilter; label: string }> = [
  { value: 'all', label: 'Everything' },
  { value: 'creation', label: 'Creations' },
  { value: 'signal', label: 'Signal' },
  { value: 'redeem', label: 'Redeems' },
];

const SCOPE_OPTIONS: Array<{ value: ProtocolActivityScope; label: string }> = [
  { value: 'all', label: 'All surfaces' },
  { value: 'claims', label: 'Claims only' },
  { value: 'atoms', label: 'Atoms only' },
];

export function ActivityControls({
  initialQuery,
  initialFilter,
  initialScope,
  initialNetwork,
  resultCount,
}: ActivityControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isConnected } = useAccount();
  const chainId = useChainId();

  const connectedNetwork = useMemo(() => {
    const network = getIntuitionNetworkByChainId(chainId);
    return network?.key ?? null;
  }, [chainId]);

  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState(initialFilter);
  const [scope, setScope] = useState(initialScope);
  const [network, setNetwork] = useState(initialNetwork);

  useEffect(() => {
    setQuery(initialQuery);
    setFilter(initialFilter);
    setScope(initialScope);
    setNetwork(initialNetwork);
  }, [initialFilter, initialNetwork, initialQuery, initialScope]);

  useEffect(() => {
    if (!isConnected || !connectedNetwork || connectedNetwork === initialNetwork) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('network', connectedNetwork);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }, [connectedNetwork, initialNetwork, isConnected, pathname, router, searchParams]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextParams = new URLSearchParams(searchParams.toString());

    if (query.trim()) {
      nextParams.set('q', query.trim());
    } else {
      nextParams.delete('q');
    }

    if (filter !== 'all') {
      nextParams.set('filter', filter);
    } else {
      nextParams.delete('filter');
    }

    if (scope !== 'all') {
      nextParams.set('scope', scope);
    } else {
      nextParams.delete('scope');
    }

    const nextNetwork = isConnected && connectedNetwork ? connectedNetwork : network;
    nextParams.set('network', nextNetwork);

    router.push(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  const networkLocked = isConnected && connectedNetwork !== null;

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-line/80 bg-white/65 p-4 shadow-sheet backdrop-blur-[2px] sm:p-5"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_12rem_12rem_10rem]">
        <label className="block">
          <span className="mb-2 block text-[0.72rem] uppercase tracking-terminal text-muted">Search</span>
          <input
            type="search"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Actor, atom, claim, transaction hash"
            className="w-full border border-line bg-paper/75 px-3 py-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-ink/25"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-[0.72rem] uppercase tracking-terminal text-muted">Filter</span>
          <select
            name="filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as ProtocolActivityFilter)}
            className="w-full border border-line bg-paper/75 px-3 py-3 text-sm text-ink outline-none transition-colors focus:border-ink/25"
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-[0.72rem] uppercase tracking-terminal text-muted">Scope</span>
          <select
            name="scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as ProtocolActivityScope)}
            className="w-full border border-line bg-paper/75 px-3 py-3 text-sm text-ink outline-none transition-colors focus:border-ink/25"
          >
            {SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-[0.72rem] uppercase tracking-terminal text-muted">Network</span>
          <select
            name="network"
            value={networkLocked && connectedNetwork ? connectedNetwork : network}
            onChange={(event) => setNetwork(event.target.value as PublicIntuitionNetwork)}
            disabled={networkLocked}
            className="w-full border border-line bg-paper/75 px-3 py-3 text-sm text-ink outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-70 focus:border-ink/25"
          >
            <option value="mainnet">Mainnet</option>
            <option value="testnet">Testnet</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted">
            {resultCount} events in view
            {query.trim() ? ' / search applied' : ''}
          </p>
          {networkLocked && connectedNetwork ? (
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">
              Feed follows connected wallet: {connectedNetwork}
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper"
        >
          Update feed
        </button>
      </div>
    </form>
  );
}
