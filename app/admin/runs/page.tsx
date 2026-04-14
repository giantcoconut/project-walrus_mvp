import Link from 'next/link';

import { AdminShell } from '../../../components/admin/admin-shell';
import { StatusPill } from '../../../components/admin/status-pill';
import { fetchClaimRuns } from '../../../src/db/supabase';
import { requireAdminAuth } from '../../../src/site/admin-auth';

export const dynamic = 'force-dynamic';

export default async function AdminRunsPage() {
  await requireAdminAuth();
  const runs = await fetchClaimRuns(100);

  return (
    <AdminShell title="Runs" kicker="Claim runs">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 px-5 py-4">
          <p className="text-sm text-zinc-500">{runs.length} recorded runs</p>
        </div>

        <div className="divide-y divide-zinc-800">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/admin/runs/${run.id}`}
              className="grid gap-4 px-5 py-5 transition-colors duration-150 hover:bg-zinc-900/60 md:grid-cols-[12rem_minmax(0,1fr)_10rem]"
            >
              <div className="space-y-1">
                <p className="text-[0.72rem] uppercase tracking-terminal text-zinc-500">
                  {run.trigger ?? 'SYSTEM'}
                </p>
                <p className="text-sm text-zinc-400">{new Date(run.created_at).toLocaleString()}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-zinc-500">Run ID</p>
                <p className="break-all text-sm text-zinc-200">{run.id}</p>
                {run.draft_id ? <p className="text-sm text-zinc-500">Draft: {run.draft_id}</p> : null}
              </div>
              <div className="md:text-right">
                <StatusPill value={run.status} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
