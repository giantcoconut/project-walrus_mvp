import 'dotenv/config';

import OpenAI from 'openai';

import { canonicalizeSource, canonicalizeUrl } from '../core/canonicalizer';
import { nvidiaKeyManager } from '../core/key-manager';
import {
  MVP_PREDICATES,
  type EntityMetadata,
  type ParsedNewsPayload,
  type Predicate,
} from '../types/schema';

type FlatTriple = {
  subject: string;
  predicate: Predicate;
  object: string;
};

interface ParserModelOutput {
  headlineTriple: FlatTriple;
  contextTriples: FlatTriple[];
  entityMetadata: Record<string, EntityMetadata>;
  warnings: string[];
}

const DEFAULT_NVIDIA_MODEL = process.env.NVIDIA_MODEL ?? 'meta/llama3-70b-instruct';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const PREDICATE_SYNONYMS: Record<string, Predicate> = {
  announce: 'asserts',
  announced: 'asserts',
  announces: 'asserts',
  expect: 'asserts',
  expected: 'asserts',
  expects: 'asserts',
  forecast: 'asserts',
  forecasts: 'asserts',
  issue: 'asserts',
  issued: 'asserts',
  issues: 'asserts',
  project: 'asserts',
  projected: 'asserts',
  projects: 'asserts',
  said: 'asserts',
  says: 'asserts',
};

const OUTPUT_SCHEMA_DESCRIPTION = JSON.stringify(
  {
    headlineTriple: {
      subject: 'string',
      predicate: `one of: ${MVP_PREDICATES.join(', ')}`,
      object: 'string',
    },
    contextTriples: [
      {
        subject: 'string',
        predicate: `one of: ${MVP_PREDICATES.join(', ')}`,
        object: 'string',
      },
    ],
    entityMetadata: {
      '<entity label used in triples>': {
        name: 'same exact entity label string',
        description: '1-2 sentence factual encyclopedic description',
        url: 'official website URL if known, else null',
      },
    },
  },
  null,
  2,
);

function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: NVIDIA_BASE_URL,
  });
}

function slugifyHeadline(headline: string): string {
  const slug = headline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug || 'untitled-headline';
}

function getSafeUrl(headline: string, url?: string): string {
  if (typeof url === 'string' && url.trim().length > 0) {
    return canonicalizeUrl(url);
  }

  return canonicalizeUrl(`https://local.aletheia/${slugifyHeadline(headline)}`);
}

function getSafeSource(source?: string): string {
  if (typeof source === 'string' && source.trim().length > 0) {
    return canonicalizeSource(source);
  }

  return canonicalizeSource('Unknown Source');
}

function normalizeEntityUrl(value: string | null): string | null {
  if (!value || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();

  try {
    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return null;
    }
  }
}

function isPredicate(value: unknown): value is Predicate {
  return typeof value === 'string' && MVP_PREDICATES.includes(value as Predicate);
}

function isFlatTriple(value: unknown): value is FlatTriple {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.subject === 'string' &&
    candidate.subject.trim().length > 0 &&
    isPredicate(candidate.predicate) &&
    typeof candidate.object === 'string' &&
    candidate.object.trim().length > 0
  );
}

function normalizePredicate(value: unknown, warnings: string[], contextLabel: string): Predicate {
  if (isPredicate(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');

    if (isPredicate(normalized)) {
      warnings.push(
        `[PARSER] Repaired predicate in ${contextLabel}: "${value}" -> "${normalized}"`,
      );
      return normalized;
    }

    if (normalized in PREDICATE_SYNONYMS) {
      warnings.push(
        `[PARSER] Repaired predicate in ${contextLabel}: "${value}" -> "${PREDICATE_SYNONYMS[normalized]}"`,
      );
      return PREDICATE_SYNONYMS[normalized];
    }
  }

  warnings.push(
    `[PARSER] Repaired predicate in ${contextLabel}: "${String(value)}" -> "asserts"`,
  );
  return 'asserts';
}

function isEntityMetadata(value: unknown): value is EntityMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0 &&
    typeof candidate.description === 'string' &&
    candidate.description.trim().length > 0 &&
    (candidate.url === null || typeof candidate.url === 'string')
  );
}

