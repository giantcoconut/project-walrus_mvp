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
  predicateSuggestion?: string | null;
  object: string;
};

interface ParserModelOutput {
  headlineTriple: FlatTriple;
  contextTriples: FlatTriple[];
  entityMetadata: Record<string, EntityMetadata>;
  warnings: string[];
}

const DEFAULT_NVIDIA_MODEL = process.env.NVIDIA_MODEL?.trim() || 'meta/llama3-70b-instruct';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_REQUEST_TIMEOUT_MS = 90_000;
const PREDICATE_SYNONYMS: Record<string, Predicate> = {
  announce: 'announced',
  announced: 'announced',
  announces: 'announced',
  announcing: 'announced',
  appoint: 'appointed',
  appointed: 'appointed',
  appoints: 'appointed',
  appointing: 'appointed',
  arrest: 'arrested',
  arrested: 'arrested',
  arrests: 'arrested',
  arresting: 'arrested',
  charge: 'charged',
  charged: 'charged',
  charges: 'charged',
  charging: 'charged',
  expect: 'asserts',
  expected: 'asserts',
  expects: 'asserts',
  forecast: 'asserts',
  forecasts: 'asserts',
  halt: 'halted',
  halted: 'halted',
  halts: 'halted',
  halting: 'halted',
  investigate: 'investigating',
  investigated: 'investigating',
  investigates: 'investigating',
  investigating: 'investigating',
  investigation: 'investigating',
  issue: 'asserts',
  issued: 'asserts',
  issues: 'asserts',
  partner: 'partnered',
  partnered: 'partnered',
  partnering: 'partnered',
  partners: 'partnered',
  partners_with: 'partnered',
  partnered_with: 'partnered',
  project: 'asserts',
  projected: 'asserts',
  projects: 'asserts',
  raise: 'raised',
  raised: 'raised',
  raises: 'raised',
  raising: 'raised',
  raised_funds: 'raised',
  raised_funding: 'raised',
  sanction: 'sanctioned',
  sanctioned: 'sanctioned',
  sanctions: 'sanctioned',
  sanctioning: 'sanctioned',
  said: 'asserts',
  says: 'asserts',
  warn: 'warned',
  warned: 'warned',
  warns: 'warned',
  warning: 'warned',
};
const modelResolutionCache = new Map<string, Promise<string>>();

