import { formatEther, type Hex } from 'viem';

import {
  getIntuitionNetwork,
  queryIntuitionGraph,
  resolveIntuitionImageUrl,
  type PublicIntuitionNetwork,
} from '../intuition/public';

type RawEventType = 'AtomCreated' | 'TripleCreated' | 'Deposited' | 'Redeemed';

export type ProtocolActivityFilter = 'all' | 'creation' | 'signal' | 'redeem';
export type ProtocolActivityScope = 'all' | 'claims' | 'atoms';
export type ProtocolActivityKind =
  | 'atom-created'
  | 'claim-created'
  | 'atom-deposit'
  | 'atom-redeem'
  | 'claim-support'
  | 'claim-oppose'
  | 'claim-redeem-support'
  | 'claim-redeem-opposition';

interface GraphAccount {
  id?: string | null;
  label?: string | null;
  image?: string | null;
}

interface GraphAtom {
  term_id: string;
  label: string;
  image?: string | null;
  type?: string | null;
  creator?: GraphAccount | null;
}

interface GraphTriple {
  term_id: string;
  counter_term_id: string;
  creator?: GraphAccount | null;
  subject: GraphAtom;
  predicate: GraphAtom;
  object: GraphAtom;
}

interface GraphTermShape {
  atom?: GraphAtom | null;
  triple?: {
    term_id: string;
    subject: { label: string };
    predicate: { label: string };
    object: { label: string };
  } | null;
}

interface GraphDeposit {
  term_id: string;
  assets_after_fees: string;
  shares: string;
  vault_type: 'Atom' | 'Triple';
  sender?: GraphAccount | null;
  receiver?: GraphAccount | null;
  term?: GraphTermShape | null;
}

interface GraphRedemption {
  term_id: string;
  assets: string;
  shares: string;
  vault_type: 'Atom' | 'Triple';
  sender?: GraphAccount | null;
  receiver?: GraphAccount | null;
  term?: GraphTermShape | null;
}

interface GraphEvent {
  id: string;
  type: RawEventType;
  block_number: string;
  created_at: string;
  transaction_hash: string;
  atom_id?: string | null;
  triple_id?: string | null;
  atom?: GraphAtom | null;
  triple?: GraphTriple | null;
  deposit?: GraphDeposit | null;
  redemption?: GraphRedemption | null;
}

interface ProtocolActivityQueryData {
  events?: GraphEvent[];
}

export interface ProtocolActivityActor {
  id: string | null;
  label: string;
  image: string | null;
}

export interface ProtocolActivityAtomTarget {
  termId: Hex;
  label: string;
  image: string | null;
  type: string | null;
}

export interface ProtocolActivityClaimTarget {
  termId: Hex;
  counterTermId: Hex | null;
  subject: {
    termId: Hex | null;
    label: string;
    image: string | null;
  };
  predicate: {
    termId: Hex | null;
    label: string;
  };
  object: {
    termId: Hex | null;
    label: string;
    image: string | null;
  };
}

export interface ProtocolActivityItem {
  id: string;
  network: PublicIntuitionNetwork;
  eventType: RawEventType;
  kind: ProtocolActivityKind;
  createdAt: string;
  blockNumber: number;
  transactionHash: Hex;
  actor: ProtocolActivityActor;
  amount: string | null;
  shares: string | null;
  atom: ProtocolActivityAtomTarget | null;
  claim: ProtocolActivityClaimTarget | null;
  searchText: string;
}

export interface FetchProtocolActivityOptions {
  network: PublicIntuitionNetwork;
  limit?: number;
  filter?: ProtocolActivityFilter;
  scope?: ProtocolActivityScope;
  query?: string;
}

export interface ProtocolActivityResult {
  items: ProtocolActivityItem[];
  error: string | null;
}

const DEFAULT_EVENT_LIMIT = 80;

const PROTOCOL_ACTIVITY_QUERY = `
  query GetProtocolActivity($limit: Int!, $where: events_bool_exp) {
    events(
      where: $where
      order_by: [{ block_number: desc }, { id: desc }]
      limit: $limit
    ) {
      id
      type
      block_number
      created_at
      transaction_hash
      atom_id
      triple_id
      atom {
        term_id
        label
        image
        type
        creator {
          id
          label
          image
        }
      }
      triple {
        term_id
        counter_term_id
        creator {
          id
          label
          image
        }
        subject {
          term_id
          label
          image
        }
        predicate {
          term_id
          label
        }
        object {
          term_id
          label
          image
        }
      }
      deposit {
        term_id
        assets_after_fees
        shares
        vault_type
        sender {
          id
          label
          image
        }
        receiver {
          id
          label
          image
        }
        term {
          atom {
            term_id
            label
            image
            type
          }
          triple {
            term_id
            subject { label }
            predicate { label }
            object { label }
          }
        }
      }
      redemption {
        term_id
        assets
        shares
        vault_type
        sender {
          id
          label
          image
        }
        receiver {
          id
          label
          image
        }
        term {
          atom {
            term_id
            label
            image
            type
          }
          triple {
            term_id
            subject { label }
            predicate { label }
            object { label }
          }
        }
      }
    }
  }
`;

function compactLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function formatTrustAmount(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const numeric = Number.parseFloat(formatEther(BigInt(raw)));

  if (!Number.isFinite(numeric)) {
    return null;
  }

  const formatted =
    numeric >= 1000
      ? new Intl.NumberFormat('en-US', {
          notation: 'compact',
          maximumFractionDigits: 2,
        }).format(numeric)
      : numeric.toLocaleString('en-US', {
          maximumFractionDigits: numeric >= 1 ? 4 : 6,
        });

  return `${formatted} TRUST`;
}

function formatShareAmount(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const numeric = Number.parseFloat(formatEther(BigInt(raw)));

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric.toLocaleString('en-US', {
    maximumFractionDigits: numeric >= 1 ? 3 : 6,
  });
}

function buildActor(account?: GraphAccount | null, fallback = 'Unknown account'): ProtocolActivityActor {
  return {
    id: account?.id?.trim() || null,
    label: compactLabel(account?.label, fallback),
    image: resolveIntuitionImageUrl(account?.image ?? null),
  };
}

function mapAtomTarget(atom?: GraphAtom | null): ProtocolActivityAtomTarget | null {
  if (!atom?.term_id || !atom.label) {
    return null;
  }

  return {
    termId: atom.term_id as Hex,
    label: atom.label,
    image: resolveIntuitionImageUrl(atom.image ?? null),
    type: atom.type?.trim() || null,
  };
}

function mapClaimTarget(triple?: GraphTriple | null): ProtocolActivityClaimTarget | null {
  if (!triple?.term_id || !triple.subject || !triple.predicate || !triple.object) {
    return null;
  }

  return {
    termId: triple.term_id as Hex,
    counterTermId: triple.counter_term_id ? (triple.counter_term_id as Hex) : null,
    subject: {
      termId: triple.subject.term_id ? (triple.subject.term_id as Hex) : null,
      label: triple.subject.label,
      image: resolveIntuitionImageUrl(triple.subject.image ?? null),
    },
    predicate: {
      termId: triple.predicate.term_id ? (triple.predicate.term_id as Hex) : null,
      label: triple.predicate.label,
    },
    object: {
      termId: triple.object.term_id ? (triple.object.term_id as Hex) : null,
      label: triple.object.label,
      image: resolveIntuitionImageUrl(triple.object.image ?? null),
    },
  };
}

function getClaimDepositKind(event: GraphEvent): ProtocolActivityKind {
  const isOpposition = event.deposit?.term_id && event.deposit.term_id === event.triple?.counter_term_id;
  return isOpposition ? 'claim-oppose' : 'claim-support';
}

function getClaimRedemptionKind(event: GraphEvent): ProtocolActivityKind {
  const isOpposition = event.redemption?.term_id && event.redemption.term_id === event.triple?.counter_term_id;
  return isOpposition ? 'claim-redeem-opposition' : 'claim-redeem-support';
}

function buildSearchText(item: Omit<ProtocolActivityItem, 'searchText'>): string {
  const fragments = [
    item.actor.label,
    item.atom?.label,
    item.atom?.type,
    item.claim?.subject.label,
    item.claim?.predicate.label,
    item.claim?.object.label,
    item.amount,
    item.transactionHash,
    item.kind,
    item.eventType,
  ];

  return fragments
    .filter((fragment): fragment is string => Boolean(fragment))
    .join(' ')
    .toLowerCase();
}

