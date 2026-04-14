import Link from 'next/link';

import { AdminShell } from '../../../components/admin/admin-shell';
import { StatusPill } from '../../../components/admin/status-pill';
import { fetchPendingDrafts } from '../../../src/db/supabase';
import { requireAdminAuth } from '../../../src/site/admin-auth';
import { approveDraftAction, rejectDraftAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function AdminInboxPage() {
  await requireAdminAuth();
  const drafts = await fetchPendingDrafts(50);

  return (
    <AdminShell title="Inbox" kicker="Pending review">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 px-5 py-4">
          <p className="text-sm text-zinc-500">{drafts.length} pending drafts</p>
        </div>

        {drafts.length > 0 ? (
          <div className="divide-y divide-zinc-800">
            {drafts.map((draft) => (
              <div key={draft.id} className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <StatusPill value={draft.status} />
                    <span className="text-sm text-zinc-500">{draft.source}</span>
                  </div>
                  <Link href={`/admin/drafts/${draft.id}`} className="block">
                    <h2 className="font-serif text-[1.7rem] leading-tight tracking-[-0.03em] text-zinc-50">
                      {draft.headline}
                    </h2>
                  </Link>
                  <p className="text-sm text-zinc-500">{new Date(draft.created_at).toLocaleString()}</p>
                </div>

                <div className="flex flex-wrap items-start gap-3 xl:justify-end">
                  <form action={approveDraftAction}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="redirectTo" value="/admin/inbox" />
                    <button className="rounded-full border border-emerald-400/30 px-4 py-2 text-sm text-emerald-200 transition-colors duration-150 hover:bg-emerald-400/10">
                      Approve
                    </button>
                  </form>
                  <form action={rejectDraftAction}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="redirectTo" value="/admin/inbox" />
                    <button className="rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-200 transition-colors duration-150 hover:bg-rose-400/10">
                      Reject
                    </button>
                  </form>
                  <Link
                    href={`/admin/drafts/${draft.id}`}
                    className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors duration-150 hover:border-zinc-500 hover:text-zinc-50"
                  >
                    Inspect
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8">
            <p className="text-sm text-zinc-500">No pending drafts right now.</p>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