const OUTPUT_SCHEMA_DESCRIPTION = JSON.stringify(
  {
    headlineTriple: {
      subject: 'string',
      predicate: 'short freeform relation string, e.g. joins, celebrates, delays, is_a, mentions',
      object: 'string',
    },
    contextTriples: [
      {
        subject: 'string',
        predicate: 'short freeform relation string, e.g. is_a, founded, located_in',
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
    timeout: NVIDIA_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
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

function stripEdgePunctuation(value: string): string {
  return value.replace(/^[^A-Za-z0-9À-ÿ]+|[^A-Za-z0-9À-ÿ]+$/g, '');
}

function startsWithUppercaseLetter(value: string): boolean {
  const trimmed = stripEdgePunctuation(value);

  if (!trimmed) {
    return false;
  }

  const first = trimmed.charAt(0);
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

function extractHeadlineEntityPhrases(headline: string): string[] {
  const connectorWords = new Set(['of', 'the', 'and', 'for', 'to', 'in', 'on', 'at', 'de', 'la']);
  const tokens = headline.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  const phrases: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token || !startsWithUppercaseLetter(token)) {
      continue;
    }

    const phraseTokens = [stripEdgePunctuation(token)];
    let cursor = index + 1;

    while (cursor < tokens.length) {
      const nextToken = tokens[cursor];
      const stripped = stripEdgePunctuation(nextToken ?? '');

      if (!stripped) {
        break;
      }

      if (startsWithUppercaseLetter(stripped) || connectorWords.has(stripped.toLowerCase())) {
        phraseTokens.push(stripped);
        cursor += 1;
        continue;
      }

      break;
    }

    const phrase = phraseTokens.join(' ').trim();

    if (phrase.length > 0) {
      phrases.push(phrase);
    }

    index = cursor - 1;
  }

  return Array.from(new Set(phrases));
}

function normalizeSurfaceForCompare(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ]+/gi, ' ')
    .replace(/\s+/g, ' ');
}

function getEditDistance(left: string, right: string): number {
  const leftLength = left.length;
  const rightLength = right.length;
  const table = Array.from({ length: leftLength + 1 }, () =>
    new Array<number>(rightLength + 1).fill(0),
  );

  for (let row = 0; row <= leftLength; row += 1) {
    table[row]![0] = row;
  }

  for (let column = 0; column <= rightLength; column += 1) {
    table[0]![column] = column;
  }

  for (let row = 1; row <= leftLength; row += 1) {
    for (let column = 1; column <= rightLength; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;

      table[row]![column] = Math.min(
        table[row - 1]![column]! + 1,
        table[row]![column - 1]! + 1,
        table[row - 1]![column - 1]! + substitutionCost,
      );
    }
  }

  return table[leftLength]![rightLength]!;
}

function findHeadlineSurfaceMatch(value: string, headlinePhrases: string[]): string | null {
  const normalizedValue = normalizeSurfaceForCompare(value);

  if (!normalizedValue) {
    return null;
  }

  const exactMatch = headlinePhrases.find(
    (phrase) => normalizeSurfaceForCompare(phrase) === normalizedValue,
  );

  if (exactMatch) {
    return exactMatch;
  }

  const valueTokens = normalizedValue.split(' ');
  let bestMatch: { phrase: string; distance: number } | null = null;

  for (const phrase of headlinePhrases) {
    const normalizedPhrase = normalizeSurfaceForCompare(phrase);
    const phraseTokens = normalizedPhrase.split(' ');

    if (phraseTokens.length !== valueTokens.length) {
      continue;
    }

    const distance = getEditDistance(normalizedValue, normalizedPhrase);
    const threshold = Math.min(3, Math.max(1, Math.floor(normalizedPhrase.length * 0.15)));

    if (distance <= threshold && (!bestMatch || distance < bestMatch.distance)) {
      bestMatch = {
        phrase,
        distance,
      };
    }
  }

  return bestMatch?.phrase ?? null;
}

function extractHeadlinePhraseTokens(headlinePhrases: string[]): string[] {
  return Array.from(
    new Set(
      headlinePhrases.flatMap((phrase) =>
        normalizeSurfaceForCompare(phrase)
          .split(' ')
          .map((token) => token.trim())
          .filter((token) => token.length > 0),
      ),
    ),
  );
}

function findHeadlineTokenSurfaceMatch(value: string, headlinePhraseTokens: string[]): string | null {
  const normalizedValue = normalizeSurfaceForCompare(value);

  if (!normalizedValue || normalizedValue.includes(' ')) {
    return null;
  }

  let bestMatch: { token: string; distance: number } | null = null;

  for (const token of headlinePhraseTokens) {
    const distance = getEditDistance(normalizedValue, token);
    const threshold = normalizedValue.length >= 6 ? 2 : 1;

    if (distance <= threshold && (!bestMatch || distance < bestMatch.distance)) {
      bestMatch = {
        token,
        distance,
      };
    }
  }

  return bestMatch?.token ?? null;
}

function restoreTripleSurfaceForms(
  triple: FlatTriple,
  headlinePhrases: string[],
  headlinePhraseTokens: string[],
): FlatTriple {
  const subjectMatch = findHeadlineSurfaceMatch(triple.subject, headlinePhrases);
  const objectMatch = findHeadlineSurfaceMatch(triple.object, headlinePhrases);
  const taxonomyObjectMatch =
    triple.predicate === 'is_a'
      ? findHeadlineTokenSurfaceMatch(triple.object, headlinePhraseTokens)
      : null;

  return {
    ...triple,
    subject: subjectMatch ?? triple.subject,
    object: objectMatch ?? taxonomyObjectMatch ?? triple.object,
  };
}

function restoreSurfaceForms(
  payload: ParserModelOutput,
  headline: string,
): ParserModelOutput {
  const headlinePhrases = extractHeadlineEntityPhrases(headline);
  const headlinePhraseTokens = extractHeadlinePhraseTokens(headlinePhrases);

  if (headlinePhrases.length === 0) {
    return payload;
  }

  const restoredHeadlineTriple = restoreTripleSurfaceForms(
    payload.headlineTriple,
    headlinePhrases,
    headlinePhraseTokens,
  );
  const restoredContextTriples = payload.contextTriples.map((triple) =>
    restoreTripleSurfaceForms(triple, headlinePhrases, headlinePhraseTokens),
  );

  const restoredEntityMetadataEntries = Object.entries(payload.entityMetadata).map(([key, value]) => {
    const restoredKey = findHeadlineSurfaceMatch(key, headlinePhrases) ?? key;
    const restoredName = findHeadlineSurfaceMatch(value.name, headlinePhrases) ?? value.name;

    return [
      restoredKey,
      {
        ...value,
        name: restoredName,
      } satisfies EntityMetadata,
    ] as const;
  });

  return {
    ...payload,
    headlineTriple: restoredHeadlineTriple,
    contextTriples: restoredContextTriples,
    entityMetadata: Object.fromEntries(restoredEntityMetadataEntries),
  };
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
  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      warnings.push(
        `[PARSER] Repaired predicate in ${contextLabel}: empty string -> "asserts"`,
      );
      return 'asserts';
    }

    if (isPredicate(trimmed)) {
      return trimmed;
    }

    const normalized = trimmed.toLowerCase().replace(/\s+/g, '_');

    if (isPredicate(normalized)) {
      warnings.push(
        `[PARSER] Repaired predicate in ${contextLabel}: "${value}" -> "${normalized}"`,
      );
      return normalized;
    }

    if (normalized in PREDICATE_SYNONYMS) {
      const repairedPredicate =
        PREDICATE_SYNONYMS[normalized as keyof typeof PREDICATE_SYNONYMS];

      if (!repairedPredicate) {
        return 'asserts';
      }

      warnings.push(
        `[PARSER] Repaired predicate in ${contextLabel}: "${value}" -> "${repairedPredicate}"`,
      );
      return repairedPredicate;
    }
  }

  warnings.push(
    `[PARSER] Repaired predicate in ${contextLabel}: "${String(value)}" -> "asserts"`,
  );
  return 'asserts';
}

