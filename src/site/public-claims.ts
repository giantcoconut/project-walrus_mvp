import type { ClaimDraftRow } from '../types/schema';

export type PublicClaimType = 'Archive' | 'Arena';

export const PUBLIC_SOURCES: ReadonlyArray<ClaimDraftRow['source']> = [
  'The Block',
  'BBC World News',
];

export function getPublicClaimType(claim: ClaimDraftRow): PublicClaimType {
  return claim.payload_json.arena.length > 0 ? 'Arena' : 'Archive';
}

export function getClaimTripleCount(claim: ClaimDraftRow): number {
  return claim.payload_json.archive.length + claim.payload_json.arena.length;
}

export function getExplorerBaseUrl(): string {
  const configured = process.env.INTUITION_EXPLORER_BASE_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return process.env.INTUITION_CHAIN?.toLowerCase() === 'mainnet'
    ? 'https://explorer.intuition.systems'
    : 'https://testnet.explorer.intuition.systems';
}

export function getExplorerTxUrl(txHash: string | null): string | null {
  if (!txHash) {
    return null;
  }

  return `${getExplorerBaseUrl()}/tx/${txHash}`;
}

export function formatClaimDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function truncateHex(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}
