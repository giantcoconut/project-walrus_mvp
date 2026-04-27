import Parser from 'rss-parser';

import { canonicalizeSource, canonicalizeUrl } from '../core/canonicalizer';
import { getAtomId } from '../core/id-engine';
import { saveDraft } from '../db/supabase';
import { parseHeadline } from '../services/ai-parser';
import type { ApprovedSource, ParsedNewsPayload } from '../types/schema';

const DEFAULT_POLL_INTERVAL_MS = 60_000;
export const FEED_HEADLINE_LOOKBACK = 3;

export const FEEDS = [
  {
    source: 'The Block',
    url: 'https://www.theblock.co/rss.xml',
  },
  {
    source: 'BBC World News',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  },
] as const satisfies ReadonlyArray<{ source: ApprovedSource; url: string }>;

export function createRssParser(): Parser {
  return new Parser({
    timeout: 15_000,
    headers: {
      'User-Agent': 'Aletheia Terminal RSS Poller/0.1',
    },
  });
}

const parser = createRssParser();

export interface RssPollerOptions {
  intervalMs?: number;
  onPayload?: (payload: ParsedNewsPayload) => Promise<void> | void;
}

export interface RssPollerHandle {
  stop: () => void;
  seenUrlHashes: Set<string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getItemLink(item: { link?: string }): string | null {
  return typeof item.link === 'string' && item.link.trim() ? item.link : null;
}

export function getItemTitle(item: { title?: string }): string | null {
  return typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null;
}

async function processFeed(
  feedConfig: (typeof FEEDS)[number],
  seenUrlHashes: Set<string>,
  onPayload?: (payload: ParsedNewsPayload) => Promise<void> | void,
): Promise<void> {
  const feed = await parser.parseURL(feedConfig.url);
  const source = canonicalizeSource(feedConfig.source);

  for (const item of feed.items) {
    const headline = getItemTitle(item);
    const rawUrl = getItemLink(item);

    if (!headline || !rawUrl) {
      continue;
    }

    const canonicalUrl = canonicalizeUrl(rawUrl);
    const urlHash = getAtomId(canonicalUrl, { kind: 'url' });

    if (seenUrlHashes.has(urlHash)) {
      continue;
    }

    try {
      const payload = await parseHeadline(headline, canonicalUrl, source);
      const saveResult = await saveDraft({
        source: feedConfig.source,
        url: canonicalUrl,
        headline,
        payload_json: payload,
        status: 'PENDING',
        tx_hash: null,
      });

      seenUrlHashes.add(urlHash);

      if (!saveResult.skippedDuplicate) {
        console.log(`[DATABASE] Saved PENDING draft for: ${headline}`);
      }

      if (onPayload) {
        await onPayload(payload);
      } else {
        console.log(`[rss-poller] Parsed ${feedConfig.source}: ${headline}`);
        console.log(JSON.stringify(payload, null, 2));
      }
    } catch (error) {
      console.error(`[rss-poller] Failed to parse headline from ${feedConfig.source}:`, error);
    }
  }
}

export async function pollFeedsOnce(
  seenUrlHashes: Set<string>,
  onPayload?: (payload: ParsedNewsPayload) => Promise<void> | void,
): Promise<void> {
  for (const feedConfig of FEEDS) {
    try {
      await processFeed(feedConfig, seenUrlHashes, onPayload);
    } catch (error) {
      console.error(`[rss-poller] Failed to poll ${feedConfig.source}:`, error);
    }
  }
}

export function startRssPoller(options: RssPollerOptions = {}): RssPollerHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const seenUrlHashes = new Set<string>();
  let stopped = false;
  let inFlight = false;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      if (!inFlight) {
        inFlight = true;

        try {
          await pollFeedsOnce(seenUrlHashes, options.onPayload);
        } finally {
          inFlight = false;
        }
      }

      if (!stopped) {
        await sleep(intervalMs);
      }
    }
  };

  void loop();

  return {
    stop: () => {
      stopped = true;
    },
    seenUrlHashes,
  };
}

async function main(): Promise<void> {
  console.log('[rss-poller] Starting RSS poller...');
  startRssPoller();
}

const entrypoint = process.argv[1];
const isDirectExecution =
  typeof entrypoint === 'string' &&
  (entrypoint.endsWith('src\\listeners\\rss-poller.ts') ||
    entrypoint.endsWith('src/listeners/rss-poller.ts'));

if (isDirectExecution) {
  void main().catch((error) => {
    console.error('[rss-poller] Fatal error:', error);
    process.exitCode = 1;
  });
}
