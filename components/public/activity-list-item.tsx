import type { ReactNode } from 'react';

import type { ProtocolActivityItem } from '../../src/site/protocol-activity';
import {
  formatProtocolActivityTime,
  getProtocolActivityTxUrl,
} from '../../src/site/protocol-activity';

interface ActivityListItemProps {
  item: ProtocolActivityItem;
}

function actorFallback(label: string): string {
  const trimmed = label.trim();
  return trimmed.slice(0, 2).toUpperCase();
}

function kindBadge(item: ProtocolActivityItem): string {
  switch (item.kind) {
    case 'atom-created':
      return 'Atom';
    case 'claim-created':
      return 'Claim';
    case 'atom-deposit':
      return 'Signal';
    case 'atom-redeem':
      return 'Redeem';
    case 'claim-support':
      return 'Support';
    case 'claim-oppose':
      return 'Opposition';
    case 'claim-redeem-support':
      return 'Support exit';
    case 'claim-redeem-opposition':
      return 'Opposition exit';
  }
}

function buildSentence(item: ProtocolActivityItem): { verb: string; target: ReactNode } {
  if (item.atom) {
    switch (item.kind) {
      case 'atom-created':
        return {
          verb: 'created an atom',
          target: <span className="font-medium text-ink">{item.atom.label}</span>,
        };
      case 'atom-redeem':
        return {
          verb: `redeemed ${item.amount ?? 'TRUST'} from`,
          target: <span className="font-medium text-ink">{item.atom.label}</span>,
        };
      default:
        return {
          verb: `deposited ${item.amount ?? 'TRUST'} on`,
          target: <span className="font-medium text-ink">{item.atom.label}</span>,
        };
    }
  }

  if (item.claim) {
    const claimTarget = (
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="max-w-[10rem] truncate rounded-md bg-accentSoft px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-[0.08em] text-olive sm:max-w-[14rem]">
          {item.claim.subject.label}
        </span>
        <span className="max-w-[8rem] truncate text-[0.9rem] text-muted sm:max-w-[10rem]">
          {item.claim.predicate.label}
        </span>
        <span className="max-w-[15rem] truncate rounded-md bg-white/80 px-2 py-0.5 text-[0.76rem] font-medium text-ink shadow-[inset_0_0_0_1px_rgba(92,67,44,0.08)] sm:max-w-[22rem]">
          {item.claim.object.label}
        </span>
      </span>
    );

    switch (item.kind) {
      case 'claim-created':
        return {
          verb: 'created a claim',
          target: claimTarget,
        };
      case 'claim-oppose':
        return {
          verb: `opposed with ${item.amount ?? 'TRUST'}`,
          target: claimTarget,
        };
      case 'claim-redeem-opposition':
        return {
          verb: `redeemed ${item.amount ?? 'TRUST'} from opposition on`,
          target: claimTarget,
        };
      case 'claim-redeem-support':
        return {
          verb: `redeemed ${item.amount ?? 'TRUST'} from support on`,
          target: claimTarget,
        };
      default:
        return {
          verb: `supported with ${item.amount ?? 'TRUST'}`,
          target: claimTarget,
        };
    }
  }

  return {
    verb: item.eventType.toLowerCase(),
    target: <span className="font-medium text-ink">Unknown target</span>,
  };
}

export function ActivityListItem({ item }: ActivityListItemProps) {
  const sentence = buildSentence(item);
  const txUrl = getProtocolActivityTxUrl(item.network, item.transactionHash);

  return (
    <article className="group border-b border-line/70 py-3 first:border-t first:border-line/70 sm:py-3.5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_8.5rem] lg:items-center">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line/80 bg-white/75 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-muted">
            {item.actor.image ? (
              <img
                src={item.actor.image}
                alt={item.actor.label}
                className="h-full w-full object-cover"
              />
            ) : (
              actorFallback(item.actor.label)
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.66rem] uppercase tracking-terminal text-muted">
              <span className="rounded-full border border-line bg-white/85 px-2 py-0.5 text-[0.64rem] text-muted">
                {kindBadge(item)}
              </span>
              <span>{item.network}</span>
              <span className="text-line">/</span>
              <span>Block {item.blockNumber.toLocaleString('en-US')}</span>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.95rem] leading-6 text-muted sm:text-[1rem]">
              <span className="max-w-[12rem] truncate font-medium text-ink sm:max-w-[16rem]">{item.actor.label}</span>
              <span>{sentence.verb}</span>
              {sentence.target}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-[0.82rem] text-muted lg:justify-end lg:text-right">
          <span className="whitespace-nowrap">{formatProtocolActivityTime(item.createdAt)}</span>
          <a
            href={txUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-full border border-line bg-white/70 px-2.5 py-1 text-[0.66rem] uppercase tracking-[0.08em] text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink"
          >
            Tx
          </a>
        </div>
      </div>
    </article>
  );
}
