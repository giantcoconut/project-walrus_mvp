import 'server-only';

import { canonicalizeLabel, canonicalizeSource, canonicalizeUrl } from '../core/canonicalizer';
import { getAtomId, inferAtomKind } from '../core/id-engine';
import { resolveAndMapEntities, resolveGraphEntities } from '../services/entity-resolver';
import type { ClaimDraftRow, EntityResolution, TripleDraft } from '../types/schema';

export interface DraftTermInspectionRow {
  original: string;
  kind: 'url' | 'source' | 'label';
  canonical: string;
  localId: string;
  liveTermId: string | null;
  state: 'FOUND' | 'MISSING';
}

function collectStringsFromTriple(triple: TripleDraft, collector: Set<string>): void {
  collector.add(triple.subject);
  collector.add(triple.predicate);

  if (typeof triple.object === 'string') {
    collector.add(triple.object);
    return;
  }

  collectStringsFromTriple(triple.object, collector);
}

export function extractDraftStrings(draft: ClaimDraftRow): string[] {
  const strings = new Set<string>([draft.source, draft.url, 'published', 'asserts']);

  for (const triple of draft.payload_json.archive) {
    collectStringsFromTriple(triple, strings);
  }

  for (const triple of draft.payload_json.arena) {
    collectStringsFromTriple(triple, strings);
  }

  return Array.from(strings);
}

function canonicalizeByKind(value: string, kind: DraftTermInspectionRow['kind']): string {
  if (kind === 'url') {
    return canonicalizeUrl(value);
  }

  if (kind === 'source') {
    return canonicalizeSource(value);
  }

  return canonicalizeLabel(value);
}

export async function inspectDraftTerms(
  draft: ClaimDraftRow,
): Promise<{
  rows: DraftTermInspectionRow[];
  entityResolutions: Map<string, EntityResolution>;
}> {
  const extractedStrings = extractDraftStrings(draft);
  const liveIds = await resolveGraphEntities(extractedStrings);
  const rows = extractedStrings.map((value) => {
    const kind = inferAtomKind(value);
    const canonical = canonicalizeByKind(value, kind);
    const liveTermId = liveIds.get(value) ?? null;

    return {
      original: value,
      kind,
      canonical,
      localId: getAtomId(value, { kind }),
      liveTermId,
      state: liveTermId ? 'FOUND' : 'MISSING',
    } satisfies DraftTermInspectionRow;
  });

  const entityResolutions = await resolveAndMapEntities(Object.values(draft.payload_json.entityMetadata));

  return {
    rows,
    entityResolutions,
  };
}
