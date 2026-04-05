# Aletheia Terminal Progress Log

This file tracks completed work as the project moves forward.

## Log

### 2026-04-05

#### Completed

- Reviewed the uploaded project context:
  - `context.md`
  - `concerns.md`
  - `intuition_whitepaper.pdf`
  - `llms-full.txt`
  - `logo.png`
- Reviewed the installed Intuition skill:
  - `C:\Users\USER\.agents\skills\intuition\SKILL.md`
  - Key supporting references for GraphQL, session setup, schemas, and workflows
- Confirmed the product direction and implementation constraints:
  - Phase 1 IDs are app-level canonical text-term IDs only
  - Protocol-native structured/data atoms are out of scope for Phase 1
  - Predicate scope is locked to the strict MVP enum only
- Implemented Phase 1 DNA files:
  - `src/types/schema.ts`
  - `src/core/canonicalizer.ts`
  - `src/core/id-engine.ts`
  - `scripts/test-dna.ts`
- Added strict MVP predicate typing and Phase 1 draft/data interfaces
- Implemented deterministic canonicalization for:
  - article URL anchors
  - source domains
  - labels
- Implemented deterministic ID derivation for:
  - text atoms via `keccak256(toHex(canonicalString))`
  - triples via `keccak256(concatHex([subjectId, predicateId, objectId]))`
- Implemented recursive nested triple resolution
- Added a proof script for:
  - URL canonicalization equivalence
  - equal atom IDs across URL variants
  - nested triple hashing
  - deterministic provenance wrapper hashing
- Tightened atom-kind inference so bare hostnames resolve as sources instead of article URLs


- Implemented Phase 2 Cognitive Engine files:
  - `src/listeners/rss-poller.ts`
  - `src/services/ai-parser.ts`
  - `scripts/test-brain.ts`
- Added RSS ingestion for:
  - The Block RSS feed
  - Reuters feed
- Added a 60-second poller loop with:
  - local in-memory URL hash dedupe
  - canonical URL normalization before dedupe
  - Gemini handoff for unseen items
  - dedupe write only after successful parsing
- Added Gemini structured parsing with:
  - `@google/genai`
  - strict JSON schema aligned to `ParsedNewsPayload`
  - strict MVP predicate enforcement
  - runtime validation of returned JSON payloads
- Added a Phase 2 brain test script for a controversial crypto enforcement headline
- Populated `.gitignore` with Node/TypeScript, env, build, cache, log, and editor ignores
- Installed approved Phase 2 runtime dependencies:
  - `@google/genai`
  - `rss-parser`
  - `dotenv`
- Confirmed `@types/rss-parser` is not published on npm; using package-provided types instead
- Standardized script execution on `tsx`
- Updated the general-news RSS source from Reuters Agency to CNBC World News
- Configured Gemini service to load `GEMINI_API_KEY` from `.env` via `dotenv`
- Added a direct-entry bootstrap so `npx tsx src/listeners/rss-poller.ts` starts the polling loop
- Verified `scripts/test-dna.ts` executes successfully under `tsx`
- Verified `scripts/test-brain.ts` executes successfully under `tsx` with live Gemini output
- Installed `@supabase/supabase-js` for the Phase 3 staging layer
- Added typed Supabase draft persistence in `src/db/supabase.ts`
- Updated the RSS poller to save parsed payloads as `PENDING` rows in `claim_drafts`
- Added `scripts/test-db.ts` to verify draft insertion into Supabase
- Extended `DraftStatus` to include `MINTED`
- Verified `scripts/test-db.ts` inserts a live `PENDING` draft into Supabase successfully

#### Notes

- This log is intended to be updated incrementally after each successful task.
