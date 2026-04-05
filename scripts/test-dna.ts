import { canonicalizeUrl } from '../src/core/canonicalizer';
import { getAtomId, resolveElementId, resolveTripleDraftIds } from '../src/core/id-engine';
import type { TripleDraft } from '../src/types/schema';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const rawUrlA =
  'https://www.Example.com/news//acquisition-story/?utm_source=x&fbclid=tracker&b=2&a=1#top';
const rawUrlB =
  'http://example.com/news/acquisition-story/?a=1&b=2&utm_campaign=spring-launch#update';

const canonicalUrlA = canonicalizeUrl(rawUrlA);
const canonicalUrlB = canonicalizeUrl(rawUrlB);

const urlAtomIdA = getAtomId(rawUrlA);
const urlAtomIdB = getAtomId(rawUrlB);

const claimTriple: TripleDraft = {
  subject: 'Acme Corp',
  predicate: 'acquired',
  object: 'Beta Labs',
};

const provenanceTripleA: TripleDraft = {
  subject: rawUrlA,
  predicate: 'asserts',
  object: claimTriple,
};

const provenanceTripleB: TripleDraft  = {
  subject: rawUrlB,
  predicate: 'asserts',
  object: claimTriple,
};

const claimIds = resolveTripleDraftIds(claimTriple);
const claimObjectId = resolveElementId(claimTriple);
const provenanceIdsA = resolveTripleDraftIds(provenanceTripleA);
const provenanceIdsB = resolveTripleDraftIds(provenanceTripleB);

assert(
  canonicalUrlA === canonicalUrlB,
  'Canonical URL variants should collapse to the same clean anchor.',
);
assert(urlAtomIdA === urlAtomIdB, 'Canonical URL variants should hash to the same atom ID.');
assert(
  claimObjectId === claimIds.tripleId,
  'Nested triple resolution should resolve the nested triple to its deterministic triple ID.',
);
assert(
  provenanceIdsA.tripleId === provenanceIdsB.tripleId,
  'Provenance wrappers should hash identically across raw URL variants.',
);

console.log('=== Aletheia DNA Proof ===');
console.log('Canonical URL A:', canonicalUrlA);
console.log('Canonical URL B:', canonicalUrlB);
console.log('Canonical URLs equal:', canonicalUrlA === canonicalUrlB);
console.log('URL Atom ID A:', urlAtomIdA);
console.log('URL Atom ID B:', urlAtomIdB);
console.log('URL Atom IDs equal:', urlAtomIdA === urlAtomIdB);
console.log('Claim Triple ID:', claimIds.tripleId);
console.log('Resolved Nested Triple ID:', claimObjectId);
console.log('Nested triple resolution works:', claimIds.tripleId === claimObjectId);
console.log('Provenance Triple ID A:', provenanceIdsA.tripleId);
console.log('Provenance Triple ID B:', provenanceIdsB.tripleId);
console.log(
  'Provenance wrapper deterministic across URL variants:',
  provenanceIdsA.tripleId === provenanceIdsB.tripleId,
);
console.log('DNA test passed.');
