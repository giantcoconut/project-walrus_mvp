# Walrus on Intuition: Dev Concerns and How We Avoid Them

This document lists the most likely concerns the founders or core team might raise about a news-powered dapp, and the concrete design and implementation choices that prevent those concerns from becoming real problems.

## Why this app is valuable to the protocol

Walrus is a high-frequency pipeline that turns real world reporting into Intuition primitives:

- **Atoms**: sources, URLs, entities, topics, events
- **Triples**: published relationships, mentions, categories, and (when safe) canonical claims
- **Signals**: stake-backed support or opposition on claims, revealing conviction dynamics over time

This produces:
- constant protocol activity and growth
- a structured, queryable dataset that is legible to normal users
- a clean showcase of the protocol’s differentiator, signals

---

## Concern 1: “This could become a misinformation printer”

### Why they might worry
If the app auto-generates structured claims from headlines, it can accidentally publish claims that the underlying article does not support. That risk gets worse with vague, sensational, or ambiguous headlines.

### How we avoid it

#### A. Separate artifact truth from interpretation
Treat the news article as the primary artifact:

- Always create atoms and triples for:
  - Source
  - Article URL
  - Publish timestamp
  - Category
  - Mentions, entities, topics
- Only create canonical claim triples when a headline matches supported patterns with high confidence

This preserves maximum ingestion without forcing claim generation on low quality inputs.

#### B. Only auto-generate claims for safe templates
Supported MVP claim templates should be limited to “hard news” structures that are easy to parse:

- Court ruled X
- Agency arrested X
- Government announced Y
- Company reported earnings Y
- Authority issued directive Y
- Election body declared results Y

Skip canonical claims when headlines are:
- vague or idiomatic
- opinion framing
- rhetorical or clickbait
- missing a clear subject or action

#### C. Always bind claims to provenance
Every claim must point back to its origin:

- Store the article URL atom and source atom
- Create explicit provenance triples like:
  - Source → published → ArticleURL
  - ArticleURL → mentions → Entity
  - ArticleURL → category → CategoryAtom
  - ArticleURL → supportsContextFor → ClaimTriple (or equivalent linkage)

This makes auditing simple.

#### D. UI and copy must avoid “truth claims”
The UX should never label claims as true or false. Use language like:
- “Community signal”
- “Support vs oppose”
- “Conviction”
- “Contested”

Add a clear disclaimer:
- “Signals represent community conviction, not absolute truth.”

---

## Concern 2: “Graph pollution, too many low quality atoms and triples”

### Why they might worry
News ingestion can be high volume. Without controls, the graph gets noisy:
- duplicates of the same article
- multiple claim variants for one event
- inconsistent entity naming and linking

### How we avoid it

#### A. Strict deduplication
Implement a deterministic dedupe layer:
- URL canonicalization (strip tracking params)
- content hash for headline + source + timestamp
- similarity detection for near-duplicate headlines

#### B. Event clustering to reduce fragmentation
Cluster articles into event hubs:
- one event atom per story cluster
- multiple article URL atoms link to the event atom
- claims attach at the event level when possible

This keeps the graph navigable and makes UX better.

#### C. Strong entity resolution and normalization
Normalize entity atoms:
- stable naming rules
- alias handling
- entity type tagging (person, org, place, topic)
- avoid creating new entity atoms when a match already exists

#### D. Quality gates before minting canonical claims
Use a decision gate:
- if confidence < threshold, do headline-only
- if headline matches supported template, mint canonical claim
- if not, skip claim creation

This reduces low quality claim triples.

---

## Concern 3: “Incentive exploitation, brigading, manipulation”

### Why they might worry
Stake-based signaling can be gamed:
- coordinated groups push signals to manipulate feeds
- whales dominate the narrative
- spam accounts create noise or drama

### How we avoid it

#### A. Rate limiting and stake-to-act controls
Controls for actions like:
- posting comments
- proposing alternative claim formulations
- rapid repeated signaling

