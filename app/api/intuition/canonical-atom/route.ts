import { NextRequest, NextResponse } from 'next/server';

import {
  getIntuitionNetwork,
  type IntuitionAtomSearchResult,
  type PublicIntuitionNetwork,
} from '../../../../src/intuition/public';

interface GraphAtomCandidate {
  term_id: string;
  label: string;
  type: string;
  data?: string | null;
  value?: {
    thing?: { description?: string | null; image?: string | null; url?: string | null } | null;
    organization?: { description?: string | null; image?: string | null; url?: string | null } | null;
    person?: { description?: string | null; image?: string | null; url?: string | null } | null;
  } | null;
  term?: {
    vaults?: Array<{
      position_count: number;
      total_shares: string;
    }>;
  } | null;
}

const CANONICAL_QUERY = `
  query CanonicalAtom($label: String!, $limit: Int!) {
    atoms(
      where: { label: { _eq: $label } }
      limit: $limit
    ) {
      term_id
      label
      type
      data
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

function getValue(candidate: GraphAtomCandidate) {
  return candidate.value?.organization ?? candidate.value?.person ?? candidate.value?.thing ?? null;
}

function getPositionSignal(candidate: GraphAtomCandidate) {
  return (candidate.term?.vaults ?? []).reduce(
    (best, vault) => {
      const shares = BigInt(vault.total_shares);

      if (
        vault.position_count > best.positionCount ||
        (vault.position_count === best.positionCount && shares > best.totalShares)
      ) {
        return {
          positionCount: vault.position_count,
          totalShares: shares,
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

function mapCandidate(candidate: GraphAtomCandidate): IntuitionAtomSearchResult {
  const value = getValue(candidate);
  const signal = getPositionSignal(candidate);

  return {
    termId: candidate.term_id as `0x${string}`,
    label: candidate.label,
    type: candidate.type,
    data: candidate.data ?? null,
    description: value?.description?.trim() ? value.description.trim() : null,
    image: value?.image?.trim() ? value.image.trim() : null,
    url: value?.url?.trim() ? value.url.trim() : null,
    positionCount: signal.positionCount,
    totalShares: signal.totalShares.toString(),
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const label = (searchParams.get('label') ?? '').trim();
  const network = (searchParams.get('network') ?? 'testnet') as PublicIntuitionNetwork;

  if (!label) {
    return NextResponse.json({ error: 'Label is required.' }, { status: 400 });
  }

  if (network !== 'mainnet' && network !== 'testnet') {
    return NextResponse.json({ error: 'Unsupported network.' }, { status: 400 });
  }

  const config = getIntuitionNetwork(network);
  const response = await fetch(config.graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: CANONICAL_QUERY,
      variables: {
        label,
        limit: 10,
      },
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Canonical atom lookup failed with HTTP ${response.status}.` },
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

  const bestCandidate = (payload.data?.atoms ?? [])
    .slice()
    .sort((left, right) => {
      const leftSignal = getPositionSignal(left);
      const rightSignal = getPositionSignal(right);

      if (right.type !== left.type) {
        if (right.type !== 'TextObject' && left.type === 'TextObject') {
          return 1;
        }

        if (left.type !== 'TextObject' && right.type === 'TextObject') {
          return -1;
        }
      }

      if (rightSignal.positionCount !== leftSignal.positionCount) {
        return rightSignal.positionCount - leftSignal.positionCount;
      }

      if (rightSignal.totalShares !== leftSignal.totalShares) {
        return rightSignal.totalShares > leftSignal.totalShares ? 1 : -1;
      }

      return 0;
    })[0];

  return NextResponse.json({
    atom: bestCandidate ? mapCandidate(bestCandidate) : null,
  });
}
