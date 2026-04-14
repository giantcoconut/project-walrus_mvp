import Link from 'next/link';

import { AdminShell } from '../../../components/admin/admin-shell';
import { StatusPill } from '../../../components/admin/status-pill';
import { fetchMintedClaims } from '../../../src/db/supabase';
import { requireAdminAuth } from '../../../src/site/admin-auth';

export const dynamic = 'force-dynamic';

export default async function AdminMintedPage() {
  await requireAdminAuth();
  const drafts = await fetchMintedClaims(100);

  return (
    <AdminShell title="Minted" kicker="Published records">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 px-5 py-4">
          <p className="text-sm text-zinc-500">{drafts.length} minted claims</p>
        </div>
        <div className="divide-y divide-zinc-800">
          {drafts.map((draft) => (
            <div key={draft.id} className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
              <div className="space-y-1">
                <Link href={`/admin/drafts/${draft.id}`} className="font-serif text-[1.45rem] tracking-[-0.03em] text-zinc-50">
                  {draft.headline}
                </Link>
                <p className="text-sm text-zinc-500">{draft.source}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-zinc-500">Transaction</p>
                <p className="break-all text-xs text-zinc-300">{draft.tx_hash ?? 'Unavailable'}</p>
              </div>
              <div className="md:text-right">
                <StatusPill value={draft.status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
