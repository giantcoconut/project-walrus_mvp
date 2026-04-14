import { notFound } from 'next/navigation';

import { AdminShell } from '../../../../components/admin/admin-shell';
import { StatusPill } from '../../../../components/admin/status-pill';
import { getDraftById } from '../../../../src/db/supabase';
import { requireAdminAuth } from '../../../../src/site/admin-auth';
import { inspectDraftTerms, type DraftGraphTriplePreview } from '../../../../src/site/admin-data';
import { approveDraftAction, rejectDraftAction, retryDraftAction } from '../../actions';

export const dynamic = 'force-dynamic';

function formatEntityResolutionState(status: 'FOUND' | 'MISSING'): string {
  return status === 'FOUND' ? 'Found on graph' : 'Missing on graph';
}

function GraphTripleCard({ triple }: { triple: DraftGraphTriplePreview }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-black/20 p-5">
      <div className="space-y-3">
        <div>
          <p className="text-[0.72rem] uppercase tracking-terminal text-zinc-500">{triple.title}</p>
          <p className="mt-2 text-sm leading-7 text-zinc-100">
            [{triple.subject}] [{triple.predicate}] [{triple.object}]
          </p>
        </div>

        <div className="grid gap-3 text-xs text-zinc-500 md:grid-cols-3">
          <div>
            <p className="text-zinc-600">Subject ID</p>
            <p className="mt-1 break-all">{triple.subjectTermId}</p>
          </div>
          <div>
            <p className="text-zinc-600">Predicate ID</p>
            <p className="mt-1 break-all">{triple.predicateTermId}</p>
          </div>
          <div>
            <p className="text-zinc-600">Object ID</p>
            <p className="mt-1 break-all">{triple.objectTermId}</p>
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-3 text-xs text-zinc-500">
          <p className="text-zinc-600">Triple ID</p>
          <p className="mt-1 break-all">{triple.tripleId}</p>
        </div>
      </div>
    </div>
  );
}

