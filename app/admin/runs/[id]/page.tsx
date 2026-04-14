import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminShell } from '../../../../components/admin/admin-shell';
import { StatusPill } from '../../../../components/admin/status-pill';
import { TraceTimeline } from '../../../../components/admin/trace-timeline';
import { getClaimRunTrace, getDraftsByIds } from '../../../../src/db/supabase';
import { requireAdminAuth } from '../../../../src/site/admin-auth';
import { inspectDraftBatch, type DraftInspectionResult, type DraftGraphTriplePreview } from '../../../../src/site/admin-data';

export const dynamic = 'force-dynamic';

interface RunHeadlineItem {
  source: string;
  headline: string;
  canonicalUrl: string;
}

interface RunSkippedItem extends RunHeadlineItem {
  reason: 'local' | 'db';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseHeadlineItems(value: unknown): RunHeadlineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const candidate = asRecord(entry);

      if (!candidate) {
        return null;
      }

      const source = asString(candidate.source);
      const headline = asString(candidate.headline);
      const canonicalUrl = asString(candidate.canonicalUrl);

      if (!source || !headline || !canonicalUrl) {
        return null;
      }

      return {
        source,
        headline,
        canonicalUrl,
      } satisfies RunHeadlineItem;
    })
    .filter((item): item is RunHeadlineItem => item !== null);
}

function parseSkippedItems(value: unknown): RunSkippedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const candidate = asRecord(entry);

      if (!candidate) {
        return null;
      }

      const source = asString(candidate.source);
      const headline = asString(candidate.headline);
      const canonicalUrl = asString(candidate.canonicalUrl);
      const reason = asString(candidate.reason);

      if (!source || !headline || !canonicalUrl || (reason !== 'local' && reason !== 'db')) {
        return null;
      }

      return {
        source,
        headline,
        canonicalUrl,
        reason,
      } satisfies RunSkippedItem;
    })
    .filter((item): item is RunSkippedItem => item !== null);
}

function getNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function formatReason(reason: 'local' | 'db'): string {
  return reason === 'db' ? 'Already in database' : 'Duplicate within run';
}

function deriveFetchedItems(
  fetchedItems: RunHeadlineItem[],
  freshItems: RunHeadlineItem[],
  skippedItems: RunSkippedItem[],
): RunHeadlineItem[] {
  if (fetchedItems.length > 0) {
    return fetchedItems;
  }

  const merged = new Map<string, RunHeadlineItem>();

  for (const item of [...freshItems, ...skippedItems]) {
    merged.set(`${item.source}:${item.canonicalUrl}`, item);
  }

  return Array.from(merged.values());
}

function parseCreatedDraftIds(traceSteps: Array<{ detail_json: Record<string, unknown> | null }>): string[] {
  const ids = traceSteps
    .map((step) => asString(asRecord(step.detail_json)?.draftId))
    .filter((draftId): draftId is string => typeof draftId === 'string' && draftId.length > 0);

  return Array.from(new Set(ids));
}

function MiniTriple({ triple }: { triple: DraftGraphTriplePreview | null }) {
  if (!triple) {
    return <p className="text-sm text-zinc-500">No primary claim preview available.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">Primary claim</p>
      <p className="text-sm leading-7 text-zinc-100">
        [{triple.subject}] [{triple.predicate}] [{triple.object}]
      </p>
      <p className="break-all text-xs text-zinc-500">{triple.tripleId}</p>
    </div>
  );
}

