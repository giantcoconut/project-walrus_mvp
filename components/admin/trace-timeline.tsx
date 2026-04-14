import type { ClaimRunStepRow } from '../../src/types/schema';
import { StatusPill } from './status-pill';

function formatJson(value: Record<string, unknown> | null): string {
  if (!value) {
    return '{}';
  }

  return JSON.stringify(value, null, 2);
}

export function TraceTimeline({ steps }: { steps: ClaimRunStepRow[] }) {
  if (steps.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
        <p className="text-sm text-zinc-500">No step records were written for this run.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
      <div className="border-b border-zinc-800 px-6 py-4">
        <p className="text-sm text-zinc-500">Trace timeline</p>
      </div>

      <div className="divide-y divide-zinc-800">
        {steps.map((step) => (
          <details key={step.id} className="group px-6 py-4">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-[0.72rem] uppercase tracking-terminal text-zinc-500">{step.step}</p>
                <p className="text-sm text-zinc-400">{new Date(step.created_at).toLocaleString()}</p>
                {step.error_message ? (
                  <p className="max-w-3xl text-sm text-rose-300">{step.error_message}</p>
                ) : null}
              </div>
              <StatusPill value={step.status} />
            </summary>
            <pre className="mt-4 overflow-x-auto rounded-xl border border-zinc-800 bg-black/40 p-4 text-xs leading-6 text-zinc-300">
              {formatJson(step.detail_json)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}
