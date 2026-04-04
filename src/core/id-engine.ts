import { concatHex, keccak256, toHex } from 'viem';

import { canonicalizeLabel, canonicalizeSource, canonicalizeUrl } from './canonicalizer';
import type { BaseAtom, Bytes32, TripleDraft } from '../types/schema';

export type AtomKind = 'url' | 'source' | 'label';

export interface GetAtomIdOptions {
  kind?: AtomKind;
}

export interface ResolvedTripleDraftIds {
  subjectId: Bytes32;
  predicateId: Bytes32;
  objectId: Bytes32;
  tripleId: Bytes32;
}

const URL_PREFIX_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const HOST_WITH_TRAILING_PART_RE =
  /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#].+)$/i;
const BARE_HOST_RE = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/i;

function hasExplicitUrlPath(text: string): boolean {
  const candidate = URL_PREFIX_RE.test(text) ? text : `https://${text}`;
  const parsed = new URL(candidate);

  return parsed.pathname !== '/' || Boolean(parsed.search) || Boolean(parsed.hash);
}

function canonicalizeByKind(text: string, kind: AtomKind): string {
  switch (kind) {
    case 'url':
      return canonicalizeUrl(text);
    case 'source':
      return canonicalizeSource(text);
    case 'label':
    default:
      return canonicalizeLabel(text);
  }
}

export function inferAtomKind(text: string): AtomKind {
  const trimmed = text.trim();

  if (HOST_WITH_TRAILING_PART_RE.test(trimmed)) {
    return 'url';
  }

  if (BARE_HOST_RE.test(trimmed)) {
    return 'source';
  }

  if (URL_PREFIX_RE.test(trimmed)) {
    return hasExplicitUrlPath(trimmed) ? 'url' : 'source';
  }

  return 'label';
}

export function getAtomId(text: BaseAtom, opts: GetAtomIdOptions = {}): Bytes32 {
  const kind = opts.kind ?? inferAtomKind(text);
  const canonicalString = canonicalizeByKind(text, kind);

  return keccak256(toHex(canonicalString)) as Bytes32;
}

export function getTripleId(
  subjectId: Bytes32,
  predicateId: Bytes32,
  objectId: Bytes32,
): Bytes32 {
  return keccak256(concatHex([subjectId, predicateId, objectId])) as Bytes32;
}

export function resolveElementId(element: BaseAtom | TripleDraft): Bytes32 {
  if (typeof element === 'string') {
    return getAtomId(element);
  }

  return resolveTripleDraftIds(element).tripleId;
}

export function resolveTripleDraftIds(triple: TripleDraft): ResolvedTripleDraftIds {
  const subjectId = getAtomId(triple.subject);
  const predicateId = getAtomId(triple.predicate, { kind: 'label' });
  const objectId =
    typeof triple.object === 'string' ? getAtomId(triple.object) : resolveElementId(triple.object);

  return {
    subjectId,
    predicateId,
    objectId,
    tripleId: getTripleId(subjectId, predicateId, objectId),
  };
}
