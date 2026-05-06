# Aletheia Terminal Progress Log

This file tracks completed work as the project moves forward.

## Log

### 2026-04-05

#### Foundation

- Reviewed the uploaded project context:
  - `context.md`
  - `concerns.md`
  - `intuition_whitepaper.pdf`
  - `llms-full.txt`
  - `logo.png`
- Reviewed the installed Intuition skill:
  - `C:\Users\USER\.agents\skills\intuition\SKILL.md`
  - key supporting references for GraphQL, session setup, schemas, and workflows
- Confirmed the product direction and implementation constraints:
  - Phase 1 IDs are app-level canonical text-term IDs only
  - protocol-native structured/data atoms are out of scope for Phase 1
  - predicate scope is locked to the strict MVP enum only
- Populated `.gitignore` with Node/TypeScript, env, build, cache, log, and editor ignores
- Added `friction-log.md` to document blockers, ambiguities, type conflicts, and better alternatives before coding continues

#### Phase 1: DNA

- Implemented Phase 1 files:
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
- Tightened atom-kind inference so bare hostnames resolve as sources instead of article URLs
- Added a proof script for:
  - URL canonicalization equivalence
  - equal atom IDs across URL variants
  - nested triple hashing
  - deterministic provenance wrapper hashing

#### Phase 2: Cognitive Engine

- Implemented Phase 2 files:
  - `src/listeners/rss-poller.ts`
  - `src/services/ai-parser.ts`
  - `scripts/test-brain.ts`
- Added RSS ingestion for:
  - The Block RSS feed
  - CNBC World News feed
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
- Installed approved Phase 2 runtime dependencies:
  - `@google/genai`
  - `rss-parser`
  - `dotenv`
- Confirmed `@types/rss-parser` is not published on npm; using package-provided types instead
- Standardized script execution on `tsx`
- Configured Gemini service to load `GEMINI_API_KEY` from `.env` via `dotenv`
- Added a direct-entry bootstrap so `npx tsx src/listeners/rss-poller.ts` starts the polling loop

#### Phase 3: Staging Layer

- Installed `@supabase/supabase-js` for the Phase 3 staging layer
- Added typed Supabase draft persistence in `src/db/supabase.ts`
- Updated the RSS poller to save parsed payloads as `PENDING` rows in `claim_drafts`
- Added `scripts/test-db.ts` to verify draft insertion into Supabase
- Extended `DraftStatus` to include `MINTED`

#### Gotcha Fixes

- Added silent duplicate handling for `claim_drafts` unique URL collisions
- Added strict `ApprovedSource` typing and enforced exact source names through the RSS poller

#### Phase 4: Agentic Executor

- Added `getTripleIdFromIds(...)` to the ID engine for hashing existing term IDs without re-canonicalization
- Added SDK-fallback graph entity resolution in `src/services/entity-resolver.ts`
- Added on-chain draft minting workflow in `src/services/chain-executor.ts`
- Added Phase 4 CLI curation loop in `scripts/admin-cli.ts`
- Extended draft state handling for:
  - `MINTING`
  - `ERROR`
  - `approved_at`
  - `last_error`
- Re-verified `scripts/test-db.ts` after Phase 4 DB helper changes

#### Rich Atom Upgrade

- Calibrated against a live Intuition mainnet `Uniswap` atom to confirm rich atoms are represented as IPFS-backed `Thing` objects with structured `value.thing` metadata
- Extended `ParsedNewsPayload` to include an `entityMetadata` dictionary keyed by extracted entity label
- Updated the Gemini parser schema and prompt so extracted entities include:
  - `name`
  - `description`
  - `url`
- Added runtime validation for `entityMetadata` in `src/services/ai-parser.ts`
- Added `resolveAndMapEntities(...)` in `src/services/entity-resolver.ts` to search the live graph for rich-entity matches and classify them as `FOUND` or `MISSING`
- Preserved the existing `resolveGraphEntities(...)` fallback for the current executor flow
- Updated `scripts/test-db.ts` to match the richer payload shape

#### Rich Executor Wiring

- Updated `src/services/chain-executor.ts` so entity labels present in `payload_json.entityMetadata` are treated as rich-atom candidates first
- Added sequential `pinThing` IPFS pinning for unresolved rich entities using the active Intuition GraphQL endpoint
- Added reuse logic so pinned IPFS URIs are checked for existing atoms before minting, avoiding unnecessary duplicate creates when the exact rich atom already exists
- Preserved plain-string atom minting only for non-entity terms such as URLs, source labels, predicates, and any remaining draft strings outside `entityMetadata`

### 2026-04-12

#### Nvidia NIM Migration

- Removed `@google/genai` and installed `openai` for Nvidia NIM compatibility
- Added `src/core/key-manager.ts` with `NvidiaKeyManager` for active-key selection and failover rotation
- Updated `.env` usage to rely on `NVIDIA_API_KEY_1` and `NVIDIA_API_KEY_2`
- Replaced the Gemini parser implementation in `src/services/ai-parser.ts` with an OpenAI-compatible Nvidia NIM client pointed at `https://integrate.api.nvidia.com/v1`
- Kept the parser return contract compatible with the existing pipeline by mapping Nvidia JSON-mode output back into `ParsedNewsPayload`
- Added one-retry failover logic on `429`, `500`, and `529` status codes using the key manager
- Hardened parser output normalization so near-miss predicates from the model are repaired into the approved MVP predicate enum
- Normalized entity metadata URLs into canonical HTTP(S) URLs for downstream rich-atom minting
- Added `scripts/test-ingestion.ts` and `package.json` script `test:ingestion` for concurrent parser verification

#### One-Shot Ingestion Audit

