import Link from 'next/link';

import { AdminShell } from '../../components/admin/admin-shell';
import { StatusPill } from '../../components/admin/status-pill';
import { countDrafts, fetchClaimRuns, fetchRecentDrafts } from '../../src/db/supabase';
import { isAdminAuthenticated, isAdminConfigured } from '../../src/site/admin-auth';
import { loginAction, logoutAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const configured = isAdminConfigured();
  const authenticated = await isAdminAuthenticated();

  if (!configured || !authenticated) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-[92rem] items-center justify-center px-5 py-16">
        <div className="w-full max-w-md rounded-[1.75rem] border border-zinc-800 bg-zinc-950 p-8 text-zinc-100 shadow-2xl shadow-black/30">
          <div className="space-y-4">
            <p className="text-[0.72rem] uppercase tracking-terminal text-zinc-500">Admin access</p>
            <h1 className="font-serif text-[2.5rem] leading-none tracking-[-0.04em]">Operations console</h1>
            {!configured ? (
              <p className="text-sm leading-7 text-zinc-400">
                Set `ADMIN_PASSWORD` in your `.env` before using the admin console.
              </p>
            ) : (
              <p className="text-sm leading-7 text-zinc-400">
                Sign in to inspect the ingestion pipeline, review staged drafts, and track execution runs.
              </p>
            )}
          </div>

          {configured ? (
            <form action={loginAction} className="mt-8 space-y-4">
              <input type="hidden" name="next" value="/admin/controls" />
              <label className="block space-y-2">
                <span className="text-sm text-zinc-400">Password</span>
                <input
                  name="password"
                  type="password"
                  className="w-full rounded-xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors duration-150 placeholder:text-zinc-600 focus:border-zinc-600"
                  placeholder="Enter admin password"
                  required
                />
              </label>
              {searchParams?.error === 'invalid' ? (
                <p className="text-sm text-rose-300">Invalid password.</p>
              ) : null}
              <button
                type="submit"
                className="inline-flex rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-100 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-950"
              >
                Enter console
              </button>
            </form>
          ) : null}
        </div>
      </div>
    );
  }

  const [pending, approved, minted, errored, recentRuns, recentDrafts] = await Promise.all([
    countDrafts('PENDING'),
    countDrafts('APPROVED'),
    countDrafts('MINTED'),
    countDrafts('ERROR'),
    fetchClaimRuns(5),
    fetchRecentDrafts(6),
  ]);

  return (
    <AdminShell
      title="Operations overview"
      kicker="Admin console"
      actions={
        <form action={logoutAction}>
          <button className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors duration-150 hover:border-zinc-500 hover:text-zinc-50">
            Sign out
          </button>
        </form>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_24rem]">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Pending review', value: pending },
            { label: 'Approved', value: approved },
            { label: 'Minted', value: minted },
            { label: 'Errors', value: errored },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
              <p className="text-sm text-zinc-500">{item.label}</p>
              <p className="mt-3 font-serif text-[2.35rem] leading-none tracking-[-0.05em] text-zinc-50">
                {item.value}
              </p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <p className="text-sm text-zinc-500">Next operational steps</p>
          <div className="mt-4 space-y-3 text-sm leading-7 text-zinc-300">
            <p>Use Controls to pull fresh RSS items into the staging layer.</p>
            <p>Use Inbox to inspect and approve staged drafts.</p>
            <p>Use Runs to audit each ingestion pass step by step.</p>
          </div>
        </section>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_24rem]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <p className="text-sm text-zinc-500">Recent drafts</p>
            <Link href="/admin/inbox" className="text-sm text-zinc-400 hover:text-zinc-50">
              Open inbox
            </Link>
          </div>
          <div className="divide-y divide-zinc-800">
            {recentDrafts.map((draft) => (
              <Link
                key={draft.id}
                href={`/admin/drafts/${draft.id}`}
                className="block px-5 py-4 transition-colors duration-150 hover:bg-zinc-900/60"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm text-zinc-400">{draft.source}</p>
                    <p className="text-base leading-7 text-zinc-100">{draft.headline}</p>
                  </div>
                  <StatusPill value={draft.status} />
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
          <div className="border-b border-zinc-800 px-5 py-4">
            <p className="text-sm text-zinc-500">Recent runs</p>
          </div>
          <div className="divide-y divide-zinc-800">
            {recentRuns.map((run) => (
              <Link
                key={run.id}
                href={`/admin/runs/${run.id}`}
                className="block px-5 py-4 transition-colors duration-150 hover:bg-zinc-900/60"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-[0.72rem] uppercase tracking-terminal text-zinc-500">
                      {run.trigger ?? 'SYSTEM'}
                    </p>
                    <p className="text-sm text-zinc-400">{new Date(run.created_at).toLocaleString()}</p>
                  </div>
                  <StatusPill value={run.status} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
