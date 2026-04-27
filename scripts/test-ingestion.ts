import { canonicalizeUrl } from '../src/core/canonicalizer';
import { saveDraft, supabase } from '../src/db/supabase';
import {
  FEED_HEADLINE_LOOKBACK,
  FEEDS,
  createRssParser,
  getItemLink,
  getItemTitle,
} from '../src/listeners/rss-poller';
import { parseHeadline } from '../src/services/ai-parser';
import type { ApprovedSource, ParsedNewsPayload } from '../src/types/schema';

interface CandidateHeadline {
  source: ApprovedSource;
  headline: string;
  canonicalUrl: string;
}

interface FeedFetchResult {
  source: ApprovedSource;
  items: CandidateHeadline[];
  error: Error | null;
}

function truncateHeadline(headline: string, maxLength = 96): string {
  if (headline.length <= maxLength) {
    return headline;
  }

  return `${headline.slice(0, maxLength - 3)}...`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchFeedHeadlines(feed: (typeof FEEDS)[number]): Promise<FeedFetchResult> {
  const parser = createRssParser();
  
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const parsedFeed = await parser.parseURL(feed.url);
      const items = parsedFeed.items
        .map((item) => {
          const headline = getItemTitle(item);
          const rawUrl = getItemLink(item);

          if (!headline || !rawUrl) {
            return null;
          }

          return {
            source: feed.source,
            headline,
            canonicalUrl: canonicalizeUrl(rawUrl),
          } satisfies CandidateHeadline;
        })
        .filter((item): item is CandidateHeadline => item !== null)
        .slice(0, FEED_HEADLINE_LOOKBACK);

      return {
        source: feed.source,
        items,
        error: null,
      };
    } catch (error) {
      if (attempt < 2) {
        console.log(`[RSS] ${feed.source}: retrying after fetch error...`);
        await sleep(1_500);
        continue;
      }

      return {
        source: feed.source,
        items: [],
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  return {
    source: feed.source,
    items: [],
    error: new Error(`Unknown fetch failure for ${feed.source}.`),
  };
}

async function fetchLatestHeadlines(): Promise<CandidateHeadline[]> {
  const results = await Promise.all(FEEDS.map(fetchFeedHeadlines));
  const collected: CandidateHeadline[] = [];

  for (const result of results) {
    if (result.error) {
      console.error(
        `[RSS] ${result.source} failed: ${getErrorMessage(result.error)}`,
      );
      continue;
    }

    console.log(`[RSS] ${result.source}: fetched ${result.items.length} headlines.`);
    collected.push(...result.items);
  }

  return collected;
}

async function getExistingUrls(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) {
    return new Set<string>();
  }

  const { data, error } = await supabase
    .from('claim_drafts')
    .select('url')
    .in('url', urls);

  if (error) {
    throw error;
  }

  return new Set((data ?? []).map((row) => row.url as string));
}

function dedupeCandidates(candidates: CandidateHeadline[], existingUrls: Set<string>): {
  skipped: number;
  skippedReasons: { local: number; db: number };
  fresh: CandidateHeadline[];
} {
  const localSeen = new Set<string>();
  const fresh: CandidateHeadline[] = [];
  let skippedLocal = 0;
  let skippedDb = 0;

  for (const candidate of candidates) {
    if (localSeen.has(candidate.canonicalUrl)) {
      skippedLocal += 1;
      continue;
    }

    localSeen.add(candidate.canonicalUrl);

    if (existingUrls.has(candidate.canonicalUrl)) {
      skippedDb += 1;
      continue;
    }

    fresh.push(candidate);
  }

  return {
    skipped: skippedLocal + skippedDb,
    skippedReasons: {
      local: skippedLocal,
      db: skippedDb,
    },
    fresh,
  };
}

async function stageHeadline(candidate: CandidateHeadline): Promise<ParsedNewsPayload | null> {
  console.log(`[PARSER] Parsing: "${truncateHeadline(candidate.headline)}"`);

  const payload = await parseHeadline(candidate.headline, candidate.canonicalUrl, candidate.source);
  const contextEntityCount = Object.keys(payload.entityMetadata).length;

  console.log(`[PARSER] Success. Found ${contextEntityCount} context entities.`);

  const saveResult = await saveDraft({
    source: candidate.source,
    url: candidate.canonicalUrl,
    headline: candidate.headline,
    payload_json: payload,
    status: 'PENDING',
    tx_hash: null,
  });

  if (saveResult.skippedDuplicate || !saveResult.data) {
    console.log(`[SUPABASE] Duplicate skipped for URL: ${candidate.canonicalUrl}`);
    return null;
  }

  console.log(`[SUPABASE] Draft saved. ID: ${saveResult.data.id}`);

  return payload;
}

async function main(): Promise<void> {
  const fetched = await fetchLatestHeadlines();
  console.log(`[RSS] Fetched ${fetched.length} headlines.`);

  if (fetched.length === 0) {
    console.log('[PIPELINE] No headlines fetched. Exiting.');
    return;
  }

  const existingUrls = await getExistingUrls(fetched.map((item) => item.canonicalUrl));
  const deduped = dedupeCandidates(fetched, existingUrls);

  console.log(
    `[DEDUPE] ${deduped.skipped} skipped (duplicates), ${deduped.fresh.length} new.`,
  );
  console.log(
    `[DEDUPE] Local cache: ${deduped.skippedReasons.local}, DB cache: ${deduped.skippedReasons.db}.`,
  );

  for (const candidate of deduped.fresh) {
    try {
      await stageHeadline(candidate);
    } catch (error) {
      console.error(
        `[PIPELINE] Failed for "${truncateHeadline(candidate.headline)}":`,
        error,
      );
    }
  }

  console.log('[PIPELINE] One-time ingestion audit complete.');
}

void main().catch((error) => {
  console.error('test-ingestion failed:', error);
  process.exitCode = 1;
});