- Exported reusable RSS feed config and item extraction helpers from `src/listeners/rss-poller.ts`
- Replaced `scripts/test-ingestion.ts` with a standalone one-time ingestion audit flow
- The audit script now:
  - fetches the latest 3 items from The Block and CNBC World News
  - canonicalizes URLs before dedupe
  - checks both local duplicates and existing Supabase `claim_drafts` URLs before parsing
  - parses only new headlines
  - stages new payloads as `PENDING` drafts in Supabase
- Added founder-readable console logs for RSS fetch count, dedupe summary, parser progress, parser success, and Supabase draft IDs

#### Feed Source Update

- Confirmed the CNBC World News RSS endpoint was returning `503` during live checks
- Replaced CNBC World News with BBC World News in the shared RSS feed configuration and strict approved source typing
- Added `suggested-upgrades.md` to track future improvements across ingestion, parser quality, entity resolution, executor reliability, database ops, and UI review workflow
- Added parser repair warnings so malformed model output is shown explicitly when the parser has to salvage a result
- Added `DESIGN.md` with the agreed Phase 5 design context for the public terminal and admin console

### 2026-04-14

#### Phase 5 Run Trace Foundation

- Implemented the selected two-table observability model in TypeScript:
  - `claim_runs` as the run header shape
  - `claim_run_steps` as the ordered step log shape
- Added run-trace types to `src/types/schema.ts` for:
  - run status
  - trigger source
  - allowed pipeline step names
  - `ClaimRunRow`
  - `ClaimRunStepRow`
- Added Supabase helpers in `src/db/supabase.ts` for:
  - creating run headers
  - updating and finishing runs
  - appending run steps
  - listing runs for `/admin/runs`
  - loading a run trace for `/admin/runs/[id]`
- Logged and resolved the remaining run-model edge case:
  - `draft_id` is treated as nullable for global `MANUAL_FETCH` traces
  - draft-linked runs continue to attach directly to a single `claim_drafts` row

#### Phase 5: Public/Admin Foundation

- Scaffolded the Next.js App Router frontend.
- Added public routes: `/`, `/claims`, `/claims/[id]`.
- Added minted-claim helpers, claim filters, and explorer links.
- Fixed compile blockers in `src/core/key-manager.ts`, `src/listeners/rss-poller.ts`, `src/services/ai-parser.ts`, `src/services/chain-executor.ts`, and `tsconfig.json`.
- Added admin auth, admin routes, server actions, admin data helpers, and run trace UI.
- Implemented manual-ingestion tracing in `src/services/manual-fetch.ts`.
- Hid public nav on admin routes.
- Expanded `MANUAL_FETCH` traces to include fetched, fresh, and skipped headlines.

#### Phase 5 Continued: Admin Console and Pipeline Refinement

- Expanded `/admin/runs/[id]` with fetched, fresh, skipped, created, and summary views.
- Added `getDraftsByIds(...)` and richer draft graph previews in `src/site/admin-data.ts`.
- Reworked `/admin/drafts/[id]` to show claim stacks, atom found/create splits, entity resolution, and graph IDs.
- Centralized feed lookback and temporarily raised it from `3` to `10` for admin fetch review.
- Improved `/admin/controls` fetch UX with disabled state, spinner, staged status copy, and runtime context.
- Reworked `/admin/runs/[id]` to surface created drafts inline with claim previews, atom counts, and direct links.
- Added batch draft inspection and fallback fetched-headline derivation.
- Reformatted `/admin/drafts/[id]` for stacked term cards, wrapped IDs/URLs, a wider sidebar, and scrollable raw JSON.
- Added `/learn` and reduced public nav to `Home`, `Claims`, and `Learn`.
- Hardened parser model resolution, error surfacing, request timeouts, and bounded parallel manual fetch parsing.
- Restored shared feed lookback from `10` back to `3` after live runs showed the larger batch was too heavy.
- Added parser benchmarking and moved the active NVIDIA model from `nemotron-mini-4b-instruct` to `mistral-nemotron`.
- Replaced the single-predicate draft model with canonical `predicate` plus freeform `predicateSuggestion`.
- Expanded the MVP predicate set and normalization rules.
- Upgraded entity resolution from `FOUND/MISSING` to `FOUND/MISSING/CANDIDATES`.
- Added candidate detail cards and stricter candidate scoring on `/admin/drafts/[id]`.
- Hardened parser handling to preserve exact headline entity surface forms.

#### Phase 6: Public Protocol Entry

- Added `/create` and wired it into public nav.
- Built the first public Intuition workbench with wallet connection, network switching, live costs, single-atom creation, duplicate checks, and `createAtoms(...)`.
- Added GraphQL-backed helpers for atom search, canonical lookup, and rich-metadata pinning.
- Added human-first claim creation with subject/predicate/object search, exact-match toggles, inline atom creation, duplicate checks, and `createTriples(...)`.
- Added `infrastrucure-clarity.md` for protocol assumptions and open product questions.
- Simplified `/create` by removing internal roadmap copy.
- Reworked atom creation so existing-atom lookup runs in the background with inline `Use existing` actions.
- Reduced above-the-fold copy and moved `/create` faster into the action surface.
- Reworked `/create` into a tabbed workbench and tightened session, network, and claim-mode UX.
- Kept lists inside `/create` as a first-class tab instead of a separate route.
- Built list creation on top of canonical `has tag` triples with single-entry, manual batch, and CSV flows.
- Added list-atom search and inline list-atom creation inside the Lists tab.
- Added CSV member resolution with exact graph search, confident auto-resolution, wallet-owned preference, and manual review for ambiguous rows.
- Extended shared atom search results with creator metadata so public creation flows can prefer wallet-owned atoms.

#### Notes

- This log is intended to be updated incrementally after each successful task.