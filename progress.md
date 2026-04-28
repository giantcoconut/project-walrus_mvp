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
- Verified `scripts/test-dna.ts` executes successfully under `tsx`

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
- Verified `scripts/test-brain.ts` executes successfully under `tsx` with live Gemini output

#### Phase 3: Staging Layer

- Installed `@supabase/supabase-js` for the Phase 3 staging layer
- Added typed Supabase draft persistence in `src/db/supabase.ts`
- Updated the RSS poller to save parsed payloads as `PENDING` rows in `claim_drafts`
- Added `scripts/test-db.ts` to verify draft insertion into Supabase
- Extended `DraftStatus` to include `MINTED`
- Verified `scripts/test-db.ts` inserts a live `PENDING` draft into Supabase successfully

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
- Verified `src/services/entity-resolver.ts` imports cleanly under `tsx`
- Verified `src/services/chain-executor.ts` imports cleanly under `tsx`

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
- Verified `scripts/test-brain.ts` executes successfully with live Gemini output including `entityMetadata`
- Verified `resolveAndMapEntities(...)` resolves a live `Uniswap` match from the graph

#### Rich Executor Wiring

- Updated `src/services/chain-executor.ts` so entity labels present in `payload_json.entityMetadata` are treated as rich-atom candidates first
- Added sequential `pinThing` IPFS pinning for unresolved rich entities using the active Intuition GraphQL endpoint
- Added reuse logic so pinned IPFS URIs are checked for existing atoms before minting, avoiding unnecessary duplicate creates when the exact rich atom already exists
- Preserved plain-string atom minting only for non-entity terms such as URLs, source labels, predicates, and any remaining draft strings outside `entityMetadata`
- Verified `src/services/chain-executor.ts` imports cleanly under `tsx` after the rich-atom minting changes

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
- Verified `scripts/test-brain.ts` executes successfully against Nvidia NIM
- Verified `scripts/test-ingestion.ts` completes 5 concurrent headline parses successfully with structured JSON output

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
- Verified BBC’s official World Edition headlines RSS feed is live and marked “stable; live” in BBC’s feed documentation
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

#### Phase 5 Public Terminal

- Scaffolded the Next.js 14 App Router frontend foundation for the public site:
  - `app/`
  - `components/public/`
  - Tailwind and PostCSS config
  - Next runtime files and scripts
- Added public minted-only data helpers for:
  - listing `MINTED` claims
  - loading a single minted claim by ID
- Implemented public routes:
  - `/`
  - `/claims`
  - `/claims/[id]`
- Built the public UI in an editorial terminal style with:
  - warm paper palette
  - serif-led typography
  - restrained motion using Framer Motion
  - provenance-first claim presentation
- Added public claim filtering by:
  - source
  - display type (`Archive` or `Arena`)
- Added canonical transaction link generation using the configured or inferred Intuition explorer base URL
- Fixed repo-level compile blockers exposed by the new frontend build:
  - `src/core/key-manager.ts`
  - `src/listeners/rss-poller.ts`
  - `src/services/ai-parser.ts`
  - `src/services/chain-executor.ts`
  - `tsconfig.json`
- Verified `npm run build` completes successfully with the new public pages

#### Phase 5 Admin Ops Console

- Added protected admin access using an `ADMIN_PASSWORD`-backed httpOnly session cookie flow
- Added admin shell and routes:
  - `/admin`
  - `/admin/controls`
  - `/admin/inbox`
  - `/admin/runs`
  - `/admin/runs/[id]`
  - `/admin/drafts/[id]`
  - `/admin/minted`
  - `/admin/errors`
- Added server actions for:
  - admin login/logout
  - manual fetch-latest ingestion
  - approve draft
  - reject draft
  - return errored draft to queue
- Implemented manual ingestion tracing in `src/services/manual-fetch.ts`:
  - creates `claim_runs` headers
  - writes `claim_run_steps` for RSS fetch, canonicalize/dedupe, parse, and DB staging
  - redirects the operator to the resulting run detail page
