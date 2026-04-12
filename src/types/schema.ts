export type Bytes32 = `0x${string}`;

export type BaseAtom = string;

export const MVP_PREDICATES = [
  'published',
  'asserts',
  'mentions',
  'acquired',
  'hacked',
  'launched',
  'sued',
  'approved',
  'will_reach',
  'will_depeg',
  'is_a',
] as const;

export type Predicate = (typeof MVP_PREDICATES)[number];

export type ApprovedSource = 'The Block' | 'BBC World News';

export interface TripleDraft {
  subject: BaseAtom;
  predicate: Predicate;
  object: BaseAtom | TripleDraft;
}

export interface EntityMetadata {
  name: string;
  description: string;
  url: string | null;
}

export type EntityMetadataMap = Record<string, EntityMetadata>;

export interface ParsedNewsPayload {
  headline: string;
  source: string;
  url: string;
  archive: TripleDraft[];
  arena: TripleDraft[];
  entityMetadata: EntityMetadataMap;
}

export type DraftStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'MINTING'
  | 'MINTED'
  | 'ERROR';

export interface ClaimDraftRow {
  id: string;
  source: ApprovedSource;
  url: string;
  headline: string;
  payload_json: ParsedNewsPayload;
  status: DraftStatus;
  created_at: string;
  approved_at: string | null;
  tx_hash: string | null;
  last_error: string | null;
}