function normalizeTriple(
  value: unknown,
  warnings: string[],
  contextLabel: string,
  options: {
    fallbackSubject?: string;
    fallbackObject?: string;
  } = {},
): FlatTriple {
  if (!value || typeof value !== 'object') {
    throw new Error('Nvidia NIM triple must be an object.');
  }

  const candidate = value as Record<string, unknown>;
  const subject =
    typeof candidate.subject === 'string' && candidate.subject.trim().length > 0
      ? candidate.subject.trim()
      : options.fallbackSubject?.trim();
  const object =
    typeof candidate.object === 'string' && candidate.object.trim().length > 0
      ? candidate.object.trim()
      : options.fallbackObject?.trim();

  if (!subject) {
    throw new Error('Nvidia NIM triple is missing a valid subject.');
  }

  if (!object) {
    throw new Error('Nvidia NIM triple is missing a valid object.');
  }

  if (!(typeof candidate.subject === 'string' && candidate.subject.trim().length > 0) && subject) {
    warnings.push(`[PARSER] Repaired ${contextLabel}: missing subject -> "${subject}"`);
  }

  if (!(typeof candidate.object === 'string' && candidate.object.trim().length > 0) && object) {
    warnings.push(`[PARSER] Repaired ${contextLabel}: missing object -> "${object}"`);
  }

  return {
    subject,
    predicate: normalizePredicate(candidate.predicate, warnings, contextLabel),
    object,
  };
}

function normalizeEntityMetadataEntry(key: string, value: unknown): EntityMetadata {
  if (!value || typeof value !== 'object') {
    return {
      name: key,
      description: `${key} is an entity extracted from the news headline.`,
      url: null,
    };
  }

  const candidate = value as Record<string, unknown>;
  const name =
    typeof candidate.name === 'string' && candidate.name.trim().length > 0 ? candidate.name.trim() : key;
  const description =
    typeof candidate.description === 'string' && candidate.description.trim().length > 0
      ? candidate.description.trim()
      : `${key} is an entity extracted from the news headline.`;
  const url =
    typeof candidate.url === 'string' && candidate.url.trim().length > 0
      ? normalizeEntityUrl(candidate.url)
      : null;

  return {
    name,
    description,
    url,
  };
}

