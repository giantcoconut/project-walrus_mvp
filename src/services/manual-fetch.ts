import 'dotenv/config';

import { canonicalizeUrl } from '../core/canonicalizer';
import {
  createClaimRun,
  createClaimRunStep,
  finishClaimRun,
  saveDraft,
  supabase,
} from '../db/supabase';
import {
  FEEDS,
  createRssParser,
  getItemLink,
  getItemTitle,
} from '../listeners/rss-poller';
import { parseHeadline } from './ai-parser';
import type { ApprovedSource, ParsedNewsPayload } from '../types/schema';

const ITEMS_PER_FEED = 3;

interface CandidateHeadline {
  source: ApprovedSource;
  headline: string;
  canonicalUrl: string;
}

interface FeedFetchResult {
  source: ApprovedSource;
  items: CandidateHeadline[];
  error: string | null;
}

export interface ManualFetchSummary {
  runId: string;
  fetchedCount: number;
  freshCount: number;
  duplicateCount: number;
  savedCount: number;
  errorCount: number;
  savedDraftIds: string[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncateHeadline(headline: string, maxLength = 120): string {
  if (headline.length <= maxLength) {
    return headline;
  }

  return `${headline.slice(0, maxLength - 3)}...`;
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
        .slice(0, ITEMS_PER_FEED);

      return {
        source: feed.source,
        items,
        error: null,
      };
    } catch (error) {
      if (attempt < 2) {
        await sleep(1_500);
        continue;
      }

      return {
        source: feed.source,
        items: [],
        error: getErrorMessage(error),
      };
    }
  }

  return {
    source: feed.source,
    items: [],
    error: `Unknown fetch failure for ${feed.source}.`,
  };
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

function dedupeCandidates(candidates: CandidateHeadline[], existingUrls: Set<string>) {
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
    fresh,
    skipped: skippedLocal + skippedDb,
    skippedReasons: {
      local: skippedLocal,
      db: skippedDb,
    },
  };
}

async function logStep(
  runId: string,
  step: Parameters<typeof createClaimRunStep>[0]['step'],
  status: Parameters<typeof createClaimRunStep>[0]['status'],
  detailJson: Record<string, unknown> | null,
  errorMessage?: string,
): Promise<void> {
  await createClaimRunStep({
    run_id: runId,
    step,
    status,
    detail_json: detailJson,
    error_message: errorMessage ?? null,
  });
}

export async function runManualFetchIngestion(
  initiatedBy = 'admin-ui',
): Promise<ManualFetchSummary> {
  const run = await createClaimRun({
    trigger: 'MANUAL_FETCH',
    initiated_by: initiatedBy,
    status: 'RUNNING',
    draft_id: null,
  });

  const savedDraftIds: string[] = [];
  let errorCount = 0;

  try {
    const feedResults = await Promise.all(FEEDS.map(fetchFeedHeadlines));
    const fetched = feedResults.flatMap((result) => result.items);
    const feedErrors = feedResults
      .filter((result) => result.error)
      .map((result) => ({
        source: result.source,
        error: result.error,
      }));

    await logStep(run.id, 'RSS_FETCH', fetched.length > 0 ? 'SUCCESS' : 'ERROR', {
      feeds: feedResults.map((result) => ({
        source: result.source,
        itemCount: result.items.length,
        error: result.error,
      })),
      fetchedCount: fetched.length,
    }, feedErrors.length > 0 ? 'One or more feeds failed during fetch.' : undefined);

    const existingUrls = await getExistingUrls(fetched.map((item) => item.canonicalUrl));
    const deduped = dedupeCandidates(fetched, existingUrls);

    await logStep(run.id, 'CANONICALIZE', 'SUCCESS', {
      fetchedCount: fetched.length,
      freshCount: deduped.fresh.length,
      duplicateCount: deduped.skipped,
      duplicateBreakdown: deduped.skippedReasons,
      freshItems: deduped.fresh.map((item) => ({
        source: item.source,
        headline: truncateHeadline(item.headline),
        canonicalUrl: item.canonicalUrl,
      })),
    });

    for (const candidate of deduped.fresh) {
      let payload: ParsedNewsPayload;

      try {
        payload = await parseHeadline(candidate.headline, candidate.canonicalUrl, candidate.source);

        await logStep(run.id, 'PARSE', 'SUCCESS', {
          source: candidate.source,
          headline: candidate.headline,
          canonicalUrl: candidate.canonicalUrl,
          archiveCount: payload.archive.length,
          arenaCount: payload.arena.length,
          entityCount: Object.keys(payload.entityMetadata).length,
        });
      } catch (error) {
        errorCount += 1;
        await logStep(
          run.id,
          'PARSE',
          'ERROR',
          {
            source: candidate.source,
            headline: candidate.headline,
            canonicalUrl: candidate.canonicalUrl,
          },
          getErrorMessage(error),
        );
        continue;
      }

      try {
        const saveResult = await saveDraft({
          source: candidate.source,
          url: candidate.canonicalUrl,
          headline: candidate.headline,
          payload_json: payload,
          status: 'PENDING',
          tx_hash: null,
        });

        if (saveResult.data) {
          savedDraftIds.push(saveResult.data.id);
        }

        await logStep(run.id, 'DB_UPDATE', 'SUCCESS', {
          source: candidate.source,
          headline: candidate.headline,
          canonicalUrl: candidate.canonicalUrl,
          skippedDuplicate: saveResult.skippedDuplicate,
          draftId: saveResult.data?.id ?? null,
        });
      } catch (error) {
        errorCount += 1;
        await logStep(
          run.id,
          'DB_UPDATE',
          'ERROR',
          {
            source: candidate.source,
            headline: candidate.headline,
            canonicalUrl: candidate.canonicalUrl,
          },
          getErrorMessage(error),
        );
      }
    }

    await finishClaimRun(run.id, fetched.length > 0 ? 'SUCCESS' : 'ERROR');

    return {
      runId: run.id,
      fetchedCount: fetched.length,
      freshCount: deduped.fresh.length,
      duplicateCount: deduped.skipped,
      savedCount: savedDraftIds.length,
      errorCount,
      savedDraftIds,
    };
  } catch (error) {
    await logStep(run.id, 'DB_UPDATE', 'ERROR', null, getErrorMessage(error));
    await finishClaimRun(run.id, 'ERROR');
    throw error;
  }
}