Examples:
- small stake requirement for posting, refundable when content is not flagged
- per-account and per-IP rate limits
- cooldown windows for repeated actions

#### B. Surface concentration and anomaly indicators
Add transparency features:
- show stake concentration, top holders, distribution
- flag sudden signal spikes from new accounts
- mark events that are likely brigaded based on heuristics

This makes manipulation visible.

#### C. Community moderation + escalation tooling
Implement:
- flagging and review queue
- temporary hides pending review
- escalation tiers: warn, throttle, mute, ban
- volunteer moderator roles with limited powers

Define a simple incident playbook:
- what to do when an event becomes a harassment magnet
- how to handle doxxing attempts
- how to respond to coordinated raids

---

## Concern 4: “Legal and reputational risk, defamation or harassment”

### Why they might worry
News claims about people can lead to:
- defamation disputes
- targeted harassment
- unsafe content spreading fast

### How we avoid it

#### A. Wording and positioning
The product is a signal layer, not a truth oracle:
- never label sources as “liars” or “fake news”
- never label claims as “true” or “false”
- use “contested,” “supported,” “high conviction,” “low conviction”

#### B. Restrict claim templates for sensitive subjects
For MVP:
- avoid auto-claims involving private individuals unless the source is high credibility and the claim is explicitly stated
- prioritize claims tied to official statements, court rulings, published data

#### C. Clear policy and enforcement
Publish:
- community guidelines
- harassment policy
- doxxing prohibition
- appeal process for moderation actions

#### D. Provenance and transparency
Always show:
- the original source link
- timestamp
- any edits to the canonical claim object
- claim version history if needed

This reduces ambiguity and improves defensibility.

---

## Concern 5: “This is just a wrapper around a claims portal, not unique”

### Why they might worry
If there is already a portal for user-generated claims, they may ask what is new here.

### How we avoid it

#### A. Anchor the differentiation in automation and discovery
Walrus is not user claim creation as the main feature. It is:

- high-frequency ingestion from sources
- deterministic normalization and event clustering
- canonical claim factory for supported headline types
- protocol-native feeds:
  - Breaking, Hot (velocity), Contested, Reversal
- event hubs with timeline + signal history

This is a new distribution and discovery layer for claims, built from news velocity.

#### B. Make event hubs the centerpiece
Event hubs make the protocol feel legible:
- multiple sources and articles converge to one event
- claim set evolves with time
- signal history shows shifting belief

This is both a UX differentiator and a protocol showcase.

---

## Implementation checklist for trustworthiness

### Data pipeline controls
- [ ] URL canonicalization and dedupe
- [ ] similarity detection for near-duplicate headlines
- [ ] source allowlist for MVP
- [ ] event clustering and stable event atom IDs
- [ ] entity resolution and alias mapping

### Claim generation controls
- [ ] supported template list for MVP
- [ ] confidence threshold gate for minting canonical claims
- [ ] fallback to headline-only when uncertain
- [ ] provenance linkage from claim to article URL and source

### UX and policy controls
- [ ] no true or false language in UI
- [ ] signal is labeled as conviction
- [ ] contested, velocity, reversal explanations in-app
- [ ] community guidelines and moderation tools
- [ ] anti-harassment and anti-doxxing enforcement

### Abuse resistance controls
- [ ] rate limiting per account and per IP
- [ ] stake-to-act for spam prone actions
- [ ] anomaly indicators for brigading
- [ ] moderator workflows and escalation playbook

---

## Founder friendly pitch framing

Walrus is a high-frequency demonstration of Intuition’s primitives:
- It grows the graph continuously using real world reporting artifacts.
- It makes signals the core discovery mechanism.
- It produces event hubs that show belief shifting over time.
- It stays safe and credible through strict claim templates, provenance binding, and headline-only fallback.

Signals represent community conviction, not absolute truth.