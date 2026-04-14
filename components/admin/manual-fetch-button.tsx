'use client';

import { useEffect, useMemo, useState } from 'react';

const STAGE_TIMELINE = [
  {
    afterMs: 0,
    label: 'Starting run',
    description: 'Opening a fresh ingestion run and preparing the trace log.',
  },
  {
    afterMs: 1200,
    label: 'Fetching feeds',
    description: 'Pulling the latest headlines from each approved RSS source.',
  },
  {
    afterMs: 4200,
    label: 'Checking URLs',
    description: 'Canonicalizing links and comparing them against existing drafts.',
  },
  {
    afterMs: 7600,
    label: 'Parsing claims',
    description: 'Sending fresh headlines through the parser and structuring triples.',
  },
  {
    afterMs: 14000,
    label: 'Saving drafts',
    description: 'Writing fresh payloads and trace steps into Supabase.',
  },
  {
    afterMs: 21000,
    label: 'Preparing redirect',
    description: 'Finishing the run summary and sending you to the trace view.',
  },
] as const;

function LoadingSpinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-100"
    />
  );
}

function FetchButtonBody({ pending }: { pending: boolean }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!pending) {
      setElapsedMs(0);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 300);

    return () => {
      window.clearInterval(timer);
    };
  }, [pending]);

  const currentStage = useMemo(() => {
    return [...STAGE_TIMELINE]
      .reverse()
      .find((stage) => elapsedMs >= stage.afterMs) ?? STAGE_TIMELINE[0];
  }, [elapsedMs]);

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-w-[10rem] items-center justify-center gap-2 rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-100 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-wait disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500"
      >
        {pending ? <LoadingSpinner /> : null}
        {pending ? 'Running fetch...' : 'Fetch latest'}
      </button>

      <div
        aria-live="polite"
        className={`overflow-hidden rounded-2xl border px-4 py-3 transition-all duration-200 ${
          pending
            ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-zinc-100'
            : 'border-zinc-800 bg-zinc-950/50 text-zinc-400'
        }`}
      >
        {pending ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <LoadingSpinner />
              <p className="text-sm font-medium text-zinc-100">{currentStage.label}</p>
            </div>
            <p className="text-sm leading-6 text-zinc-400">{currentStage.description}</p>
            <p className="text-[0.72rem] uppercase tracking-terminal text-zinc-500">
              Runtime depends on feed response time, duplicate count, and how many fresh headlines need parsing.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-zinc-300">Ready to run a new ingestion pass.</p>
            <p className="text-sm leading-6 text-zinc-500">
              Expect slower runs when the parser has to structure multiple fresh headlines.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

export function ManualFetchButton({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  return (
    <form
      action={action}
      className="space-y-4"
      onSubmit={() => {
        setPending(true);
      }}
    >
      <FetchButtonBody pending={pending} />
    </form>
  );
}
