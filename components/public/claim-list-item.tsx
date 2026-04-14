import Link from 'next/link';

import type { ClaimDraftRow } from '../../src/types/schema';
import {
  formatClaimDate,
  getClaimTripleCount,
  getExplorerTxUrl,
  getPublicClaimType,
  truncateHex,
} from '../../src/site/public-claims';

interface ClaimListItemProps {
  claim: ClaimDraftRow;
  priority?: boolean;
}

export function ClaimListItem({ claim, priority = false }: ClaimListItemProps) {
  const claimType = getPublicClaimType(claim);
  const txUrl = getExplorerTxUrl(claim.tx_hash);

  return (
    <article className="group border-b border-line/70 py-7 first:border-t first:border-line/70 sm:py-9">
      <div className="grid gap-6 lg:grid-cols-[11rem_minmax(0,1fr)_12rem] lg:items-start">
        <div className="space-y-2 text-sm text-muted">
          <p>{claim.source}</p>
          <p>{formatClaimDate(claim.created_at)}</p>
          <p className="text-[0.72rem] uppercase tracking-terminal text-olive">{claimType}</p>
        </div>

        <div className="space-y-3">
          <Link href={`/claims/${claim.id}`} className="inline-block">
            <h2
              className={[
                'max-w-4xl font-serif text-balance text-[1.7rem] leading-[1.06] tracking-[-0.03em] text-ink transition-colors duration-150 group-hover:text-accent sm:text-[2.25rem]',
                priority ? 'sm:text-[2.8rem]' : '',
              ].join(' ')}
            >
              {claim.headline}
            </h2>
          </Link>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span>{getClaimTripleCount(claim)} structured triples</span>
            <span className="text-line">/</span>
            <a
              href={claim.url}
              target="_blank"
              rel="noreferrer"
              className="truncate transition-colors duration-150 hover:text-ink"
            >
              Canonical source link
            </a>
          </div>
        </div>

        <div className="space-y-2 text-sm text-muted lg:text-right">
          <p>On-chain record</p>
          {txUrl ? (
            <a
              href={txUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex transition-colors duration-150 hover:text-ink"
            >
              {truncateHex(claim.tx_hash ?? '')}
            </a>
          ) : (
            <p>Unavailable</p>
          )}
        </div>
      </div>
    </article>
  );
}