function mapEvent(network: PublicIntuitionNetwork, event: GraphEvent): ProtocolActivityItem | null {
  if (event.type === 'AtomCreated') {
    const atom = mapAtomTarget(event.atom);

    if (!atom) {
      return null;
    }

    const item = {
      id: event.id,
      network,
      eventType: event.type,
      kind: 'atom-created' as const,
      createdAt: event.created_at,
      blockNumber: Number.parseInt(event.block_number, 10),
      transactionHash: event.transaction_hash as Hex,
      actor: buildActor(event.atom?.creator, 'Unknown creator'),
      amount: null,
      shares: null,
      atom,
      claim: null,
    };

    return {
      ...item,
      searchText: buildSearchText(item),
    };
  }

  if (event.type === 'TripleCreated') {
    const claim = mapClaimTarget(event.triple);

    if (!claim) {
      return null;
    }

    const item = {
      id: event.id,
      network,
      eventType: event.type,
      kind: 'claim-created' as const,
      createdAt: event.created_at,
      blockNumber: Number.parseInt(event.block_number, 10),
      transactionHash: event.transaction_hash as Hex,
      actor: buildActor(event.triple?.creator, 'Unknown creator'),
      amount: null,
      shares: null,
      atom: null,
      claim,
    };

    return {
      ...item,
      searchText: buildSearchText(item),
    };
  }

  if (event.type === 'Deposited') {
    const isClaim = event.deposit?.vault_type === 'Triple';
    const item = {
      id: event.id,
      network,
      eventType: event.type,
      kind: isClaim ? getClaimDepositKind(event) : ('atom-deposit' as const),
      createdAt: event.created_at,
      blockNumber: Number.parseInt(event.block_number, 10),
      transactionHash: event.transaction_hash as Hex,
      actor: buildActor(event.deposit?.sender ?? event.deposit?.receiver, 'Unknown account'),
      amount: formatTrustAmount(event.deposit?.assets_after_fees),
      shares: formatShareAmount(event.deposit?.shares),
      atom: isClaim ? null : mapAtomTarget(event.atom ?? event.deposit?.term?.atom ?? null),
      claim: isClaim ? mapClaimTarget(event.triple) : null,
    };

    return {
      ...item,
      searchText: buildSearchText(item),
    };
  }

  if (event.type === 'Redeemed') {
    const isClaim = event.redemption?.vault_type === 'Triple';
    const item = {
      id: event.id,
      network,
      eventType: event.type,
      kind: isClaim ? getClaimRedemptionKind(event) : ('atom-redeem' as const),
      createdAt: event.created_at,
      blockNumber: Number.parseInt(event.block_number, 10),
      transactionHash: event.transaction_hash as Hex,
      actor: buildActor(event.redemption?.sender ?? event.redemption?.receiver, 'Unknown account'),
      amount: formatTrustAmount(event.redemption?.assets),
      shares: formatShareAmount(event.redemption?.shares),
      atom: isClaim ? null : mapAtomTarget(event.atom ?? event.redemption?.term?.atom ?? null),
      claim: isClaim ? mapClaimTarget(event.triple) : null,
    };

    return {
      ...item,
      searchText: buildSearchText(item),
    };
  }

  return null;
}

function matchesScope(item: ProtocolActivityItem, scope: ProtocolActivityScope): boolean {
  if (scope === 'all') {
    return true;
  }

  if (scope === 'atoms') {
    return item.atom !== null;
  }

  return item.claim !== null;
}

function matchesFilter(item: ProtocolActivityItem, filter: ProtocolActivityFilter): boolean {
  switch (filter) {
    case 'creation':
      return item.kind === 'atom-created' || item.kind === 'claim-created';
    case 'signal':
      return item.kind === 'atom-deposit' || item.kind === 'claim-support' || item.kind === 'claim-oppose';
    case 'redeem':
      return (
        item.kind === 'atom-redeem' ||
        item.kind === 'claim-redeem-support' ||
        item.kind === 'claim-redeem-opposition'
      );
    default:
      return true;
  }
}

function matchesQuery(item: ProtocolActivityItem, query: string): boolean {
  return item.searchText.includes(query.trim().toLowerCase());
}

function buildEventWhere(filter: ProtocolActivityFilter): Record<string, unknown> {
  const baseTypes: RawEventType[] = ['AtomCreated', 'TripleCreated', 'Deposited', 'Redeemed'];

  if (filter === 'creation') {
    return { type: { _in: ['AtomCreated', 'TripleCreated'] } };
  }

  if (filter === 'signal') {
    return { type: { _in: ['Deposited'] } };
  }

  if (filter === 'redeem') {
    return { type: { _in: ['Redeemed'] } };
  }

  return { type: { _in: baseTypes } };
}

export async function fetchProtocolActivity({
  network,
  limit = DEFAULT_EVENT_LIMIT,
  filter = 'all',
  scope = 'all',
  query = '',
}: FetchProtocolActivityOptions): Promise<ProtocolActivityResult> {
  try {
    const data = await queryIntuitionGraph<ProtocolActivityQueryData, { limit: number; where: Record<string, unknown> }>(
      network,
      PROTOCOL_ACTIVITY_QUERY,
      {
        limit: Math.min(Math.max(limit, 12), 120),
        where: buildEventWhere(filter),
      },
    );

    const items = (data.events ?? [])
      .map((event) => mapEvent(network, event))
      .filter((item): item is ProtocolActivityItem => item !== null)
      .filter((item) => matchesScope(item, scope))
      .filter((item) => (query ? matchesQuery(item, query) : true));

    return {
      items,
      error: null,
    };
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : 'Protocol activity could not be loaded.',
    };
  }
}

export function getProtocolActivityTxUrl(
  network: PublicIntuitionNetwork,
  transactionHash: Hex,
): string {
  return `${getIntuitionNetwork(network).explorerUrl}/tx/${transactionHash}`;
}

export function formatProtocolActivityTime(value: string): string {
  const date = new Date(value);
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];

  for (const [unit, size] of ranges) {
    if (Math.abs(diffSeconds) >= size || unit === 'minute') {
      return formatter.format(Math.round(diffSeconds / size), unit);
    }
  }

  return 'just now';
}

export function formatProtocolActivityTimestamp(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
