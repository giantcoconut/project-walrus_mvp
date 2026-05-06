import { ActivityControls } from '../../components/public/activity-controls';
import { ActivityListItem } from '../../components/public/activity-list-item';
import { Reveal } from '../../components/public/reveal';
import {
  fetchProtocolActivity,
  type ProtocolActivityFilter,
  type ProtocolActivityScope,
} from '../../src/site/protocol-activity';
import type { PublicIntuitionNetwork } from '../../src/intuition/public';

export const dynamic = 'force-dynamic';

interface ActivityPageProps {
  searchParams?: {
    network?: string;
    filter?: string;
    scope?: string;
    q?: string;
  };
}

function parseNetwork(value?: string): PublicIntuitionNetwork {
  return value === 'testnet' ? 'testnet' : 'mainnet';
}

function parseFilter(value?: string): ProtocolActivityFilter {
  return value === 'creation' || value === 'signal' || value === 'redeem' ? value : 'all';
}

function parseScope(value?: string): ProtocolActivityScope {
  return value === 'claims' || value === 'atoms' ? value : 'all';
}

export default async function ActivityPage({ searchParams }: ActivityPageProps) {
  const network = parseNetwork(searchParams?.network);
  const filter = parseFilter(searchParams?.filter);
  const scope = parseScope(searchParams?.scope);
  const query = searchParams?.q?.trim() ?? '';

  const { items, error } = await fetchProtocolActivity({
    network,
    filter,
    scope,
    query,
  });

  const creationCount = items.filter((item) => item.kind === 'atom-created' || item.kind === 'claim-created').length;
  const signalCount = items.filter(
    (item) => item.kind === 'atom-deposit' || item.kind === 'claim-support' || item.kind === 'claim-oppose',
  ).length;
  const redemptionCount = items.filter(
    (item) =>
      item.kind === 'atom-redeem' ||
      item.kind === 'claim-redeem-support' ||
      item.kind === 'claim-redeem-opposition',
  ).length;

  return (
    <div className="mx-auto w-full max-w-[92rem] px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.35fr)_22rem] lg:items-start">
        <Reveal className="space-y-8" delay={0.03}>
          <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Protocol activity</p>
          <div className="space-y-6">
            <h1 className="max-w-5xl font-serif text-[3.5rem] leading-[0.9] tracking-[-0.055em] text-ink sm:text-[5.6rem]">
              What the graph is doing right now.
            </h1>
            <p className="max-w-3xl text-base leading-8 text-muted sm:text-lg">
              Follow live protocol activity across Intuition: new atoms, new claims, support, opposition,
              and redemptions, all in one chronological stream.
            </p>
          </div>
          <div className="editorial-rule max-w-5xl" />
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
            <span>Mainnet and testnet views</span>
            <span className="text-line">/</span>
            <span>Chronological protocol flow</span>
            <span className="text-line">/</span>
            <span>Readable claim and atom rows</span>
          </div>
        </Reveal>

        <Reveal
          className="border border-line/80 bg-white/70 p-6 shadow-sheet backdrop-blur-[2px]"
          delay={0.12}
        >
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Current slice</p>
              <p className="text-sm leading-7 text-muted">
                Filters apply on top of the raw protocol stream so you can isolate creations, signal
                movements, or redemptions without switching tools.
              </p>
            </div>
            <div className="grid gap-4 border-t border-line/70 pt-5 sm:grid-cols-3 lg:grid-cols-1">
              <div>
                <p className="text-sm text-muted">Creations</p>
                <p className="font-serif text-[2.2rem] leading-none tracking-[-0.05em] text-ink">
                  {creationCount}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted">Signals</p>
                <p className="font-serif text-[2.2rem] leading-none tracking-[-0.05em] text-ink">
                  {signalCount}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted">Redeems</p>
                <p className="font-serif text-[2.2rem] leading-none tracking-[-0.05em] text-ink">
                  {redemptionCount}
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      <section className="mt-12">
        <ActivityControls
          initialQuery={query}
          initialFilter={filter}
          initialScope={scope}
          initialNetwork={network}
          resultCount={items.length}
        />
      </section>

      <section className="mt-10">
        {error ? (
          <div className="border border-[#b87b63]/40 bg-[#fff6f2] p-8 shadow-sheet">
            <p className="font-serif text-[2rem] tracking-[-0.03em] text-ink">Activity is temporarily unavailable.</p>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">{error}</p>
          </div>
        ) : items.length > 0 ? (
          <div>
            {items.map((item, index) => (
              <Reveal key={item.id} delay={Math.min(index * 0.025, 0.24)}>
                <ActivityListItem item={item} />
              </Reveal>
            ))}
          </div>
        ) : (
          <div className="border border-line/80 bg-white/60 p-8 shadow-sheet">
            <p className="font-serif text-[2rem] tracking-[-0.03em] text-ink">No protocol events match this view.</p>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">
              Widen the filters or switch networks. The page only shows public Intuition events for atoms,
              claims, deposits, and redemptions.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