- Added admin data helpers for:
  - recent draft lists
  - drafts-by-status queries
  - draft counts
  - live term inspection and entity-resolution inspection on the draft detail page
- Added a trace timeline UI for run-step inspection with structured `detail_json`
- Updated the root app chrome so public navigation is hidden on admin routes
- Verified `npm run build` completes successfully with both the public terminal and admin console

#### Phase 5 Admin Refinement

- Upgraded manual ingestion run logging so new `MANUAL_FETCH` traces now include:
  - fetched headline items per feed
  - fresh items selected for parsing
  - skipped items with duplicate reason (`db` or `local`)
- Added the first public protocol-entry route at `/create`
- Wired `/create` into the public navigation as the user-side claim creation surface
- Framed the next product phase directly in the UI:
  - wallet connection and chain readiness
  - public claim composition and protocol write previews
  - future staking and position-taking on created claims
- Added the first working public Intuition create workbench on `/create` with:
  - wallet connection and active-network switching for Intuition mainnet/testnet
  - live atom cost and claim cost reads from the protocol
  - single atom creation for `Thing`, `Person`, `Organization`, `Account (CAIP-10)`, and raw URI/data flows
  - deterministic atom existence checks before create
  - array-based `createAtoms(...)` execution with one item under the hood
- Added public GraphQL-backed protocol helpers and route handlers for:
  - live atom search by label
  - canonical atom lookup by exact label
  - IPFS pinning for rich atom metadata before on-chain creation
- Added human-first claim creation on `/create` with:
  - subject / predicate / object atom search
  - optional exact-match toggle per field
  - inline missing-atom creation that returns directly into the claim flow
  - deterministic triple existence checks before `createTriples(...)`
  - list-style tag mode that resolves the active network’s canonical `has tag` predicate candidate automatically
- Added `infrastrucure-clarity.md` to capture protocol assumptions, heuristics, and unresolved product questions for the public write phase
- Verified `tsc --noEmit` passes after the public Intuition create-flow implementation
- Simplified the public `/create` route by removing the internal-facing “phase now / phase later” section from the page
- Reworked atom creation UX so existing-atom lookup now happens automatically in the background from the current name/value instead of through a primary manual “check existing atom” button
- Added inline “Use existing” actions for background atom matches in the public atom creator
- Verified `tsc --noEmit` passes after the `/create` page UX cleanup
- Reduced above-the-fold copy and moved the `/create` page directly into the action surface faster
- Reworked the public create workbench into a tabbed layout with:
  - `Claim creation` as the default first tab
  - `Atom creation` as a secondary tab instead of the first long section
  - a compact shared session strip for wallet state, network, and live protocol costs
- Verified `tsc --noEmit` passes after the claim-first tabbed `/create` layout update
- Refined the `/create` workbench UX again by:
  - moving the Atom/Claim tabs into the actual creation surface instead of the separate session strip
  - switching the default public tab back to `Atom creation`
  - cleaning the connected-wallet state so the main action no longer still reads `Connect wallet` after connection
  - adding a live pulsing network indicator on the active `testnet` / `mainnet` selector
  - renaming claim mode copy from protocol jargon (`Standard triple` / `Tag claim`) to clearer product labels (`Direct claim` / `Add a tag`)
- Verified `tsc --noEmit` passes after the `/create` session and tab UX refinement
- Split list creation out from direct claim creation by:
  - removing the temporary tag-style mode from the public claim composer
  - keeping direct claim creation distinct from list creation inside the public write surface
  - initially sketching a dedicated public `/lists` route as a possible future list-builder surface
- Verified `tsc --noEmit` passes after the direct-claims versus lists separation
- Kept list creation visible inside the main `/create` hub by:
  - adding `Lists` as a first-class third tab beside `Atom creation` and `Claim creation`
  - keeping the lists concept inside the same creation hub instead of forcing a separate public page
  - updating `/create` hero copy so the page now clearly covers atoms, claims, and lists together
- Verified `tsc --noEmit` passes after the create-hub lists integration
- Upgraded `/admin/runs/[id]` to show:
  - fetched headline list
  - fresh headline list
  - skipped headline list
  - drafts created by that run
  - run summary counts for fetched, new, skipped, and created drafts
