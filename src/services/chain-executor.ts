import 'dotenv/config';

import { API_URL_DEV, API_URL_PROD } from '@0xintuition/graphql';
import {
  eventParseAtomCreated,
  eventParseTripleCreated,
  getMultiVaultAddressFromChainId,
  intuitionMainnet,
  intuitionTestnet,
  multiVaultCreateAtoms,
  multiVaultCreateTriples,
  multiVaultGetAtomCost,
  multiVaultGetBondingCurveConfig,
  multiVaultGetTripleCost,
  multiVaultIsTermCreated,
  type WriteConfig,
} from '@0xintuition/protocol';
import {
  bigIntToHex,
  createPublicClient,
  createWalletClient,
  http,
  isHex,
  parseEther,
  toHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { getTripleIdFromIds } from '../core/id-engine';
import { getDraftById, updateDraft } from '../db/supabase';
import { resolveAndMapEntities, resolveGraphEntities } from './entity-resolver';
import type { ClaimDraftRow, EntityMetadata, TripleDraft } from '../types/schema';

type IntuitionChain = 'mainnet' | 'testnet';

interface ResolvedTripleIds {
  subjectId: Hex;
  predicateId: Hex;
  objectId: Hex;
  tripleId: Hex;
}

interface PreparedTriple {
  subjectId: Hex;
  predicateId: Hex;
  objectId: Hex;
  tripleId: Hex;
  deposit: bigint;
}

interface ExecutorContext {
  config: WriteConfig;
}

interface RichEntityDraftEntry {
  label: string;
  metadata: EntityMetadata;
}

interface PinnedRichEntity {
  label: string;
  ipfsUri: string;
}

const PIN_THING_MUTATION = `
  mutation PinThing($name: String!, $description: String!, $image: String!, $url: String!) {
    pinThing(thing: { name: $name, description: $description, image: $image, url: $url }) {
      uri
    }
  }
`;

function getConfiguredChain(): IntuitionChain {
  const rawChain = process.env.INTUITION_CHAIN?.toLowerCase();

  if (rawChain === 'mainnet' || rawChain === 'testnet') {
    return rawChain;
  }

  return 'testnet';
}

function getGraphqlEndpoint(): string {
  return getConfiguredChain() === 'mainnet' ? API_URL_PROD : API_URL_DEV;
}

function createExecutorContext(): ExecutorContext {
  const privateKey = process.env.INTUITION_PRIVATE_KEY;

  if (!privateKey || !isHex(privateKey)) {
    throw new Error('Missing or invalid INTUITION_PRIVATE_KEY environment variable.');
  }

  const chain = getConfiguredChain();
  const selectedChain = chain === 'mainnet' ? intuitionMainnet : intuitionTestnet;
  const rpcUrl = process.env.INTUITION_RPC_URL ?? selectedChain.rpcUrls.default.http[0];
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain: selectedChain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: selectedChain,
    transport: http(rpcUrl),
  });

  return {
    config: {
      address: getMultiVaultAddressFromChainId(selectedChain.id),
      publicClient,
      walletClient,
    },
  };
}

function getRichEntityEntries(draft: ClaimDraftRow): RichEntityDraftEntry[] {
  return Object.entries(draft.payload_json.entityMetadata).map(([label, metadata]) => ({
    label,
    metadata: {
      ...metadata,
      name: label,
    },
  }));
}

function getRichEntityLabels(draft: ClaimDraftRow): Set<string> {
  return new Set(getRichEntityEntries(draft).map((entry) => entry.label));
}

function collectStringsFromTriple(triple: TripleDraft, collector: Set<string>): void {
  collector.add(triple.subject);
  collector.add(triple.predicate);

  if (typeof triple.object === 'string') {
    collector.add(triple.object);
    return;
  }

  collectStringsFromTriple(triple.object, collector);
}

function collectDraftStrings(draft: ClaimDraftRow): string[] {
  const strings = new Set<string>([draft.source, draft.url, 'published', 'asserts']);

  for (const triple of draft.payload_json.archive) {
    collectStringsFromTriple(triple, strings);
  }

  for (const triple of draft.payload_json.arena) {
    collectStringsFromTriple(triple, strings);
  }

  return Array.from(strings);
}

