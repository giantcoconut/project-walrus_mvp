import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Reveal } from '../../../components/public/reveal';
import { getMintedClaimById } from '../../../src/db/supabase';
import {
  formatClaimDate,
  getExplorerTxUrl,
  getPublicClaimType,
  truncateHex,
} from '../../../src/site/public-claims';
import type { TripleDraft } from '../../../src/types/schema';

export const dynamic = 'force-dynamic';

function renderTripleObject(object: TripleDraft['object']): string {
  if (typeof object === 'string') {
    return object;
  }

  return `(${object.subject} ${object.predicate} ${renderTripleObject(object.object)})`;
}

function TripleRow({ triple }: { triple: TripleDraft }) {
  return (
    <div className="grid gap-3 border-b border-line/70 py-4 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)] sm:items-start sm:gap-6">
      <p className="text-sm leading-7 text-ink">{triple.subject}</p>
      <p className="text-[0.72rem] uppercase tracking-terminal text-muted sm:pt-1">{triple.predicate}</p>
      <p className="text-sm leading-7 text-ink">{renderTripleObject(triple.object)}</p>
    </div>
  );
}

export default async function ClaimDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const claim = await getMintedClaimById(params.id);

  if (!claim) {
    notFound();
  }

  const txUrl = getExplorerTxUrl(claim.tx_hash);
  const claimType = getPublicClaimType(claim);

  return (
    <div className="mx-auto w-full max-w-[92rem] px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <Reveal className="max-w-5xl space-y-6">
        <Link href="/claims" className="inline-flex text-sm text-muted transition-colors duration-150 hover:text-ink">
          Back to minted claims
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span>{claim.source}</span>
          <span className="text-line">/</span>
          <span>{formatClaimDate(claim.created_at)}</span>
          <span className="text-line">/</span>
          <span className="text-[0.72rem] uppercase tracking-terminal text-olive">{claimType}</span>
        </div>
        <h1 className="font-serif text-[3.1rem] leading-[0.94] tracking-[-0.05em] text-ink sm:text-[5.2rem]">
          {claim.headline}
        </h1>
      </Reveal>

      <div className="mt-12 grid gap-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Reveal className="space-y-12" delay={0.08}>
          <section className="space-y-4">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Archive triples</p>
            <div className="border-t border-line/70">
              {claim.payload_json.archive.length > 0 ? (
                claim.payload_json.archive.map((triple, index) => (
                  <TripleRow key={`archive-${index}-${triple.predicate}`} triple={triple} />
                ))
              ) : (
                <p className="py-6 text-sm text-muted">No archive triples recorded.</p>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Arena triples</p>
            <div className="border-t border-line/70">
              {claim.payload_json.arena.length > 0 ? (
                claim.payload_json.arena.map((triple, index) => (
                  <TripleRow key={`arena-${index}-${triple.predicate}`} triple={triple} />
                ))
              ) : (
                <p className="py-6 text-sm text-muted">No arena triples recorded.</p>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Entity metadata</p>
            <div className="space-y-4 border-t border-line/70 pt-4">
              {Object.entries(claim.payload_json.entityMetadata).length > 0 ? (
                Object.entries(claim.payload_json.entityMetadata).map(([key, entity]) => (
                  <div key={key} className="grid gap-2 border-b border-line/60 pb-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
                    <p className="text-sm text-muted">{entity.name}</p>
                    <div className="space-y-2 text-sm leading-7 text-ink">
                      <p>{entity.description}</p>
                      {entity.url ? (
                        <a href={entity.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                          {entity.url}
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">No entity metadata attached to this record.</p>
              )}
            </div>
          </section>
        </Reveal>

        <Reveal
          className="h-fit border border-line/80 bg-white/70 p-6 shadow-sheet backdrop-blur-[2px]"
          delay={0.14}
        >
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Provenance</p>
              <p className="text-sm text-muted">Publisher and canonical reference captured at mint time.</p>
            </div>

            <div className="space-y-3 border-t border-line/70 pt-5 text-sm text-muted">
              <div>
                <p>Source</p>
                <p className="mt-1 text-ink">{claim.source}</p>
              </div>
              <div>
                <p>Canonical URL</p>
                <a href={claim.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-ink">
                  {claim.url}
                </a>
              </div>
              <div>
                <p>Draft ID</p>
                <p className="mt-1 break-all text-ink">{claim.id}</p>
              </div>
              <div>
                <p>Transaction</p>
                {txUrl ? (
                  <a href={txUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-ink">
                    {truncateHex(claim.tx_hash ?? '', 14, 10)}
                  </a>
                ) : (
                  <p className="mt-1 text-ink">Unavailable</p>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
