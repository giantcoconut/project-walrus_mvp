import 'dotenv/config';

import { performance } from 'node:perf_hooks';

import { GoogleGenAI } from '@google/genai';

import { canonicalizeSource, canonicalizeUrl } from '../src/core/canonicalizer';
import { parseHeadline as parseHeadlineWithNvidia } from '../src/services/ai-parser';
import { MVP_PREDICATES, type ApprovedSource, type EntityMetadata, type Predicate } from '../src/types/schema';

type FlatTriple = {
  subject: string;
  predicate: Predicate;
  object: string;
};

interface CandidateHeadline {
  source: ApprovedSource;
  headline: string;
  canonicalUrl: string;
}

interface BenchmarkResult {
  provider: string;
  source: ApprovedSource;
  headline: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

interface GeminiModelOutput {
  headlineTriple: FlatTriple;
  contextTriples: FlatTriple[];
  entityMetadata: Record<string, EntityMetadata>;
}

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
const BENCHMARK_HEADLINES: CandidateHeadline[] = [
  {
    source: 'The Block',
    headline: 'SEC delays decision on spot crypto ETF proposal as market awaits guidance',
    canonicalUrl: canonicalizeUrl(
      'https://benchmark.aletheia/the-block/sec-delays-decision-on-spot-crypto-etf-proposal',
    ),
  },
  {
    source: 'BBC World News',
    headline: 'Ceasefire talks continue as regional leaders push for broader peace framework',
    canonicalUrl: canonicalizeUrl(
      'https://benchmark.aletheia/bbc/ceasefire-talks-continue-as-regional-leaders-push-for-broader-peace-framework',
    ),
  },
];

const flatTripleJsonSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    predicate: {
      type: 'string',
      enum: [...MVP_PREDICATES],
    },
    object: { type: 'string' },
  },
  required: ['subject', 'predicate', 'object'],
  additionalProperties: false,
} as const;

const entityMetadataJsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    url: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
  },
  required: ['name', 'description', 'url'],
  additionalProperties: false,
} as const;

const parserOutputSchema = {
  type: 'object',
  properties: {
    headlineTriple: flatTripleJsonSchema,
    contextTriples: {
      type: 'array',
      items: flatTripleJsonSchema,
    },
    entityMetadata: {
      type: 'object',
      additionalProperties: entityMetadataJsonSchema,
    },
  },
  required: ['headlineTriple', 'contextTriples', 'entityMetadata'],
  additionalProperties: false,
} as const;

function truncateHeadline(headline: string, maxLength = 84): string {
  if (headline.length <= maxLength) {
    return headline;
  }

  return `${headline.slice(0, maxLength - 3)}...`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertPredicate(value: unknown): asserts value is Predicate {
  if (typeof value !== 'string' || !MVP_PREDICATES.includes(value as Predicate)) {
    throw new Error(`Invalid predicate: ${String(value)}`);
  }
}

function assertFlatTriple(value: unknown): asserts value is FlatTriple {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected flat triple object.');
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.subject !== 'string' || candidate.subject.trim().length === 0) {
    throw new Error('Triple subject must be a non-empty string.');
  }

  assertPredicate(candidate.predicate);

  if (typeof candidate.object !== 'string' || candidate.object.trim().length === 0) {
    throw new Error('Triple object must be a non-empty string.');
  }
}

function assertGeminiModelOutput(value: unknown): asserts value is GeminiModelOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('Gemini output must be a JSON object.');
  }

  const candidate = value as Record<string, unknown>;

  assertFlatTriple(candidate.headlineTriple);

  if (!Array.isArray(candidate.contextTriples)) {
    throw new Error('Gemini output contextTriples must be an array.');
  }

  for (const triple of candidate.contextTriples) {
    assertFlatTriple(triple);
  }

  if (
    !candidate.entityMetadata ||
    typeof candidate.entityMetadata !== 'object' ||
    Array.isArray(candidate.entityMetadata)
  ) {
    throw new Error('Gemini output entityMetadata must be an object.');
  }
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY environment variable. Cannot benchmark Gemini.');
  }

  return new GoogleGenAI({ apiKey });
}

