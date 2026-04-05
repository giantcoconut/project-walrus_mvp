import 'dotenv/config';

import { GoogleGenAI } from '@google/genai';

import { canonicalizeSource, canonicalizeUrl } from '../core/canonicalizer';
import { MVP_PREDICATES, type ParsedNewsPayload, type Predicate } from '../types/schema';

type FlatTriple = {
  subject: string;
  predicate: Predicate;
  object: string;
};

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

const flatTripleJsonSchema = {
  type: 'object',
  properties: {
    subject: {
      type: 'string',
      description: 'The left-hand entity or topic of the claim.',
    },
    predicate: {
      type: 'string',
      enum: [...MVP_PREDICATES],
      description: 'Must be one of the approved MVP predicates only.',
    },
    object: {
      type: 'string',
      description: 'The right-hand entity, value, or target of the claim.',
    },
  },
  required: ['subject', 'predicate', 'object'],
  additionalProperties: false,
} as const;

export const parsedNewsPayloadJsonSchema = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'The original headline text provided by the caller.',
    },
    source: {
      type: 'string',
      description: 'The normalized news source label or source domain.',
    },
    url: {
      type: 'string',
      description: 'The canonicalized article URL anchor.',
    },
    archive: {
      type: 'array',
      description:
        'archive[0] must be the main factual headline triple. archive[1..] are context triples.',
      minItems: 1,
      items: flatTripleJsonSchema,
    },
    arena: {
      type: 'array',
      description: 'For this phase, return an empty array.',
      items: flatTripleJsonSchema,
    },
  },
  required: ['headline', 'source', 'url', 'archive', 'arena'],
  additionalProperties: false,
  propertyOrdering: ['headline', 'source', 'url', 'archive', 'arena'],
} as const;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY environment variable.');
  }

  return new GoogleGenAI({ apiKey });
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
    isPredicate(candidate.predicate) &&
    typeof candidate.object === 'string'
  );
}

function assertParsedNewsPayload(value: unknown): asserts value is ParsedNewsPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Gemini output must be a JSON object.');
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.headline !== 'string') {
    throw new Error('Gemini output is missing a valid "headline" field.');
  }

  if (typeof candidate.source !== 'string') {
    throw new Error('Gemini output is missing a valid "source" field.');
  }

  if (typeof candidate.url !== 'string') {
    throw new Error('Gemini output is missing a valid "url" field.');
  }

  if (!Array.isArray(candidate.archive) || candidate.archive.length === 0) {
    throw new Error('Gemini output must include at least one archive triple.');
  }

  if (!candidate.archive.every(isFlatTriple)) {
    throw new Error('Gemini output contains an invalid archive triple.');
  }

  if (!Array.isArray(candidate.arena)) {
    throw new Error('Gemini output must include an arena array.');
  }

  if (!candidate.arena.every(isFlatTriple)) {
    throw new Error('Gemini output contains an invalid arena triple.');
  }
}

function buildPrompt(headline: string, canonicalUrl: string, canonicalSource: string): string {
  return [
    'You are an expert Ontologist.',
    'Extract the core factual claim from the following news headline.',
    'Return a JSON object that matches the provided response schema exactly.',
    'Put exactly ONE HeadlineTriple in archive[0] representing the main event.',
    'Put zero or more ContextTriples in archive[1..] to define the entities involved, especially with is_a when useful.',
    'Return arena as an empty array for now.',
    `Use only these approved predicates: ${MVP_PREDICATES.join(', ')}.`,
    'Do not invent extra keys, do not add commentary, and do not use markdown.',
    'All subject, predicate, and object values must be plain strings.',
    '',
    `Headline: ${headline}`,
    `Canonical URL: ${canonicalUrl}`,
    `Source: ${canonicalSource}`,
  ].join('\n');
}

export async function parseHeadline(
  headline: string,
  url: string,
  source: string,
): Promise<ParsedNewsPayload> {
  const client = getGeminiClient();
  const canonicalUrl = canonicalizeUrl(url);
  const canonicalSource = canonicalizeSource(source);
  const prompt = buildPrompt(headline, canonicalUrl, canonicalSource);

  const response = await client.models.generateContent({
    model: DEFAULT_GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: parsedNewsPayloadJsonSchema,
      temperature: 0.1,
    },
  });

  if (!response.text) {
    throw new Error('Gemini returned an empty response.');
  }

  const payload = JSON.parse(response.text) as unknown;
  assertParsedNewsPayload(payload);

  return {
    headline,
    source: canonicalSource,
    url: canonicalUrl,
    archive: payload.archive,
    arena: payload.arena,
  };
}
