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

export interface TripleDraft {
  subject: BaseAtom;
  predicate: Predicate;
  object: BaseAtom | TripleDraft;
}

export interface ParsedNewsPayload {
  headline: string;
  source: string;
  url: string;
  archive: TripleDraft[];
  arena: TripleDraft[];
}

export type DraftStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ClaimDraftRow {
  id: string;
  headline: string;
  source: string;
  url: string;
  payload_json: ParsedNewsPayload;
  status: DraftStatus;
  tx_hash: string | null;
  created_at: string;
  approved_by: string | null;
}