function buildGeminiPrompt(headline: string, canonicalUrl: string, canonicalSource: string): string {
  return [
    'You are an expert Ontologist extracting Semantic Triples from news.',
    'You must return valid JSON only.',
    `Use only these predicates: ${MVP_PREDICATES.join(', ')}.`,
    'Return one main headlineTriple, optional contextTriples, and entityMetadata for any extracted entities.',
    'For each entityMetadata entry, include name, description, and official URL if confidently known, else null.',
    `Headline: ${headline}`,
    `Canonical URL: ${canonicalUrl}`,
    `Source: ${canonicalSource}`,
  ].join('\n');
}

async function parseHeadlineWithGemini(
  headline: string,
  url: string,
  source: ApprovedSource,
): Promise<GeminiModelOutput> {
  const client = getGeminiClient();
  const canonicalUrl = canonicalizeUrl(url);
  const canonicalSource = canonicalizeSource(source);

  const response = await client.models.generateContent({
    model: DEFAULT_GEMINI_MODEL,
    contents: buildGeminiPrompt(headline, canonicalUrl, canonicalSource),
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: parserOutputSchema,
      temperature: 0.1,
    },
  });

  if (!response.text) {
    throw new Error('Gemini returned an empty response.');
  }

  const payload = JSON.parse(response.text) as unknown;
  assertGeminiModelOutput(payload);
  return payload;
}

async function benchmarkOne(
  provider: string,
  candidate: CandidateHeadline,
  runner: () => Promise<unknown>,
): Promise<BenchmarkResult> {
  const startedAt = performance.now();

  try {
    await runner();

    return {
      provider,
      source: candidate.source,
      headline: candidate.headline,
      durationMs: performance.now() - startedAt,
      ok: true,
    };
  } catch (error) {
    return {
      provider,
      source: candidate.source,
      headline: candidate.headline,
      durationMs: performance.now() - startedAt,
      ok: false,
      error: getErrorMessage(error),
    };
  }
}

function printResults(results: BenchmarkResult[]): void {
  for (const result of results) {
    const status = result.ok ? 'OK' : 'ERROR';
    console.log(
      `[${result.provider}] ${status} ${result.durationMs.toFixed(0)}ms | ${result.source} | ${truncateHeadline(result.headline)}`,
    );

    if (result.error) {
      console.log(`  -> ${result.error}`);
    }
  }

  const providers = [...new Set(results.map((result) => result.provider))];

  for (const provider of providers) {
    const providerResults = results.filter((result) => result.provider === provider);
    const successful = providerResults.filter((result) => result.ok);
    const averageMs =
      successful.length > 0
        ? successful.reduce((sum, result) => sum + result.durationMs, 0) / successful.length
        : null;

    console.log(
      `[SUMMARY] ${provider}: ${successful.length}/${providerResults.length} successful${
        averageMs === null ? '' : `, avg ${averageMs.toFixed(0)}ms`
      }`,
    );
  }
}

async function main(): Promise<void> {
  const candidates = BENCHMARK_HEADLINES;

  if (candidates.length === 0) {
    throw new Error('No benchmark headlines fetched from configured feeds.');
  }

  console.log(
    `[BENCHMARK] Testing ${candidates.length} headline(s): ${candidates
      .map((candidate) => `"${truncateHeadline(candidate.headline, 48)}"`)
      .join(', ')}`,
  );
  console.log(
    `[BENCHMARK] Providers: gemini=${DEFAULT_GEMINI_MODEL}, nvidia=${process.env.NVIDIA_MODEL?.trim() || 'meta/llama3-70b-instruct'}`,
  );

  const results: BenchmarkResult[] = [];

  for (const candidate of candidates) {
    results.push(
      await benchmarkOne('gemini', candidate, () =>
        parseHeadlineWithGemini(candidate.headline, candidate.canonicalUrl, candidate.source),
      ),
    );

    results.push(
      await benchmarkOne('nvidia', candidate, () =>
        parseHeadlineWithNvidia(candidate.headline, candidate.canonicalUrl, candidate.source),
      ),
    );
  }

  printResults(results);
}

void main().catch((error) => {
  console.error('benchmark-parsers failed:', error);
  process.exitCode = 1;
});