function normalizeHttpsUrl(value: string | null): string {
  if (!value || !value.trim()) {
    return '';
  }

  try {
    const parsed = new URL(value);

    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function normalizeTermId(termId: unknown): Hex {
  if (typeof termId === 'bigint') {
    return bigIntToHex(termId, { size: 32 });
  }

  if (typeof termId === 'string' && isHex(termId)) {
    return termId;
  }

  throw new Error('Unable to normalize term id from event payload.');
}

function getRequiredId(entityIds: Map<string, Hex>, value: string): Hex {
  const resolved = entityIds.get(value);

  if (!resolved) {
    throw new Error(`Missing resolved term id for "${value}".`);
  }

  return resolved;
}

function resolveTripleIdsFromMap(
  triple: TripleDraft,
  entityIds: Map<string, Hex>,
): ResolvedTripleIds {
  const subjectId = getRequiredId(entityIds, triple.subject);
  const predicateId = getRequiredId(entityIds, triple.predicate);
  const objectId =
    typeof triple.object === 'string'
      ? getRequiredId(entityIds, triple.object)
      : resolveTripleIdsFromMap(triple.object, entityIds).tripleId;

  return {
    subjectId,
    predicateId,
    objectId,
    tripleId: getTripleIdFromIds(subjectId, predicateId, objectId),
  };
}

async function pinThingMetadata(metadata: EntityMetadata): Promise<string> {
  const response = await fetch(getGraphqlEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: PIN_THING_MUTATION,
      variables: {
        name: metadata.name.trim(),
        description: metadata.description.trim(),
        image: '',
        url: normalizeHttpsUrl(metadata.url),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Pin failed for "${metadata.name}" with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: {
      pinThing?: {
        uri?: string;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      `Pin failed for "${metadata.name}": ${payload.errors
        .map((error) => error.message ?? 'Unknown GraphQL error')
        .join('; ')}`,
    );
  }

  const ipfsUri = payload.data?.pinThing?.uri;

  if (!ipfsUri || !ipfsUri.startsWith('ipfs://')) {
    throw new Error(`Pin failed for "${metadata.name}": no valid IPFS URI returned.`);
  }

  return ipfsUri;
}

async function resolveOrMintRichEntities(
  draft: ClaimDraftRow,
  entityIds: Map<string, Hex>,
  context: ExecutorContext,
): Promise<void> {
  const richEntityEntries = getRichEntityEntries(draft);

  if (richEntityEntries.length === 0) {
    return;
  }

  const resolutions = await resolveAndMapEntities(richEntityEntries.map((entry) => entry.metadata));

  for (const entry of richEntityEntries) {
    const resolution = resolutions.get(entry.label);

    if (resolution?.status === 'FOUND') {
      entityIds.set(entry.label, resolution.termId);
    }
  }

  const missingEntries = richEntityEntries.filter((entry) => !entityIds.has(entry.label));

  if (missingEntries.length === 0) {
    return;
  }

  const pinnedEntities: PinnedRichEntity[] = [];

  for (const entry of missingEntries) {
    pinnedEntities.push({
      label: entry.label,
      ipfsUri: await pinThingMetadata(entry.metadata),
    });
  }

  const pinnedUriMap = await resolveGraphEntities(pinnedEntities.map((entity) => entity.ipfsUri));

  for (const entity of pinnedEntities) {
    const existingId = pinnedUriMap.get(entity.ipfsUri);

    if (existingId) {
      entityIds.set(entity.label, existingId);
    }
  }

  const entitiesToMint = pinnedEntities.filter((entity) => !entityIds.has(entity.label));

  if (entitiesToMint.length === 0) {
    return;
  }

  const atomCost = await multiVaultGetAtomCost(context.config);
  const txHash = await multiVaultCreateAtoms(context.config, {
    args: [
      entitiesToMint.map((entity) => toHex(entity.ipfsUri)),
      entitiesToMint.map(() => atomCost),
    ],
    value: atomCost * BigInt(entitiesToMint.length),
  });

  const events = await eventParseAtomCreated(context.config.publicClient, txHash);

  if (events.length !== entitiesToMint.length) {
    throw new Error('Rich atom creation event count did not match the number of missing entities.');
  }

  for (let index = 0; index < entitiesToMint.length; index += 1) {
    const createdId = normalizeTermId(events[index]?.args?.termId);
    entityIds.set(entitiesToMint[index].label, createdId);
  }
}

async function mintMissingStringAtoms(
  uniqueStrings: string[],
  entityIds: Map<string, Hex>,
  context: ExecutorContext,
): Promise<void> {
  const missingStrings = uniqueStrings.filter((value) => !entityIds.has(value));

  if (missingStrings.length === 0) {
    return;
  }

  const atomCost = await multiVaultGetAtomCost(context.config);
  const txHash = await multiVaultCreateAtoms(context.config, {
    args: [missingStrings.map((value) => toHex(value)), missingStrings.map(() => atomCost)],
    value: atomCost * BigInt(missingStrings.length),
  });

  const events = await eventParseAtomCreated(context.config.publicClient, txHash);

  if (events.length !== missingStrings.length) {
    throw new Error('Atom creation event count did not match the number of missing strings.');
  }

  for (let index = 0; index < missingStrings.length; index += 1) {
    const createdId = normalizeTermId(events[index]?.args?.termId);
    entityIds.set(missingStrings[index], createdId);
  }
}

async function buildPreparedTriples(
  draft: ClaimDraftRow,
  entityIds: Map<string, Hex>,
  tripleCost: bigint,
): Promise<PreparedTriple[]> {
  const sourceId = getRequiredId(entityIds, draft.source);
  const publishedId = getRequiredId(entityIds, 'published');
  const urlId = getRequiredId(entityIds, draft.url);
  const assertsId = getRequiredId(entityIds, 'asserts');

  const headlineTriple = draft.payload_json.archive[0];

  if (!headlineTriple) {
    throw new Error(`Draft ${draft.id} has no headline triple in payload_json.archive[0].`);
  }

  const headlineIds = resolveTripleIdsFromMap(headlineTriple, entityIds);
  const contextTriples = [...draft.payload_json.archive.slice(1), ...draft.payload_json.arena];

  const prepared: PreparedTriple[] = [
    {
      subjectId: sourceId,
      predicateId: publishedId,
      objectId: urlId,
      tripleId: getTripleIdFromIds(sourceId, publishedId, urlId),
      deposit: tripleCost,
    },
    {
      ...headlineIds,
      deposit: tripleCost + parseEther('0.1'),
    },
    {
      subjectId: urlId,
      predicateId: assertsId,
      objectId: headlineIds.tripleId,
      tripleId: getTripleIdFromIds(urlId, assertsId, headlineIds.tripleId),
      deposit: tripleCost,
    },
  ];

  for (const triple of contextTriples) {
    prepared.push({
      ...resolveTripleIdsFromMap(triple, entityIds),
      deposit: tripleCost,
    });
  }

  return prepared;
}

async function filterMissingTriples(
  preparedTriples: PreparedTriple[],
  context: ExecutorContext,
): Promise<PreparedTriple[]> {
  const missing: PreparedTriple[] = [];

  for (const triple of preparedTriples) {
    const exists = await multiVaultIsTermCreated(context.config, {
      args: [triple.tripleId],
    });

    if (!exists) {
      missing.push(triple);
    }
  }

  return missing;
}

export async function mintDraftOnChain(draftId: string): Promise<void> {
  const draft = await getDraftById(draftId);

  if (!draft) {
    throw new Error(`Draft ${draftId} not found.`);
  }

  if (draft.status === 'MINTING') {
    console.log(`[chain-executor] Draft ${draftId} is already MINTING. Skipping.`);
    return;
  }

  if (draft.status !== 'APPROVED') {
    throw new Error(`Draft ${draftId} must be APPROVED before minting. Current status: ${draft.status}`);
  }

  await updateDraft(draftId, {
    status: 'MINTING',
    last_error: null,
  });

  try {
    const context = createExecutorContext();
    await multiVaultGetBondingCurveConfig(context.config);

    const uniqueStrings = collectDraftStrings(draft);
    const richEntityLabels = getRichEntityLabels(draft);
    const plainStrings = uniqueStrings.filter((value) => !richEntityLabels.has(value));
    const entityIds = await resolveGraphEntities(plainStrings);

    await resolveOrMintRichEntities(draft, entityIds, context);
    await mintMissingStringAtoms(uniqueStrings, entityIds, context);

    const tripleCost = await multiVaultGetTripleCost(context.config);
    const preparedTriples = await buildPreparedTriples(draft, entityIds, tripleCost);
    const missingTriples = await filterMissingTriples(preparedTriples, context);

    let txHash: Hex | null = null;

    if (missingTriples.length > 0) {
      txHash = await multiVaultCreateTriples(context.config, {
        args: [
          missingTriples.map((triple) => triple.subjectId),
          missingTriples.map((triple) => triple.predicateId),
          missingTriples.map((triple) => triple.objectId),
          missingTriples.map((triple) => triple.deposit),
        ],
        value: missingTriples.reduce((total, triple) => total + triple.deposit, 0n),
      });

      await eventParseTripleCreated(context.config.publicClient, txHash);
    } else {
      console.log(`[chain-executor] All provenance triples already exist for draft ${draftId}.`);
    }

    await updateDraft(draftId, {
      status: 'MINTED',
      tx_hash: txHash,
      last_error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await updateDraft(draftId, {
      status: 'ERROR',
      last_error: message,
    });

    throw error;
  }
}
