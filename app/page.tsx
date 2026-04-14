import Link from 'next/link';

import { ClaimListItem } from '../components/public/claim-list-item';
import { Reveal } from '../components/public/reveal';
import { fetchMintedClaims } from '../src/db/supabase';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const claims = await fetchMintedClaims(7);
  const [leadClaim, ...restClaims] = claims;

  return (
    <div className="mx-auto w-full max-w-[92rem] px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_21rem] lg:items-start">
        <Reveal className="space-y-8" delay={0.03}>
          <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Structured news graph</p>
          <div className="space-y-6">
            <h1 className="max-w-5xl font-serif text-[3.7rem] leading-[0.9] tracking-[-0.055em] text-ink sm:text-[5.8rem]">
              News claims, made legible.
            </h1>
            <p className="max-w-2xl text-base leading-8 text-muted sm:text-lg">
              Aletheia turns live headlines into structured claims with provenance, source context, and
              on-chain continuity. Read the record now. In later phases, this same surface becomes the entry
              point for wallet actions around the claims themselves.
            </p>
          </div>
          <div className="editorial-rule max-w-5xl" />
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
            <span>Claim structure preserved</span>
            <span className="text-line">/</span>
            <span>Source provenance attached</span>
            <span className="text-line">/</span>
            <span>Archive and Arena views</span>
          </div>
        </Reveal>

        <Reveal
          className="border border-line/80 bg-white/70 p-6 shadow-sheet backdrop-blur-[2px]"
          delay={0.12}
        >
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Signal surface</p>
              <p className="text-sm leading-7 text-muted">
                Every claim shown here has already passed through ingestion, structuring, review, and minting.
                The noisy machinery stays behind the glass; the record stays in view.
              </p>
            </div>
            <div className="space-y-3 border-t border-line/70 pt-5">
              <p className="text-sm text-muted">Minted claims live</p>
              <p className="font-serif text-[2.6rem] leading-none tracking-[-0.05em] text-ink">
                {claims.length}
              </p>
            </div>
            <Link
              href="/claims"
              className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper"
            >
              View full archive
            </Link>
          </div>
        </Reveal>
      </div>

      <section className="mt-16 sm:mt-20">
        <div className="mb-6 flex items-end justify-between gap-6">
          <div>
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Recent minted activity</p>
            <h2 className="mt-2 font-serif text-[2.4rem] leading-none tracking-[-0.04em] text-ink sm:text-[3rem]">
              Latest published claims
            </h2>
          </div>
          <Link className="hidden text-sm text-muted transition-colors duration-150 hover:text-ink sm:inline-flex" href="/claims">
            See all minted claims
          </Link>
        </div>

        {leadClaim ? (
          <div>
            <ClaimListItem claim={leadClaim} priority />
            <div className="divide-y divide-line/70">
              {restClaims.map((claim, index) => (
                <Reveal key={claim.id} delay={0.1 + index * 0.04}>
                  <ClaimListItem claim={claim} />
                </Reveal>
              ))}
            </div>
          </div>
        ) : (
          <div className="border border-line/80 bg-white/60 p-8 shadow-sheet">
            <p className="font-serif text-[2rem] tracking-[-0.03em] text-ink">The record is still forming.</p>
            <p className="mt-2 max-w-xl text-sm leading-7 text-muted">
              As new claims clear review and hit the chain, they will appear here with provenance, structure,
              and transaction references.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
