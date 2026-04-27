import { notFound } from 'next/navigation';

import { AdminShell } from '../../../../components/admin/admin-shell';
import { StatusPill } from '../../../../components/admin/status-pill';
import { getDraftById } from '../../../../src/db/supabase';
import { requireAdminAuth } from '../../../../src/site/admin-auth';
import { inspectDraftTerms, type DraftGraphTriplePreview } from '../../../../src/site/admin-data';
import { approveDraftAction, rejectDraftAction, retryDraftAction } from '../../actions';

export const dynamic = 'force-dynamic';

function formatEntityResolutionState(status: 'FOUND' | 'CANDIDATES' | 'MISSING'): string {
  if (status === 'FOUND') {
    return 'Found on graph';
  }

  if (status === 'CANDIDATES') {
    return 'Possible related atoms found';
  }

  return 'Missing on graph';
}

function MonoValue({
  value,
  multiline = false,
}: {
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-black/20 px-3 py-2">
      <code
        className={`block text-[0.78rem] text-zinc-300 ${
          multiline ? 'whitespace-pre-wrap break-all leading-6' : 'whitespace-nowrap leading-5'
        }`}
      >
        {value}
      </code>
    </div>
  );
}

function TermCard({
  title,
  kind,
  canonicalValue,
  termIdLabel,
  termId,
}: {
  title: string;
  kind: string;
  canonicalValue: string;
  termIdLabel: string;
  termId: string;
}) {
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-7 text-zinc-100">{title}</p>
        <p className="rounded-md border border-zinc-800 px-2 py-1 text-[0.72rem] text-zinc-500">{kind}</p>
      </div>
      <div className="space-y-2">
        <p className="text-xs text-zinc-500">Canonical value</p>
        <MonoValue value={canonicalValue} multiline />
      </div>
      <div className="space-y-2">
        <p className="text-xs text-zinc-500">{termIdLabel}</p>
        <MonoValue value={termId} multiline />
      </div>
    </div>
  );
}