function normalizeModelOutput(value: unknown, headline: string): ParserModelOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('Nvidia NIM output must be a JSON object.');
  }

  const warnings: string[] = [];
  const candidate = value as Record<string, unknown>;
  const headlineTriple = normalizeTriple(candidate.headlineTriple, warnings, 'headlineTriple', {
    fallbackObject: headline,
  });
  const contextTriples = Array.isArray(candidate.contextTriples)
    ? candidate.contextTriples
        .map((triple, index) => {
          try {
            return normalizeTriple(triple, warnings, `contextTriples[${index}]`);
          } catch (error) {
            warnings.push(
              `[PARSER] Dropped broken context triple at index ${index}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return null;
          }
        })
        .filter((triple): triple is FlatTriple => triple !== null)
    : [];
  const rawEntityMetadata =
    candidate.entityMetadata &&
    typeof candidate.entityMetadata === 'object' &&
    !Array.isArray(candidate.entityMetadata)
      ? (candidate.entityMetadata as Record<string, unknown>)
      : {};
  const entityMetadata = Object.fromEntries(
    Object.entries(rawEntityMetadata)
      .map(([key, metadata]) => key.trim().length > 0 ? [key.trim(), normalizeEntityMetadataEntry(key.trim(), metadata)] : null)
      .filter((entry): entry is [string, EntityMetadata] => entry !== null),
  );

  if (!isFlatTriple(headlineTriple)) {
    throw new Error('Nvidia NIM output is missing a valid headlineTriple object.');
  }

  if (!contextTriples.every(isFlatTriple)) {
    throw new Error('Nvidia NIM output contains invalid contextTriples.');
  }

  if (!Object.values(entityMetadata).every(isEntityMetadata)) {
    throw new Error('Nvidia NIM output contains invalid entity metadata.');
  }

  return {
    headlineTriple,
    contextTriples,
    entityMetadata,
    warnings,
  };
}

function buildSystemPrompt(): string {
  return [
    'You are an expert Ontologist extracting Semantic Triples from news.',
    'You MUST respond with ONLY valid JSON.',
    'Do not use markdown formatting.',
    `Use only these predicates: [${MVP_PREDICATES.join(', ')}].`,
    'The JSON must match this exact structure:',
    OUTPUT_SCHEMA_DESCRIPTION,
    'headlineTriple must contain the single main event from the headline.',
    'contextTriples must contain supporting triples such as entity definitions with is_a when useful.',
    'For every extracted entity, include entityMetadata keyed by the exact label string used in the triples.',
    'If you extract an entity, provide a short encyclopedic description and its official URL so we can mint it as a rich Schema.org Thing.',
    'Return null for entityMetadata.url when the official website is not confidently known.',
    'Do not add any keys beyond headlineTriple, contextTriples, and entityMetadata.',
  ].join('\n');
}

function buildUserPrompt(headline: string, canonicalUrl: string, canonicalSource: string): string {
  return [
    `Headline: ${headline}`,
    `Canonical URL: ${canonicalUrl}`,
    `Source: ${canonicalSource}`,
  ].join('\n');
}

function getStatusCode(error: unknown): number | null {
  if (error && typeof error === 'object') {
    if ('status' in error && typeof error.status === 'number') {
      return error.status;
    }

    if (
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'status' in error.response &&
      typeof error.response.status === 'number'
    ) {
      return error.response.status;
    }
  }

  return null;
}

async function requestStructuredOutput(
  client: OpenAI,
  headline: string,
  canonicalUrl: string,
  canonicalSource: string,
): Promise<ParserModelOutput> {
  const completion = await client.chat.completions.create({
    model: DEFAULT_NVIDIA_MODEL,
    temperature: 0.1,
    response_format: {
      type: 'json_object',
    },
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(),
      },
      {
        role: 'user',
        content: buildUserPrompt(headline, canonicalUrl, canonicalSource),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error('Nvidia NIM returned an empty response.');
  }

  const payload = JSON.parse(content) as unknown;
  return normalizeModelOutput(payload, headline);
}

function normalizeEntityMetadata(
  entityMetadata: ParserModelOutput['entityMetadata'],
): ParsedNewsPayload['entityMetadata'] {
  const normalized: ParsedNewsPayload['entityMetadata'] = {};

  for (const [key, value] of Object.entries(entityMetadata)) {
    const entityKey = key.trim();

    if (!entityKey) {
      continue;
    }

    normalized[entityKey] = {
      name: value.name.trim() || entityKey,
      description: value.description.trim(),
      url: typeof value.url === 'string' && value.url.trim().length > 0 ? normalizeEntityUrl(value.url) : null,
    };
  }

  return normalized;
}

export async function parseHeadline(
  headline: string,
  url?: string,
  source?: string,
): Promise<ParsedNewsPayload> {
  const canonicalUrl = getSafeUrl(headline, url);
  const canonicalSource = getSafeSource(source);

  let client = createClient(nvidiaKeyManager.getActiveKey());

  try {
    const payload = await requestStructuredOutput(client, headline, canonicalUrl, canonicalSource);

    for (const warning of payload.warnings) {
      console.warn(warning);
    }

    return {
      headline,
      source: canonicalSource,
      url: canonicalUrl,
      archive: [payload.headlineTriple, ...payload.contextTriples],
      arena: [],
      entityMetadata: normalizeEntityMetadata(payload.entityMetadata),
    };
  } catch (error) {
    const statusCode = getStatusCode(error);

    if (statusCode === 429 || statusCode === 500 || statusCode === 529) {
      client = createClient(nvidiaKeyManager.rotateKey());

      const payload = await requestStructuredOutput(client, headline, canonicalUrl, canonicalSource);

      for (const warning of payload.warnings) {
        console.warn(warning);
      }

      return {
        headline,
        source: canonicalSource,
        url: canonicalUrl,
        archive: [payload.headlineTriple, ...payload.contextTriples],
        arena: [],
        entityMetadata: normalizeEntityMetadata(payload.entityMetadata),
      };
    }

    throw error;
  }
}