function getPredicateSuggestion(value: unknown, canonicalPredicate: Predicate): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, '_');

  if (normalized === canonicalPredicate) {
    return null;
  }

  return trimmed;
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

  const canonicalPredicate = normalizePredicate(candidate.predicate, warnings, contextLabel);

  return {
    subject,
    predicate: canonicalPredicate,
    predicateSuggestion: getPredicateSuggestion(candidate.predicate, canonicalPredicate),
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
    `The downstream graph uses a canonical predicate set: [${MVP_PREDICATES.join(', ')}].`,
    'In this response, predicate should be the most semantically accurate short relation phrase from the headline or context.',
    'Do not force predicate into the canonical set. Canonical mapping happens downstream.',
    'Prefer concise lowercase verbs or snake_case relation phrases.',
    'The JSON must match this exact structure:',
    OUTPUT_SCHEMA_DESCRIPTION,
    'headlineTriple must contain the single main event from the headline.',
    'contextTriples must contain supporting triples such as entity definitions with is_a when useful.',
    'Preserve named entities exactly as they appear in the headline whenever possible.',
    'Do not autocorrect, respell, or normalize proper nouns, place names, people, organizations, products, or event titles.',
    'If the headline says Strait, do not rewrite it as straight.',
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

function getRawErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

async function resolveConfiguredModelId(client: OpenAI): Promise<string> {
  const configuredModel = DEFAULT_NVIDIA_MODEL;

  if (configuredModel.includes('/')) {
    return configuredModel;
  }

  const cacheKey = configuredModel;
  const cached = modelResolutionCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const resolutionPromise = client.models
    .list()
    .then((response) => {
      const availableIds = response.data
        .map((model) => model.id?.trim())
        .filter((id): id is string => Boolean(id));

      const exactMatch = availableIds.find((id) => id === configuredModel);

      if (exactMatch) {
        return exactMatch;
      }

      const suffixMatches = availableIds.filter((id) => id.endsWith(`/${configuredModel}`));

      if (suffixMatches.length === 1) {
        return suffixMatches[0]!;
      }

      if (suffixMatches.length > 1) {
        throw new Error(
          `Configured NVIDIA_MODEL "${configuredModel}" matched multiple provider IDs: ${suffixMatches.join(', ')}`,
        );
      }

      throw new Error(
        `Configured NVIDIA_MODEL "${configuredModel}" was not found in NVIDIA models.list(). Available examples: ${availableIds
          .slice(0, 12)
          .join(', ')}`,
      );
    })
    .catch((error) => {
      modelResolutionCache.delete(cacheKey);
      throw error;
    });

  modelResolutionCache.set(cacheKey, resolutionPromise);
  return resolutionPromise;
}

async function requestStructuredOutput(
  client: OpenAI,
  headline: string,
  canonicalUrl: string,
  canonicalSource: string,
): Promise<ParserModelOutput> {
  const resolvedModelId = await resolveConfiguredModelId(client);
  const completion = await client.chat.completions.create({
    model: resolvedModelId,
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
  return restoreSurfaceForms(normalizeModelOutput(payload, headline), headline);
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

    throw new Error(
      `NVIDIA parser failed for model "${DEFAULT_NVIDIA_MODEL}" with status ${
        statusCode ?? 'unknown'
      }: ${getRawErrorMessage(error)}`,
    );
  }
}
