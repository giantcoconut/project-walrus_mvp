import { ClaimFilters } from '../../components/public/claim-filters';
import { ClaimListItem } from '../../components/public/claim-list-item';
import { Reveal } from '../../components/public/reveal';
import { fetchMintedClaims } from '../../src/db/supabase';
import { getPublicClaimType, type PublicClaimType } from '../../src/site/public-claims';
import type { ClaimDraftRow } from '../../src/types/schema';

export const dynamic = 'force-dynamic';

interface ClaimsPageProps {
  searchParams?: {
    source?: string;
    type?: string;
  };
}

function parseSource(value?: string): ClaimDraftRow['source'] | undefined {
  return value === 'The Block' || value === 'BBC World News' ? value : undefined;
}

function parseType(value?: string): PublicClaimType | undefined {
  return value === 'Archive' || value === 'Arena' ? value : undefined;
}

export default async function ClaimsPage({ searchParams }: ClaimsPageProps) {
  const activeSource = parseSource(searchParams?.source);
  const activeType = parseType(searchParams?.type);
  const claims = await fetchMintedClaims(120, activeSource);
  const filteredClaims = activeType
    ? claims.filter((claim) => getPublicClaimType(claim) === activeType)
    : claims;

  return (
    <div className="mx-auto w-full max-w-[92rem] px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <Reveal className="max-w-4xl space-y-5">
        <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Minted feed</p>
        <h1 className="font-serif text-[3.4rem] leading-[0.92] tracking-[-0.05em] text-ink sm:text-[5rem]">
          Browse the published graph without the operational residue.
        </h1>
        <p className="max-w-2xl text-base leading-8 text-muted">
          Every entry below is already minted. Filters stay intentionally narrow: source provenance and the
          claim surface most visible in the record.
        </p>
      </Reveal>

      <div className="mt-10">
        <ClaimFilters activeSource={activeSource} activeType={activeType} />
      </div>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between gap-4 text-sm text-muted">
          <p>{filteredClaims.length} published claims</p>
          {(activeSource || activeType) && <p>Filters applied</p>}
        </div>

        {filteredClaims.length > 0 ? (
          <div>
            {filteredClaims.map((claim, index) => (
              <Reveal key={claim.id} delay={Math.min(index * 0.03, 0.24)}>
                <ClaimListItem claim={claim} priority={index === 0} />
              </Reveal>
            ))}
          </div>
        ) : (
          <div className="border border-line/80 bg-white/60 p-8 shadow-sheet">
            <p className="font-serif text-[2rem] tracking-[-0.03em] text-ink">No claims match this view.</p>
            <p className="mt-2 max-w-xl text-sm leading-7 text-muted">
              Try clearing one or both filters. The public terminal never exposes drafts, pending review, or
              failed execution attempts.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
