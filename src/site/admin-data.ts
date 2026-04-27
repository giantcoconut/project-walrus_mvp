import { canonicalizeLabel, canonicalizeSource, canonicalizeUrl } from '../core/canonicalizer';
import { getAtomId, getTripleIdFromIds, inferAtomKind } from '../core/id-engine';
import { resolveAndMapEntities, resolveGraphEntities } from '../services/entity-resolver';
import type { EntityResolution } from '../services/entity-resolver';
import type { Bytes32, ClaimDraftRow, EntityMetadata, TripleDraft } from '../types/schema';
import type {
  CandidateEntityResolution,
  FoundEntityResolution,
  MissingEntityResolution,
} from '../services/entity-resolver';

export interface DraftTermInspectionRow {
  original: string;
  kind: 'url' | 'source' | 'label';
  canonical: string;
  localId: string;
  liveTermId: string | null;
  state: 'FOUND' | 'MISSING';
}

export interface DraftGraphTriplePreview {
  scope: 'PRIMARY' | 'SECONDARY' | 'TERTIARY';
  title: string;
  subject: string;
  predicate: string;
  predicateSuggestion: string | null;
  object: string;
  subjectTermId: Bytes32;
  predicateTermId: Bytes32;
  objectTermId: Bytes32;
  tripleId: Bytes32;
}

export interface DraftGraphPreview {
  primaryClaim: DraftGraphTriplePreview | null;
  secondaryClaims: DraftGraphTriplePreview[];
  tertiaryClaims: DraftGraphTriplePreview[];
  atomsFound: DraftTermInspectionRow[];
  atomsMissing: DraftTermInspectionRow[];
  entityFound: Array<{
    name: string;
    termId: string;
    description: string;
  }>;
  entityMissing: Array<{
    name: string;
    description: string;
    url: string | null;
  }>;
  entityCandidates: Array<{
    name: string;
    description: string;
    candidates: CandidateEntityResolution['candidates'];
  }>;
}