export default async function AdminDraftDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdminAuth();
  const draft = await getDraftById(params.id);

  if (!draft) {
    notFound();
  }

  const inspection = await inspectDraftTerms(draft);
  const preview = inspection.graphPreview;

  return (
    <AdminShell
      title="Draft inspector"
      kicker="Draft detail"
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {draft.status === 'PENDING' ? (
            <>
              <form action={approveDraftAction}>
                <input type="hidden" name="draftId" value={draft.id} />
                <input type="hidden" name="redirectTo" value={`/admin/drafts/${draft.id}`} />
                <button className="rounded-full border border-emerald-400/30 px-4 py-2 text-sm text-emerald-200 transition-colors duration-150 hover:bg-emerald-400/10">
                  Approve
                </button>
              </form>
              <form action={rejectDraftAction}>
                <input type="hidden" name="draftId" value={draft.id} />
                <input type="hidden" name="redirectTo" value={`/admin/drafts/${draft.id}`} />
                <button className="rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-200 transition-colors duration-150 hover:bg-rose-400/10">
                  Reject
                </button>
              </form>
            </>
          ) : null}
          {draft.status === 'ERROR' ? (
            <form action={retryDraftAction}>
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="redirectTo" value={`/admin/drafts/${draft.id}`} />
              <input type="hidden" name="approvedAt" value={draft.approved_at ?? ''} />
              <button className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors duration-150 hover:border-zinc-500 hover:text-zinc-50">
                Return to queue
              </button>
            </form>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[23rem_minmax(0,1fr)]">
        <section className="space-y-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-zinc-500">Draft metadata</p>
                <StatusPill value={draft.status} />
              </div>
              <div className="space-y-4 text-sm text-zinc-300">
                <div>
                  <p className="text-zinc-500">Source</p>
                  <p>{draft.source}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Headline</p>
                  <p className="text-zinc-100">{draft.headline}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Canonical URL</p>
                  <a href={draft.url} target="_blank" rel="noreferrer" className="break-all text-zinc-100">
                    {draft.url}
                  </a>
                </div>
                <div>
                  <p className="text-zinc-500">Entity metadata entries</p>
                  <p>{Object.keys(draft.payload_json.entityMetadata).length}</p>
                </div>
                {draft.last_error ? (
                  <div>
                    <p className="text-zinc-500">Last error</p>
                    <p className="text-rose-300">{draft.last_error}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">Atom suggestion summary</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-sm text-zinc-500">Found on graph</p>
                  <p className="mt-2 font-serif text-[2rem] leading-none tracking-[-0.04em] text-zinc-50">
                    {preview.atomsFound.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-sm text-zinc-500">Would need creation</p>
                  <p className="mt-2 font-serif text-[2rem] leading-none tracking-[-0.04em] text-zinc-50">
                    {preview.atomsMissing.length}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="text-sm text-zinc-500">Atoms found on graph</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {preview.atomsFound.length > 0 ? (
                preview.atomsFound.map((row) => (
                  <div key={`${row.kind}:${row.original}`} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_10rem_14rem]">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">{row.original}</p>
                      <p className="break-all text-sm text-zinc-500">{row.canonical}</p>
                    </div>
                    <p className="text-sm text-zinc-400">{row.kind}</p>
                    <p className="break-all text-xs text-zinc-300">{row.liveTermId}</p>
                  </div>
                ))
              ) : (
                <div className="px-5 py-6 text-sm text-zinc-500">No live atoms matched for this draft.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="text-sm text-zinc-500">Atoms to create</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {preview.atomsMissing.length > 0 ? (
                preview.atomsMissing.map((row) => (
                  <div key={`${row.kind}:${row.original}`} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_10rem_14rem]">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">{row.original}</p>
                      <p className="break-all text-sm text-zinc-500">{row.canonical}</p>
                    </div>
                    <p className="text-sm text-zinc-400">{row.kind}</p>
                    <p className="break-all text-xs text-zinc-300">{row.localId}</p>
                  </div>
                ))
              ) : (
                <div className="px-5 py-6 text-sm text-zinc-500">No plain-text atoms need creation for this draft.</div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">Semantic claim stack</p>
              {preview.primaryClaim ? (
                <GraphTripleCard triple={preview.primaryClaim} />
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-black/20 p-5 text-sm text-zinc-500">
                  No primary claim could be derived from this draft.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">Secondary claims</p>
              {preview.secondaryClaims.length > 0 ? (
                <div className="space-y-4">
                  {preview.secondaryClaims.map((triple) => (
                    <GraphTripleCard key={triple.tripleId} triple={triple} />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-black/20 p-5 text-sm text-zinc-500">
                  No secondary claims were produced for this draft.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">Tertiary provenance bundle</p>
              <div className="space-y-4">
                {preview.tertiaryClaims.map((triple) => (
                  <GraphTripleCard key={triple.tripleId} triple={triple} />
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="text-sm text-zinc-500">Rich entity resolution</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {Array.from(inspection.entityResolutions.entries()).map(([name, resolution]) => (
                <div key={name} className="grid gap-3 px-5 py-4 md:grid-cols-[12rem_minmax(0,1fr)_14rem]">
                  <p className="text-sm text-zinc-100">{name}</p>
                  <p className="text-sm text-zinc-400">{resolution.metadata.description}</p>
                  <div className="space-y-1 text-sm">
                    <p className="text-zinc-200">{formatEntityResolutionState(resolution.status)}</p>
                    <p className="break-all text-xs text-zinc-500">
                      {resolution.status === 'FOUND' ? resolution.termId : resolution.metadata.url ?? 'MISSING'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="text-sm text-zinc-500">Raw payload JSON</p>
            </div>
            <pre className="overflow-x-auto p-5 text-xs leading-6 text-zinc-300">
              {JSON.stringify(draft.payload_json, null, 2)}
            </pre>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