function DraftPreviewCard({
  draft,
  inspection,
}: {
  draft: Awaited<ReturnType<typeof getDraftsByIds>>[number];
  inspection: DraftInspectionResult | undefined;
}) {
  const preview = inspection?.graphPreview;

  return (
    <Link
      href={`/admin/drafts/${draft.id}`}
      className="block rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 transition-colors duration-150 hover:border-zinc-700 hover:bg-zinc-950"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-zinc-500">{draft.source}</p>
          <p className="text-sm leading-7 text-zinc-100">{draft.headline}</p>
        </div>
        <StatusPill value={draft.status} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <MiniTriple triple={preview?.primaryClaim ?? null} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-3">
            <p className="text-xs text-zinc-500">Found atoms</p>
            <p className="mt-2 text-lg text-zinc-100">{preview?.atomsFound.length ?? 0}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-3">
            <p className="text-xs text-zinc-500">Atoms to create</p>
            <p className="mt-2 text-lg text-zinc-100">{preview?.atomsMissing.length ?? 0}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-3">
            <p className="text-xs text-zinc-500">Secondary claims</p>
            <p className="mt-2 text-lg text-zinc-100">{preview?.secondaryClaims.length ?? 0}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-3">
            <p className="text-xs text-zinc-500">Rich entities</p>
            <p className="mt-2 text-lg text-zinc-100">{draft.payload_json.entityMetadata ? Object.keys(draft.payload_json.entityMetadata).length : 0}</p>
          </div>
        </div>
      </div>

      {preview && preview.atomsMissing.length > 0 ? (
        <div className="mt-5 border-t border-zinc-800 pt-4">
          <p className="text-xs text-zinc-500">Suggested new atoms</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {preview.atomsMissing.slice(0, 6).map((row) => (
              <span
                key={`${draft.id}:${row.kind}:${row.original}`}
                className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300"
              >
                {row.original}
              </span>
            ))}
            {preview.atomsMissing.length > 6 ? (
              <span className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-500">
                +{preview.atomsMissing.length - 6} more
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </Link>
  );
}

export default async function AdminRunDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdminAuth();
  const trace = await getClaimRunTrace(params.id);

  if (!trace) {
    notFound();
  }

  const rssFetchStep = trace.steps.find((step) => step.step === 'RSS_FETCH');
  const canonicalizeStep = trace.steps.find((step) => step.step === 'CANONICALIZE');
  const parseSteps = trace.steps.filter((step) => step.step === 'PARSE');
  const dbUpdateSteps = trace.steps.filter((step) => step.step === 'DB_UPDATE');

  const rssFetchDetail = asRecord(rssFetchStep?.detail_json);
  const canonicalizeDetail = asRecord(canonicalizeStep?.detail_json);
  const fetchedFeeds = Array.isArray(rssFetchDetail?.feeds) ? rssFetchDetail.feeds : [];
  const fetchedItemsFromTrace = fetchedFeeds.flatMap((feed) => parseHeadlineItems(asRecord(feed)?.items));
  const freshItems = parseHeadlineItems(canonicalizeDetail?.freshItems);
  const skippedItems = parseSkippedItems(canonicalizeDetail?.skippedItems);
  const fetchedItems = deriveFetchedItems(fetchedItemsFromTrace, freshItems, skippedItems);
  const createdDraftIds = parseCreatedDraftIds(dbUpdateSteps);
  const createdDrafts = await getDraftsByIds(createdDraftIds);
  const draftInspections = await inspectDraftBatch(createdDrafts);

  return (
    <AdminShell title="Run detail" kicker="Trace viewer">
      <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-zinc-500">Run header</p>
              <StatusPill value={trace.run.status} />
            </div>
            <div className="space-y-4 text-sm text-zinc-300">
              <div>
                <p className="text-zinc-500">Run ID</p>
                <p className="break-all">{trace.run.id}</p>
              </div>
              <div>
                <p className="text-zinc-500">Trigger</p>
                <p>{trace.run.trigger ?? 'SYSTEM'}</p>
              </div>
              <div>
                <p className="text-zinc-500">Initiated by</p>
                <p>{trace.run.initiated_by ?? 'Unknown'}</p>
              </div>
              <div>
                <p className="text-zinc-500">Started</p>
                <p>{new Date(trace.run.started_at).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-zinc-500">Finished</p>
                <p>{trace.run.finished_at ? new Date(trace.run.finished_at).toLocaleString() : 'Still running'}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Fetched', value: getNumber(rssFetchDetail?.fetchedCount) || fetchedItems.length },
            { label: 'New', value: getNumber(canonicalizeDetail?.freshCount) || freshItems.length },
            { label: 'Skipped', value: getNumber(canonicalizeDetail?.duplicateCount) || skippedItems.length },
            { label: 'Drafts created', value: createdDrafts.length },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-5">
              <p className="text-sm text-zinc-500">{item.label}</p>
              <p className="mt-3 text-[2rem] leading-none text-zinc-50">{item.value}</p>
            </div>
          ))}
        </section>
      </div>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/70">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-5 py-4">
          <div>
            <p className="text-sm text-zinc-500">Created drafts</p>
            <p className="mt-1 text-sm text-zinc-300">
              This is the semantic output of the run: primary claim preview, atom summary, and likely new graph terms.
            </p>
          </div>
          <p className="text-sm text-zinc-500">{createdDrafts.length} drafts</p>
        </div>
        <div className="grid gap-4 p-5">
          {createdDrafts.length > 0 ? (
            createdDrafts.map((draft) => (
              <DraftPreviewCard
                key={draft.id}
                draft={draft}
                inspection={draftInspections.get(draft.id)}
              />
            ))
          ) : (
            <div className="px-1 py-4 text-sm text-zinc-500">This run did not create any new drafts.</div>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
          <div className="border-b border-zinc-800 px-5 py-4">
            <p className="text-sm text-zinc-500">Fetched headlines</p>
          </div>
          <div className="divide-y divide-zinc-800">
            {fetchedItems.length > 0 ? (
              fetchedItems.map((item) => (
                <div key={`${item.source}:${item.canonicalUrl}`} className="px-5 py-4">
                  <p className="text-sm text-zinc-500">{item.source}</p>
                  <p className="mt-1 text-sm leading-7 text-zinc-100">{item.headline}</p>
                  <p className="mt-1 break-all text-xs text-zinc-500">{item.canonicalUrl}</p>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-zinc-500">
                No fetched headline detail recorded for this run. Older traces may only contain counts.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
          <div className="border-b border-zinc-800 px-5 py-4">
            <p className="text-sm text-zinc-500">Fresh headlines to parse</p>
          </div>
          <div className="divide-y divide-zinc-800">
            {freshItems.length > 0 ? (
              freshItems.map((item) => (
                <div key={`${item.source}:${item.canonicalUrl}`} className="px-5 py-4">
                  <p className="text-sm text-zinc-500">{item.source}</p>
                  <p className="mt-1 text-sm leading-7 text-zinc-100">{item.headline}</p>
                  <p className="mt-1 break-all text-xs text-zinc-500">{item.canonicalUrl}</p>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-zinc-500">
                No fresh headlines in this run. All fetched items were already staged.
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
          <div className="border-b border-zinc-800 px-5 py-4">
            <p className="text-sm text-zinc-500">Skipped headlines</p>
          </div>
          <div className="divide-y divide-zinc-800">
            {skippedItems.length > 0 ? (
              skippedItems.map((item) => (
                <div key={`${item.reason}:${item.source}:${item.canonicalUrl}`} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-zinc-500">{item.source}</p>
                    <p className="text-xs text-zinc-500">{formatReason(item.reason)}</p>
                  </div>
                  <p className="mt-1 text-sm leading-7 text-zinc-100">{item.headline}</p>
                  <p className="mt-1 break-all text-xs text-zinc-500">{item.canonicalUrl}</p>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-zinc-500">No skipped items recorded for this run.</div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
          <div className="mb-4">
            <p className="text-sm text-zinc-500">Pipeline step outcome</p>
            <p className="mt-1 text-sm text-zinc-300">
              Parsed headlines: {parseSteps.filter((step) => step.status === 'SUCCESS').length} success,{' '}
              {parseSteps.filter((step) => step.status === 'ERROR').length} error
            </p>
          </div>
          <TraceTimeline steps={trace.steps} />
        </section>
      </div>
    </AdminShell>
  );
}
