# Aletheia: System Context and Phase 1 DNA Spec

## What we are building
Aletheia is an AI-driven decentralized news oracle that ingests real-world events and transforms them into semantic truth markets on the Intuition Protocol (Layer 3 on Base).

Aletheia solves:
1) Cold start / low data velocity: the Intuition graph needs high-quality data flow.
2) Read-only news feeds: users cannot economically signal conviction on claims.

Aletheia outputs two classes of semantic assets:
- Archive: factual, deterministic, infrastructure triples for the knowledge graph.
- Arena: provocative, debatable triples intended to be contested and staked on.

## Core primitives (Intuition model)
- Atom: an entity term (string input) that becomes a deterministic bytes32 term id.
- Triple: a claim in Subject -> Predicate -> Object form.
- Nested Triple: a Triple can be used as an Atom (object can be another triple), enabling tertiary claims like provenance wrappers.

## Protocol and SDK constraints
We are using:
- @0xintuition/sdk (v2)
- @0xintuition/protocol (v2)
- viem (v2)

In Intuition v2:
- All identifiers (Atoms and Triples) are called terms.
- Terms are bytes32 hex strings.
- Atoms and Triples have deterministic IDs, derived from inputs.

### Deterministic ID rules (CRITICAL)
Atom ID:
- id(atomText) = keccak256(lowercase(trim(atomTextCanonical)))
- Canonicalization MUST be applied before hashing.
- Output is bytes32.

Triple ID:
- id(triple) = keccak256(concat(subjectId, predicateId, objectId))
- All three inputs are bytes32.

Nested triples:
- A TripleDraft’s object may be another TripleDraft.
- The nested triple becomes an atom-like term for hashing and referencing.

## Risk posture and provenance philosophy
Aletheia is NOT claiming that an event is objectively true.
Aletheia proves that a specific publisher asserted a claim.

This is enforced by mandatory provenance binding:
- Every Archive triple and every Arena triple MUST be wrapped by a tertiary provenance triple:
  [Clean_Article_URL] [asserts] [ClaimTriple]
This shifts legal and reputational risk to the publisher.

The Clean_Article_URL is the ultimate anchor atom for provenance.

## Canonicalization rules (CRITICAL)
Canonicalization MUST occur before hashing into bytes32 IDs.

### URL canonicalization (Anchor Atom)
We MUST treat article URLs as atoms, but with strict cleaning:
- Strip `http://`, `https://`, and `www.`
- Strip fragments: `#...`
- Strip ALL tracking parameters, including but not limited to:
  - `utm_*` (utm_source, utm_medium, utm_campaign, utm_term, utm_content, utm_id)
  - `gclid`, `fbclid`, `igshid`
  - `mc_cid`, `mc_eid`
  - common ref keys: `ref`, `source`, `campaign`, `cmpid`, `mkt_tok`, `spm`, `si`, `feature`
- Normalize hostname lowercase
- Normalize pathname: remove duplicate slashes, remove trailing slash except root
- Keep remaining query params only if non-tracking; sort remaining query params deterministically

The canonical URL string returned by canonicalizeUrl() becomes the atom input for hashing.

### Label canonicalization
For general labels (entities, predicates, values):
- Unicode normalize NFKC
- Trim
- Lowercase
- Collapse multiple whitespace runs into one space
- Normalize quote characters

### Source canonicalization
Prefer domain extraction if input is URL-like; otherwise treat it as a label:
- If URL-like: extract hostname, lowercase, strip `www.`
- Else canonicalize as label

## MVP predicate dictionary (STRICT)
To prevent predicate bloat, we enforce a strict predicate vocabulary.
The AI schema and runtime types must restrict to exactly:

- published
- asserts
- mentions
- acquired
- hacked
- launched
- sued
- approved
- will_reach
- will_depeg
- is_a

No other predicates are allowed in MVP.

## Project architecture (phased build)
We are building module-by-module. Do not implement beyond the phase requested.

### Phase 1: The DNA (Types and ID Engine)
We implement the following files only:

1) `src/types/schema.ts`
- Define:
  - Bytes32 type
  - BaseAtom = string
  - Predicate union/enum for MVP dictionary
  - TripleDraft interface: { subject; predicate; object: string | TripleDraft }
  - ParsedNewsPayload interface
  - DraftStatus union: PENDING | APPROVED | REJECTED
  - ClaimDraftRow interface (Supabase row shape) with fields:
    - id
    - headline
    - source
    - url
    - payload_json
    - status
    - tx_hash
    - created_at
    - approved_by

2) `src/core/canonicalizer.ts`
- Implement:
  - canonicalizeUrl(input: string): string
  - canonicalizeLabel(input: string): string
  - canonicalizeSource(input: string): string

3) `src/core/id-engine.ts`
- Implement:
  - getAtomId(text, opts?): Bytes32
    - Uses canonicalizers first
    - Hash as keccak256(toHex(canonicalString))
  - getTripleId(subjectId, predicateId, objectId): Bytes32
    - Hash as keccak256(concatHex([subjectId, predicateId, objectId]))
  - resolveElementId(element): Bytes32
    - Recursive support for nested TripleDraft
  - resolveTripleDraftIds(triple)
  - inferAtomKind(text): "url" | "source" | "label"

4) `scripts/test-dna.ts`
- A runnable test script that proves:
  - URL canonicalization strips scheme/www/tracking and yields same canonical string for variants
  - getAtomId(url1) equals getAtomId(url2)
  - nested triple hashing works
  - provenance wrapped triple hash is deterministic across raw URL variants

## Non-goals for Phase 1
Do NOT implement:
- RSS poller
- AI parser
- Supabase client
- Web3 relayer
- Next.js UI
- Discord/Telegram broadcaster
Those come in later phases.

## Quality requirements
- Strict TypeScript, modular, readable
- No unused dependencies
- Deterministic, reproducible hashing
- Clear function boundaries
- No overengineering

End of context.