export interface DraftInspectionResult {
  rows: DraftTermInspectionRow[];
  entityResolutions: Map<string, EntityResolution>;
  graphPreview: DraftGraphPreview;
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

function renderTripleObject(tripleObject: TripleDraft['object']): string {
  if (typeof tripleObject === 'string') {
    return tripleObject;
  }

  const predicateLabel = tripleObject.predicateSuggestion ?? tripleObject.predicate;

  return `(${tripleObject.subject} ${predicateLabel} ${renderTripleObject(tripleObject.object)})`;
}

function getResolvedPreviewId(
  value: string,
  rows: DraftTermInspectionRow[],
  entityResolutions: Map<string, EntityResolution>,
): Bytes32 {
  const entityResolution = entityResolutions.get(value);

  if (entityResolution?.status === 'FOUND') {
    return entityResolution.termId as Bytes32;
  }

  const row = rows.find((candidate) => candidate.original === value);

  if (row?.liveTermId) {
    return row.liveTermId as Bytes32;
  }

  return getAtomId(value, {
    kind: row?.kind ?? inferAtomKind(value),
  }) as Bytes32;
}

function resolveTriplePreview(
  triple: TripleDraft,
  rows: DraftTermInspectionRow[],
  entityResolutions: Map<string, EntityResolution>,
  scope: DraftGraphTriplePreview['scope'],
  title: string,
): DraftGraphTriplePreview {
  const subjectTermId = getResolvedPreviewId(triple.subject, rows, entityResolutions);
  const predicateTermId = getResolvedPreviewId(triple.predicate, rows, entityResolutions);
  const objectTermId =
    typeof triple.object === 'string'
      ? getResolvedPreviewId(triple.object, rows, entityResolutions)
      : resolveTriplePreview(
          triple.object,
          rows,
          entityResolutions,
          scope,
          `${title} Nested`,
        ).tripleId;

  return {
    scope,
    title,
    subject: triple.subject,
    predicate: triple.predicate,
    predicateSuggestion: triple.predicateSuggestion ?? null,
    object: renderTripleObject(triple.object),
    subjectTermId,
    predicateTermId,
    objectTermId,
    tripleId: getTripleIdFromIds(subjectTermId, predicateTermId, objectTermId),
  };
}

function buildDraftGraphPreview(
  draft: ClaimDraftRow,
  rows: DraftTermInspectionRow[],
  entityResolutions: Map<string, EntityResolution>,
): DraftGraphPreview {
  const primaryClaimTriple = draft.payload_json.archive[0];
  const primaryClaim = primaryClaimTriple
    ? resolveTriplePreview(primaryClaimTriple, rows, entityResolutions, 'PRIMARY', 'Primary claim')
    : null;

  const secondaryClaims = [
    ...draft.payload_json.archive.slice(1).map((triple, index) =>
      resolveTriplePreview(triple, rows, entityResolutions, 'SECONDARY', `Archive context ${index + 1}`),
    ),
    ...draft.payload_json.arena.map((triple, index) =>
      resolveTriplePreview(triple, rows, entityResolutions, 'SECONDARY', `Arena context ${index + 1}`),
    ),
  ];

  const sourceTermId = getResolvedPreviewId(draft.source, rows, entityResolutions);
  const publishedTermId = getResolvedPreviewId('published', rows, entityResolutions);
  const urlTermId = getResolvedPreviewId(draft.url, rows, entityResolutions);
  const assertsTermId = getResolvedPreviewId('asserts', rows, entityResolutions);

  const tertiaryClaims: DraftGraphTriplePreview[] = [
    {
      scope: 'TERTIARY',
      title: 'Source published URL',
      subject: draft.source,
      predicate: 'published',
      predicateSuggestion: null,
      object: draft.url,
      subjectTermId: sourceTermId,
      predicateTermId: publishedTermId,
      objectTermId: urlTermId,
      tripleId: getTripleIdFromIds(sourceTermId, publishedTermId, urlTermId),
    },
  ];

  if (primaryClaim) {
    tertiaryClaims.push({
      scope: 'TERTIARY',
      title: 'URL asserts primary claim',
      subject: draft.url,
      predicate: 'asserts',
      predicateSuggestion: null,
      object: primaryClaim.tripleId,
      subjectTermId: urlTermId,
      predicateTermId: assertsTermId,
      objectTermId: primaryClaim.tripleId,
      tripleId: getTripleIdFromIds(urlTermId, assertsTermId, primaryClaim.tripleId as Bytes32),
    });
  }

  return {
    primaryClaim,
    secondaryClaims,
    tertiaryClaims,
    atomsFound: rows.filter((row) => row.state === 'FOUND'),
    atomsMissing: rows.filter((row) => row.state === 'MISSING'),
    entityFound: Array.from(entityResolutions.entries())
      .filter((entry): entry is [string, FoundEntityResolution] => entry[1].status === 'FOUND')
      .map(([name, resolution]) => ({
        name,
        termId: resolution.termId,
        description: resolution.metadata.description,
      })),
    entityMissing: Array.from(entityResolutions.entries())
      .filter((entry): entry is [string, MissingEntityResolution] => entry[1].status === 'MISSING')
      .map(([name, resolution]) => ({
        name,
        description: resolution.metadata.description,
        url: resolution.metadata.url,
      })),
    entityCandidates: Array.from(entityResolutions.entries())
      .filter(
        (entry): entry is [string, CandidateEntityResolution] => entry[1].status === 'CANDIDATES',
      )
      .map(([name, resolution]) => ({
        name,
        description: resolution.metadata.description,
        candidates: resolution.candidates,
      })),
  };
}

async function resolveLiveIdsForStrings(strings: string[]): Promise<Map<string, `0x${string}`>> {
  try {
    return await resolveGraphEntities(strings);
  } catch {
    return new Map<string, `0x${string}`>();
  }
}

async function resolveEntityMetadataEntries(
  entities: EntityMetadata[],
): Promise<Map<string, EntityResolution>> {
  try {
    return await resolveAndMapEntities(entities);
  } catch {
    return new Map(
      entities.map((metadata) => [
        metadata.name,
        {
          status: 'MISSING',
          metadata,
        } satisfies EntityResolution,
      ]),
    );
  }
}

function buildInspectionResult(
  draft: ClaimDraftRow,
  liveIds: Map<string, `0x${string}`>,
  entityResolutions: Map<string, EntityResolution>,
): DraftInspectionResult {
  const extractedStrings = extractDraftStrings(draft);

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

  return {
    rows,
    entityResolutions,
    graphPreview: buildDraftGraphPreview(draft, rows, entityResolutions),
  };
}

export async function inspectDraftTerms(
  draft: ClaimDraftRow,
): Promise<DraftInspectionResult> {
  const extractedStrings = extractDraftStrings(draft);
  const entityMetadata = Object.values(draft.payload_json.entityMetadata);
  const [liveIds, entityResolutions] = await Promise.all([
    resolveLiveIdsForStrings(extractedStrings),
    resolveEntityMetadataEntries(entityMetadata),
  ]);

  return buildInspectionResult(draft, liveIds, entityResolutions);
}

export async function inspectDraftBatch(
  drafts: ClaimDraftRow[],
): Promise<Map<string, DraftInspectionResult>> {
  if (drafts.length === 0) {
    return new Map();
  }

  const allStrings = drafts.flatMap((draft) => extractDraftStrings(draft));
  const allEntities = drafts.flatMap((draft) => Object.values(draft.payload_json.entityMetadata));
  const [liveIds, globalEntityResolutions] = await Promise.all([
    resolveLiveIdsForStrings(allStrings),
    resolveEntityMetadataEntries(allEntities),
  ]);

  return new Map(
    drafts.map((draft) => {
      const entityResolutions = new Map(
        Object.values(draft.payload_json.entityMetadata).map((metadata) => [
          metadata.name,
          globalEntityResolutions.get(metadata.name) ?? {
            status: 'MISSING' as const,
            metadata,
          },
        ]),
      );

      return [draft.id, buildInspectionResult(draft, liveIds, entityResolutions)];
    }),
  );
}
