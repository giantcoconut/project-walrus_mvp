import { NextRequest, NextResponse } from 'next/server';

import {
  getIntuitionNetwork,
  type IntuitionAtomSearchResult,
  type PublicIntuitionNetwork,
} from '../../../../src/intuition/public';

interface GraphValueDetails {
  description?: string | null;
  image?: string | null;
  url?: string | null;
}

interface GraphAtomCandidate {
  term_id: string;
  label: string;
  type: string;
  data?: string | null;
  creator?: {
    id?: string | null;
    label?: string | null;
  } | null;
  value?: {
    thing?: GraphValueDetails | null;
    organization?: GraphValueDetails | null;
    person?: GraphValueDetails | null;
  } | null;
  term?: {
    vaults?: Array<{
      position_count: number;
      total_shares: string;
    }>;
  } | null;
}

const SEARCH_ATOMS_QUERY = `
  query SearchAtoms($pattern: String!, $limit: Int!) {
    atoms(
      where: { label: { _ilike: $pattern } }
      limit: $limit
    ) {
      term_id
      label
      type
      data
      creator {
        id
        label
      }
      value {
        thing { description image url }
        organization { description image url }
        person { description image url }
      }
      term {
        vaults {
          position_count
          total_shares
        }
      }
    }
  }
`;

const SEARCH_ATOMS_EXACT_QUERY = `
  query SearchAtomsExact($pattern: String!, $limit: Int!) {
    atoms(
      where: { label: { _ilike: $pattern } }
      limit: $limit
    ) {
      term_id
      label
      type
      data
      creator {
        id
        label
      }
      value {
        thing { description image url }
        organization { description image url }
        person { description image url }
      }
      term {
        vaults {
          position_count
          total_shares
        }
      }
    }
  }
`;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeCasefold(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function getValue(candidate: GraphAtomCandidate): GraphValueDetails | null {
  return candidate.value?.organization ?? candidate.value?.person ?? candidate.value?.thing ?? null;
}

function getBestVaultSignal(candidate: GraphAtomCandidate): {
  positionCount: number;
  totalShares: bigint;
} {
  return (candidate.term?.vaults ?? []).reduce(
    (best, vault) => {
      const totalShares = BigInt(vault.total_shares);

      if (
        vault.position_count > best.positionCount ||
        (vault.position_count === best.positionCount && totalShares > best.totalShares)
      ) {
        return {
          positionCount: vault.position_count,
          totalShares,
        };
      }

      return best;
    },
    {
      positionCount: 0,
      totalShares: 0n,
    },
  );
}

function scoreCandidate(candidate: GraphAtomCandidate, query: string, exact: boolean): number {
  const normalizedQuery = normalizeCasefold(query);
  const normalizedLabel = normalizeCasefold(candidate.label);
  const signal = getBestVaultSignal(candidate);
  let score = 0;

  if (normalizedLabel === normalizedQuery) {
    score += 80;
  } else if (!exact && normalizedLabel.startsWith(normalizedQuery)) {
    score += 55;
  } else if (!exact && normalizedLabel.includes(normalizedQuery)) {
    score += 35;
  }

  if (candidate.type !== 'TextObject') {
    score += 18;
  }

  if (getValue(candidate)?.description?.trim()) {
    score += 8;
  }

  score += Math.min(signal.positionCount, 25);

  return score;
}

function mapCandidate(candidate: GraphAtomCandidate): IntuitionAtomSearchResult {
  const value = getValue(candidate);
  const signal = getBestVaultSignal(candidate);

  return {
    termId: candidate.term_id as `0x${string}`,
    label: candidate.label,
    type: candidate.type,
    data: candidate.data ?? null,
    description: value?.description?.trim() ? value.description.trim() : null,
    image: value?.image?.trim() ? value.image.trim() : null,
    url: value?.url?.trim() ? value.url.trim() : null,
    creatorId: candidate.creator?.id?.trim() ? candidate.creator.id.trim() : null,
    creatorLabel: candidate.creator?.label?.trim() ? candidate.creator.label.trim() : null,
    positionCount: signal.positionCount,
    totalShares: signal.totalShares.toString(),
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = normalizeWhitespace(searchParams.get('q') ?? '');
  const exact = searchParams.get('exact') === '1';
  const limit = Number.parseInt(searchParams.get('limit') ?? '8', 10);
  const network = (searchParams.get('network') ?? 'testnet') as PublicIntuitionNetwork;

  if (!q) {
    return NextResponse.json({ results: [] satisfies IntuitionAtomSearchResult[] });
  }

  if (network !== 'mainnet' && network !== 'testnet') {
    return NextResponse.json({ error: 'Unsupported network.' }, { status: 400 });
  }

  const config = getIntuitionNetwork(network);
  const query = exact ? SEARCH_ATOMS_EXACT_QUERY : SEARCH_ATOMS_QUERY;
  const variables = {
    pattern: exact ? q : `%${q}%`,
    limit: Math.min(Math.max(limit, 1), 12),
  };

  const response = await fetch(config.graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Atom search failed with HTTP ${response.status}.` },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as {
    data?: {
      atoms?: GraphAtomCandidate[];
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    return NextResponse.json(
      {
        error: payload.errors.map((error) => error.message ?? 'Unknown GraphQL error').join('; '),
      },
      { status: 502 },
    );
  }

  const results = (payload.data?.atoms ?? [])
    .slice()
    .sort((left, right) => scoreCandidate(right, q, exact) - scoreCandidate(left, q, exact))
    .map(mapCandidate);

  return NextResponse.json({
    results,
  });
}
