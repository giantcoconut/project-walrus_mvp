import type { ClaimRunStatus, DraftStatus } from '../../src/types/schema';

type StatusValue = ClaimRunStatus | DraftStatus;

const STATUS_STYLES: Record<StatusValue, string> = {
  PENDING: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  APPROVED: 'border-sky-400/25 bg-sky-400/10 text-sky-200',
  REJECTED: 'border-zinc-400/25 bg-zinc-400/10 text-zinc-300',
  MINTING: 'border-violet-400/25 bg-violet-400/10 text-violet-200',
  MINTED: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  ERROR: 'border-rose-400/25 bg-rose-400/10 text-rose-200',
  RUNNING: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  SUCCESS: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
};

export function StatusPill({ value }: { value: StatusValue }) {
  return (
    <span
      className={[
        'inline-flex rounded-full border px-2.5 py-1 text-[0.7rem] uppercase tracking-terminal',
        STATUS_STYLES[value],
      ].join(' ')}
    >
      {value}
    </span>
  );
}