- Extended `src/db/supabase.ts` with `getDraftsByIds(...)` so run detail pages can resolve created draft links
- Extended `src/site/admin-data.ts` to compute a deterministic graph preview for each draft:
  - primary claim
  - secondary claims
  - tertiary provenance bundle
  - atoms found on graph
  - atoms missing and likely to be created
- Reworked `/admin/drafts/[id]` so the draft inspector now shows:
  - semantic claim stack before raw JSON
  - atom found/create split
  - rich entity resolution state
  - triple IDs and term IDs for the proposed graph bundle
- Verified targeted import checks for the refined admin modules:
  - `src/site/admin-data.ts`
  - `src/services/manual-fetch.ts`
  - `app/admin/runs/[id]/page.tsx`
  - `app/admin/drafts/[id]/page.tsx`
- Expanded feed inspection depth from `3` to `10` headlines per source for:
  - admin manual fetch runs
  - `scripts/test-ingestion.ts`
- Centralized the shared feed lookback setting in `src/listeners/rss-poller.ts`
- Tightened draft graph preview typing so the repo passes `tsc --noEmit` cleanly after the ingestion update
- Upgraded `/admin/controls` fetch UX so the manual run button now:
  - disables on submit
  - shows a spinner immediately
  - rotates through descriptive pipeline-stage messages while the server action is running
- Added explicit runtime context on the controls page explaining that fetch latency is driven by live feed fetches, dedupe checks, parser calls, and database writes
- Reworked `/admin/runs/[id]` so created drafts now surface inline:
  - primary claim preview
  - atom found/create counts
  - suggested new atoms
  - direct semantic links into each draft inspector
- Added batch draft inspection in `src/site/admin-data.ts` so run pages can render semantic previews for multiple drafts efficiently
- Added a fallback fetched-headline derivation path on the run page using fresh + skipped items when older traces do not expose fetched items cleanly
- Reformatted `/admin/drafts/[id]` to fix long-value overflow and narrow-column collapse by:
  - replacing squeezed atom rows with stacked term cards
  - wrapping IDs and URLs in dedicated monospace blocks
  - widening the draft sidebar column
  - constraining raw payload JSON to a scrollable viewport
- Verified `tsc --noEmit` passes after the draft-page formatting fix
- Restructured the public site header so navigation now reads as:
  - `Home`
  - `Claims`
  - `Learn`
- Added `/learn` as a future-facing public education route with a structured coming-soon layout for protocol and product onboarding
- Verified `tsc --noEmit` passes after the public nav and learn-page update
- Hardened `src/services/ai-parser.ts` to resolve provider-prefixed NVIDIA model IDs dynamically via `models.list()`
- Added clearer parser error surfacing that now includes the configured model and upstream status in failure messages
- Verified `scripts/test-brain.ts` succeeds again against the live NVIDIA parser path after the model-resolution fix
- Added an explicit NVIDIA parser request timeout so stalled model calls fail fast instead of blocking the admin fetch indefinitely
- Parallelized manual fetch parsing in `src/services/manual-fetch.ts` with a bounded worker pool so fresh headlines are processed in small batches instead of strictly one-by-one
- Verified `tsc --noEmit` passes after the manual-fetch throughput fix
- Restored the shared feed lookback from `10` back to `3` headlines per source after live admin runs showed the larger batch was overwhelming the current parser runtime
- Verified `scripts/test-ingestion.ts` completes successfully again with the smaller `3 + 3` fetch window, including fresh draft saves to Supabase
- Cleaned stale `GEMINI` labels in `scripts/test-ingestion.ts` so parser logs now use provider-neutral `PARSER` wording
- Reintroduced `@google/genai` and added `scripts/benchmark-parsers.ts` plus `npm run benchmark:parsers` for direct Gemini-vs-NVIDIA latency checks on fixed sample headlines
- Benchmarked smaller NVIDIA candidates against `gemini-2.5-flash` and selected `nemotron-mini-4b-instruct` as the first fast model that both supports the current JSON-mode parser contract and completes reliably
- Updated `.env` so the active NVIDIA parser model is now `nemotron-mini-4b-instruct`
- Verified `scripts/test-brain.ts` succeeds again on the live parser path with the new NVIDIA model
- Re-ran NVIDIA model selection after reviewing payload quality and benchmarked higher-quality candidates including `mistral-nemotron`, `deepseek-v3.1-terminus`, `minimax-m2.7`, and `mistral-small-3.1-24b-instruct-2503`
- Promoted `mistral-nemotron` to the active NVIDIA parser model after it completed reliably and produced materially richer triples and entity metadata than `nemotron-mini-4b-instruct`
- Verified `scripts/test-brain.ts` succeeds with `mistral-nemotron` and yields usable entity metadata on live sample headlines
- Reverted a prompt-only semantic steering experiment in `src/services/ai-parser.ts` after concluding the deeper limitation is the narrow predicate vocabulary rather than prompt wording alone
- Implemented the selected dual-predicate draft model:
  - `predicate` remains the canonical graph-safe predicate
  - `predicateSuggestion` preserves the model's natural-language relation in draft payloads