function GraphTripleCard({ triple }: { triple: DraftGraphTriplePreview }) {
  const predicateLabel = triple.predicateSuggestion ?? triple.predicate;

  return (
    <div className="rounded-xl border border-zinc-800 bg-black/20 p-5">
      <div className="space-y-4">
        <div>
          <p className="text-[0.72rem] uppercase tracking-terminal text-zinc-500">{triple.title}</p>
          <p className="mt-3 text-sm leading-8 text-zinc-100">
            [{triple.subject}] [{predicateLabel}] [{triple.object}]
          </p>
          {triple.predicateSuggestion ? (
            <p className="mt-2 text-xs text-zinc-500">
              Canonical predicate: <span className="text-zinc-300">{triple.predicate}</span>
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="mb-2 text-xs text-zinc-500">Subject ID</p>
            <MonoValue value={triple.subjectTermId} multiline />
          </div>
          <div>
            <p className="mb-2 text-xs text-zinc-500">Predicate ID</p>
            <MonoValue value={triple.predicateTermId} multiline />
          </div>
          <div>
            <p className="mb-2 text-xs text-zinc-500">Object ID</p>
            <MonoValue value={triple.objectTermId} multiline />
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-4">
          <p className="mb-2 text-xs text-zinc-500">Triple ID</p>
          <MonoValue value={triple.tripleId} multiline />
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
      <div className="grid gap-6 xl:grid-cols-[26rem_minmax(0,1fr)]">
        <section className="space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
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
                  <div className="mt-2">
                    <MonoValue value={draft.url} multiline />
                  </div>
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

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">Atom suggestion summary</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-sm text-zinc-500">Found on graph</p>
                  <p className="mt-2 font-serif text-[2rem] leading-none tracking-[-0.04em] text-zinc-50">
                    {preview.atomsFound.length}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-sm text-zinc-500">Would need creation</p>
                  <p className="mt-2 font-serif text-[2rem] leading-none tracking-[-0.04em] text-zinc-50">
                    {preview.atomsMissing.length}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70">
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="text-sm text-zinc-500">Atoms found on graph</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {preview.atomsFound.length > 0 ? (
                preview.atomsFound.map((row) => (
                  <TermCard
                    key={`${row.kind}:${row.original}`}
                    title={row.original}
                    kind={row.kind}
                    canonicalValue={row.canonical}
                    termIdLabel="Resolved term ID"
                    termId={row.liveTermId ?? 'Missing'}
                  />
                ))
              ) : (
                <div className="px-5 py-6 text-sm text-zinc-500">No live atoms matched for this draft.</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70">
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="text-sm text-zinc-500">Atoms to create</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {preview.atomsMissing.length > 0 ? (
                preview.atomsMissing.map((row) => (
                  <div key={`${row.kind}:${row.original}`} className="space-y-3 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm leading-7 text-zinc-100">{row.original}</p>
                      <p className="rounded-md border border-zinc-800 px-2 py-1 text-[0.72rem] text-zinc-500">
                        {row.kind}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500">Canonical value</p>
                      <MonoValue value={row.canonical} multiline />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500">Local term ID</p>
                      <MonoValue value={row.localId} multiline />
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-5 py-6 text-sm text-zinc-500">No plain-text atoms need creation for this draft.</div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">Semantic claim stack</p>
              {preview.primaryClaim ? (
                <GraphTripleCard triple={preview.primaryClaim} />
              ) : (
                <div className="rounded-xl border border-zinc-800 bg-black/20 p-5 text-sm text-zinc-500">
                  No primary claim could be derived from this draft.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">Secondary claims</p>
              {preview.secondaryClaims.length > 0 ? (
                <div className="space-y-4">
                  {preview.secondaryClaims.map((triple) => (
                    <GraphTripleCard key={triple.tripleId} triple={triple} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-800 bg-black/20 p-5 text-sm text-zinc-500">
                  No secondary claims were produced for this draft.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">Tertiary provenance bundle</p>
              <div className="space-y-4">
                {preview.tertiaryClaims.map((triple) => (
                  <GraphTripleCard key={triple.tripleId} triple={triple} />
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70">
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="text-sm text-zinc-500">Rich entity resolution</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {Array.from(inspection.entityResolutions.entries()).map(([name, resolution]) => (
                <div key={name} className="space-y-4 px-5 py-4">
                  <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)_16rem]">
                    <p className="text-sm text-zinc-100">{name}</p>
                    <p className="text-sm leading-7 text-zinc-400">{resolution.metadata.description}</p>
                    <div className="space-y-2 text-sm">
                      <p className="text-zinc-200">{formatEntityResolutionState(resolution.status)}</p>
                      <MonoValue
                        value={
                          resolution.status === 'FOUND'
                            ? resolution.termId
                            : resolution.metadata.url ?? 'MISSING'
                        }
                        multiline
                      />
                    </div>
                  </div>
                  {resolution.status === 'CANDIDATES' ? (
                    <div className="rounded-xl border border-zinc-800 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-terminal text-zinc-500">
                        Possible existing atoms
                      </p>
                      <div className="mt-4 space-y-4">
                        {resolution.candidates.map((candidate) => (
                          <div
                            key={candidate.termId}
                            className="grid gap-4 rounded-lg border border-zinc-800 p-4 lg:grid-cols-[4.5rem_minmax(0,1fr)_14rem]"
                          >
                            <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                              {candidate.image ? (
                                <img
                                  src={candidate.image}
                                  alt={candidate.label}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="text-[0.65rem] uppercase tracking-terminal text-zinc-600">
                                  No image
                                </span>
                              )}
                            </div>
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm text-zinc-100">{candidate.label}</p>
                                <span className="rounded-md border border-zinc-800 px-2 py-1 text-[0.68rem] text-zinc-500">
                                  {candidate.type}
                                </span>
                                <span className="rounded-md border border-zinc-800 px-2 py-1 text-[0.68rem] text-zinc-500">
                                  match score {candidate.score}
                                </span>
                              </div>
                              <p className="text-sm leading-7 text-zinc-400">
                                {candidate.description ?? 'No description on the graph.'}
                              </p>
                            </div>
                            <div className="space-y-2 text-xs text-zinc-500">
                              <p>Heuristic candidate only. Review before reusing.</p>
                              <MonoValue value={candidate.termId} multiline />
                              <MonoValue value={candidate.matchedUrl ?? 'No URL'} multiline />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70">
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="text-sm text-zinc-500">Raw payload JSON</p>
            </div>
            <pre className="max-h-[36rem] overflow-auto p-5 text-xs leading-6 text-zinc-300">
              {JSON.stringify(draft.payload_json, null, 2)}
            </pre>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
