import 'dotenv/config';

import { API_URL_DEV, API_URL_PROD, configureClient } from '@0xintuition/graphql';
import { findAtomIds } from '@0xintuition/sdk';
import { type Hex, isHex } from 'viem';

import type { EntityMetadata } from '../types/schema';

type IntuitionChain = 'mainnet' | 'testnet';

interface GraphValueDetails {
  name?: string | null;
  description?: string | null;
  url?: string | null;
  image?: string | null;
}

interface GraphAtomCandidate {
  term_id: string;
  label: string;
  type: string;
  data?: string | null;
  value?: {
    thing?: GraphValueDetails | null;
    organization?: GraphValueDetails | null;
    person?: GraphValueDetails | null;
  } | null;
  term?: {
    vaults?: Array<{
      curve_id: string;
      total_shares: string;
      position_count: number;
    }>;
  } | null;
}

export interface FoundEntityResolution {
  status: 'FOUND';
  metadata: EntityMetadata;
  termId: Hex;
  label: string;
  type: string;
  data: string | null;
  matchedUrl: string | null;
}

export interface EntityResolutionCandidate {
  termId: Hex;
  label: string;
  type: string;
  data: string | null;
  matchedUrl: string | null;
  description: string | null;
  image: string | null;
  score: number;
  positionCount: number;
}

export interface CandidateEntityResolution {
  status: 'CANDIDATES';
  metadata: EntityMetadata;
  candidates: EntityResolutionCandidate[];
}

export interface MissingEntityResolution {
  status: 'MISSING';
  metadata: EntityMetadata;
}

export type EntityResolution =
  | FoundEntityResolution
  | CandidateEntityResolution
  | MissingEntityResolution;

const ENTITY_SEARCH_QUERY = `
  query SearchEntities($pattern: String!, $limit: Int!) {
    atoms(
      where: { label: { _ilike: $pattern } }
      limit: $limit
    ) {
      term_id
      label
      type
      data
      value {
        thing { name description url image }
        organization { name description url image }
        person { name description url image }
      }
      term {
        vaults {
          curve_id
          total_shares
          position_count
        }
      }
    }
  }
`;

function getConfiguredChain(): IntuitionChain {
  const rawChain = process.env.INTUITION_CHAIN?.toLowerCase();

  if (rawChain === 'mainnet' || rawChain === 'testnet') {
    return rawChain;
  }

  return 'testnet';
}

function configureGraphqlClient(): void {
  const chain = getConfiguredChain();

  configureClient({
    apiUrl: chain === 'mainnet' ? API_URL_PROD : API_URL_DEV,
  });
}