- Updated `src/services/ai-parser.ts` so the model now emits freeform relation phrases while the parser maps them into the canonical predicate enum
- Updated admin and public triple rendering so views can surface the natural predicate suggestion while still showing the canonical predicate when they differ
- Verified the live parser returns dual predicate data, e.g. `predicate: "asserts"` with `predicateSuggestion: "joins"` for the Madonna/Coachella sample
- Expanded the canonical MVP predicate set in `src/types/schema.ts` to better cover real news actions, including:
  - `announced`
  - `investigating`
  - `charged`
  - `arrested`
  - `sanctioned`
  - `halted`
  - `warned`
  - `partnered`
  - `raised`
  - `appointed`
- Updated predicate normalization in `src/services/ai-parser.ts` so common tense and phrasing variants map into the new canonical predicates cleanly
- Verified `tsc --noEmit` passes after the predicate expansion
- Upgraded `src/services/entity-resolver.ts` from a binary `FOUND/MISSING` model to also return `CANDIDATES` for ambiguous entity matches
- Added resolver candidate details including label, type, description, image, URL, score, and vault-position signal for admin review
- Updated `/admin/drafts/[id]` to surface “Possible matches found” with candidate atom cards instead of only showing missing/found rich-entity states
- Verified `tsc --noEmit` passes after the resolver candidate-state upgrade

- Tightened candidate surfacing in `src/services/entity-resolver.ts` so weak label-only matches are penalized and fewer unrelated atoms are shown as possible reuse options
- Renamed draft UI candidate scoring language from implied confidence to explicit `match score` so the score is presented honestly as a heuristic ranking signal
- Hardened `src/services/ai-parser.ts` to preserve exact headline surface forms for named entities and avoid accidental proper-noun autocorrection
- Verified with a live parser sample that `Strait of Hormuz` is preserved correctly and its `is_a` context no longer collapses into `straight`
- Replaced the Lists placeholder in `components/public/create-workbench.tsx` with a real Intuition list builder based on the canonical `has tag` predicate atom
- Implemented list entry modes for:
  - single atom add
  - manual batch adds
  - CSV-assisted member import
- Wired list creation to Intuition `createTriples(...)` so each list entry is submitted as:
  - subject = member atom
  - predicate = canonical `has tag`
  - object = list atom
- Added list-atom search and inline list-atom creation directly inside the Lists tab
- Added CSV member resolution that:
  - searches exact human-readable names against the graph
  - auto-resolves confident matches
  - prefers atoms created by the connected wallet when multiple exact matches exist
  - flags ambiguous or missing rows for manual review instead of guessing
- Extended shared atom search results with creator metadata so public creation flows can surface and prefer wallet-owned atoms when appropriate
- Verified `tsc --noEmit` passes after the list-builder and search-resolution upgrade

#### Notes

- This log is intended to be updated incrementally after each successful task.
