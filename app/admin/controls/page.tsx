import { AdminShell } from '../../../components/admin/admin-shell';
import { ManualFetchButton } from '../../../components/admin/manual-fetch-button';
import { requireAdminAuth } from '../../../src/site/admin-auth';
import { FEED_HEADLINE_LOOKBACK, FEEDS } from '../../../src/listeners/rss-poller';
import { logoutAction, manualFetchLatestAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function AdminControlsPage() {
  await requireAdminAuth();

  return (
    <AdminShell
      title="Controls"
      kicker="Manual operations"
      actions={
        <form action={logoutAction}>
          <button className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors duration-150 hover:border-zinc-500 hover:text-zinc-50">
            Sign out
          </button>
        </form>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">Pipeline trigger</p>
            <h2 className="font-serif text-[2rem] leading-none tracking-[-0.04em] text-zinc-50">
              Fetch latest RSS items now
            </h2>
            <p className="max-w-2xl text-sm leading-7 text-zinc-400">
              This runs one ingestion pass: fetch feeds, canonicalize and dedupe URLs, parse new headlines,
              save fresh drafts as `PENDING`, and write a full `claim_runs` trace.
            </p>
            <p className="max-w-2xl text-sm leading-7 text-zinc-500">
              Slow runs are normal here. The action waits for live RSS responses, duplicate checks, external AI
              parsing, and database writes before it redirects into the run trace.
            </p>
            <ManualFetchButton action={manualFetchLatestAction} />
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
          <div className="space-y-5">
            <p className="text-sm text-zinc-500">Current configuration</p>
            <div className="space-y-4 text-sm text-zinc-300">
              <div>
                <p className="text-zinc-500">RSS feeds</p>
                <ul className="mt-2 space-y-2">
                  {FEEDS.map((feed) => (
                    <li key={feed.source}>
                      <p>{feed.source}</p>
                      <p className="break-all text-zinc-500">{feed.url}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-zinc-500">Feed lookback</p>
                <p>Top {FEED_HEADLINE_LOOKBACK} headlines per source per run</p>
              </div>
              <div>
                <p className="text-zinc-500">Model</p>
                <p>{process.env.NVIDIA_MODEL ?? 'meta/llama3-70b-instruct'}</p>
              </div>
              <div>
                <p className="text-zinc-500">Chain</p>
                <p>{process.env.INTUITION_CHAIN ?? 'testnet'}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
