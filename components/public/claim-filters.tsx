import Link from 'next/link';

import { PUBLIC_SOURCES, type PublicClaimType } from '../../src/site/public-claims';
import type { ClaimDraftRow } from '../../src/types/schema';

interface ClaimFiltersProps {
  activeSource?: ClaimDraftRow['source'] | undefined;
  activeType?: PublicClaimType | undefined;
}

function getFilterHref(
  source?: ClaimDraftRow['source'],
  type?: PublicClaimType,
): string {
  const params = new URLSearchParams();

  if (source) {
    params.set('source', source);
  }

  if (type) {
    params.set('type', type);
  }

  const query = params.toString();

  return query ? `/claims?${query}` : '/claims';
}

function FilterPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        'rounded-full border px-3 py-1.5 text-sm transition-colors duration-150',
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-line bg-white/70 text-muted hover:border-ink hover:text-ink',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}

export function ClaimFilters({ activeSource, activeType }: ClaimFiltersProps) {
  return (
    <div className="space-y-5 border-y border-line/80 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-sm text-muted">Source</span>
        <FilterPill label="All" href={getFilterHref(undefined, activeType)} active={!activeSource} />
        {PUBLIC_SOURCES.map((source) => (
          <FilterPill
            key={source}
            label={source}
            href={getFilterHref(source, activeType)}
            active={activeSource === source}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-sm text-muted">Type</span>
        <FilterPill label="All" href={getFilterHref(activeSource, undefined)} active={!activeType} />
        {(['Archive', 'Arena'] as const).map((type) => (
          <FilterPill
            key={type}
            label={type}
            href={getFilterHref(activeSource, type)}
            active={activeType === type}
          />
        ))}
      </div>
    </div>
  );
}