function getGraphqlEndpoint(): string {
  return getConfiguredChain() === 'mainnet' ? API_URL_PROD : API_URL_DEV;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeCasefold(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function tokenizeMeaningful(value: string): string[] {
  return normalizeCasefold(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !['the', 'and', 'for', 'with', 'from', 'into', 'over', 'under', 'that'].includes(token),
    );
}

function hasMeaningfulTokenOverlap(left: string, right: string): boolean {
  const leftTokens = new Set(tokenizeMeaningful(left));
  const rightTokens = tokenizeMeaningful(right);

  if (leftTokens.size === 0 || rightTokens.length === 0) {
    return false;
  }

  return rightTokens.some((token) => leftTokens.has(token));
}

function getDomainFromUrl(value: string | null | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function getCandidateValue(candidate: GraphAtomCandidate): GraphValueDetails | null {
  if (!candidate.value) {
    return null;
  }

  return candidate.value.organization ?? candidate.value.person ?? candidate.value.thing ?? null;
}

function getVaultSignal(candidate: GraphAtomCandidate): { totalShares: bigint; positionCount: number } {
  const vaults = candidate.term?.vaults ?? [];

  return vaults.reduce(
    (best, vault) => {
      const totalShares = BigInt(vault.total_shares);

      if (
        vault.position_count > best.positionCount ||
        (vault.position_count === best.positionCount && totalShares > best.totalShares)
      ) {
        return {
          totalShares,
          positionCount: vault.position_count,
        };
      }

      return best;
    },
    {
      totalShares: 0n,
      positionCount: 0,
    },
  );
}

function scoreCandidate(metadata: EntityMetadata, candidate: GraphAtomCandidate): number {
  const normalizedName = normalizeCasefold(metadata.name);
  const normalizedLabel = normalizeCasefold(candidate.label);
  const candidateValue = getCandidateValue(candidate);
  const metadataDomain = getDomainFromUrl(metadata.url);
  const candidateDomain = getDomainFromUrl(candidateValue?.url);
  const tokenOverlap = hasMeaningfulTokenOverlap(metadata.name, candidate.label);
  let score = 0;

  if (normalizedLabel === normalizedName) {
    score += 60;
  } else if (normalizedLabel.includes(normalizedName) || normalizedName.includes(normalizedLabel)) {
    score += 20;
  }

  if (tokenOverlap) {
    score += 20;
  } else if (normalizedLabel !== normalizedName) {
    score -= 35;
  }

  if (candidate.type !== 'TextObject') {
    score += 20;
  } else {
    score -= 10;
  }

  if (candidateValue?.description && candidateValue.description.trim()) {
    score += 10;
  }

  if (metadataDomain && candidateDomain && metadataDomain === candidateDomain) {
    score += 40;
  }

  const signal = getVaultSignal(candidate);
  score += Math.min(signal.positionCount, 10);

  return score;
}

function isHighConfidenceMatch(metadata: EntityMetadata, candidate: GraphAtomCandidate): boolean {
  const score = scoreCandidate(metadata, candidate);
  const normalizedName = normalizeCasefold(metadata.name);
  const normalizedLabel = normalizeCasefold(candidate.label);
  const metadataDomain = getDomainFromUrl(metadata.url);
  const candidateDomain = getDomainFromUrl(getCandidateValue(candidate)?.url);

  if (normalizedLabel === normalizedName && candidate.type !== 'TextObject' && score >= 80) {
    return true;
  }

  if (
    metadataDomain &&
    candidateDomain &&
    metadataDomain === candidateDomain &&
    candidate.type !== 'TextObject' &&
    score >= 75
  ) {
    return true;
  }

  return false;
}

function shouldSurfaceCandidate(
  metadata: EntityMetadata,
  score: number,
  candidate: GraphAtomCandidate,
): boolean {
  if (score >= 55 && hasMeaningfulTokenOverlap(metadata.name, candidate.label)) {
    return true;
  }

  if (score >= 70) {
    return true;
  }

  if (
    candidate.type !== 'TextObject' &&
    score >= 45 &&
    hasMeaningfulTokenOverlap(metadata.name, candidate.label)
  ) {
    return true;
  }

  return false;
}

function buildResolutionCandidate(
  candidate: GraphAtomCandidate,
  score: number,
  positionCount: number,
): EntityResolutionCandidate {
  const candidateValue = getCandidateValue(candidate);

  return {
    termId: candidate.term_id as Hex,
    label: candidate.label,
    type: candidate.type,
    data: candidate.data ?? null,
    matchedUrl: candidateValue?.url?.trim() ? candidateValue.url.trim() : null,
    description: candidateValue?.description?.trim() ? candidateValue.description.trim() : null,
    image: candidateValue?.image?.trim() ? candidateValue.image.trim() : null,
    score,
    positionCount,
  };
}

async function searchAtomsByName(name: string): Promise<GraphAtomCandidate[]> {
  const response = await fetch(getGraphqlEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: ENTITY_SEARCH_QUERY,
      variables: {
        pattern: `%${normalizeWhitespace(name)}%`,
        limit: 10,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL entity search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: { atoms?: GraphAtomCandidate[] };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? 'Unknown GraphQL error').join('; '));
  }

  return payload.data?.atoms ?? [];
}

export async function resolveAndMapEntities(
  entities: EntityMetadata[],
): Promise<Map<string, EntityResolution>> {
  const dedupedEntities = Array.from(
    new Map(
      entities
        .filter((entity) => normalizeWhitespace(entity.name).length > 0)
        .map((entity) => [normalizeCasefold(entity.name), entity]),
    ).values(),
  );
  const resolutions = new Map<string, EntityResolution>();

  for (const entity of dedupedEntities) {
    const candidates = await searchAtomsByName(entity.name);
    const scoredCandidates = candidates
      .filter((candidate) => isHex(candidate.term_id))
      .map((candidate) => ({
        candidate,
        score: scoreCandidate(entity, candidate),
        signal: getVaultSignal(candidate),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        if (right.signal.positionCount !== left.signal.positionCount) {
          return right.signal.positionCount - left.signal.positionCount;
        }

        if (right.signal.totalShares !== left.signal.totalShares) {
          return right.signal.totalShares > left.signal.totalShares ? 1 : -1;
        }

        return left.candidate.label.localeCompare(right.candidate.label);
      });

    const topCandidate = scoredCandidates[0]?.candidate;

    if (topCandidate && isHighConfidenceMatch(entity, topCandidate)) {
      const candidateValue = getCandidateValue(topCandidate);

      resolutions.set(entity.name, {
        status: 'FOUND',
        metadata: entity,
        termId: topCandidate.term_id as Hex,
        label: topCandidate.label,
        type: topCandidate.type,
        data: topCandidate.data ?? null,
        matchedUrl: candidateValue?.url?.trim() ? candidateValue.url.trim() : null,
      });

      continue;
    }

    const surfacedCandidates = scoredCandidates
      .filter((entry) => shouldSurfaceCandidate(entity, entry.score, entry.candidate))
      .slice(0, 3)
      .map((entry) =>
        buildResolutionCandidate(entry.candidate, entry.score, entry.signal.positionCount),
      );

    if (surfacedCandidates.length > 0) {
      resolutions.set(entity.name, {
        status: 'CANDIDATES',
        metadata: entity,
        candidates: surfacedCandidates,
      });

      continue;
    }

    resolutions.set(entity.name, {
      status: 'MISSING',
      metadata: entity,
    });
  }

  return resolutions;
}

export async function resolveGraphEntities(uniqueStrings: string[]): Promise<Map<string, Hex>> {
  const deduped = Array.from(new Set(uniqueStrings.filter((value) => value.trim().length > 0)));

  if (deduped.length === 0) {
    return new Map<string, Hex>();
  }

  if (process.env.USE_MCP === 'true') {
    console.warn('[entity-resolver] USE_MCP=true ignored for this implementation; using SDK fallback.');
  }

  configureGraphqlClient();

  const resolved = await findAtomIds(deduped);
  const resolvedMap = new Map<string, Hex>();

  for (const atom of resolved) {
    if (typeof atom.data === 'string' && isHex(atom.term_id)) {
      resolvedMap.set(atom.data, atom.term_id);
    }
  }

  return resolvedMap;
}
