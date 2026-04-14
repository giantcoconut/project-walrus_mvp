import 'dotenv/config';

import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

import type {
  ClaimDraftRow,
  ClaimRunRow,
  ClaimRunStatus,
  ClaimRunStep,
  ClaimRunStepRow,
  ClaimRunTrigger,
  DraftStatus,
} from '../types/schema';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable.');
}

if (!supabaseServiceKey) {
  throw new Error('Missing SUPABASE_SERVICE_KEY environment variable.');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

export interface SaveDraftResult {
  data: ClaimDraftRow | null;
  skippedDuplicate: boolean;
}

export interface NewClaimDraftInput {
  source: ClaimDraftRow['source'];
  url: ClaimDraftRow['url'];
  headline: ClaimDraftRow['headline'];
  payload_json: ClaimDraftRow['payload_json'];
  status: ClaimDraftRow['status'];
  tx_hash?: ClaimDraftRow['tx_hash'];
  approved_at?: ClaimDraftRow['approved_at'];
  last_error?: ClaimDraftRow['last_error'];
}

export interface DraftUpdateInput {
  status?: DraftStatus;
  approved_at?: string | null;
  tx_hash?: string | null;
  last_error?: string | null;
}

export interface NewClaimRunInput {
  draft_id?: ClaimRunRow['draft_id'];
  status?: ClaimRunStatus;
  started_at?: ClaimRunRow['started_at'];
  finished_at?: ClaimRunRow['finished_at'];
  trigger?: ClaimRunRow['trigger'];
  initiated_by?: ClaimRunRow['initiated_by'];
}

export interface ClaimRunUpdateInput {
  draft_id?: ClaimRunRow['draft_id'];
  status?: ClaimRunStatus;
  started_at?: ClaimRunRow['started_at'];
  finished_at?: ClaimRunRow['finished_at'];
  trigger?: ClaimRunTrigger | null;
  initiated_by?: ClaimRunRow['initiated_by'];
}

export interface NewClaimRunStepInput {
  run_id: ClaimRunStepRow['run_id'];
  step: ClaimRunStep;
  status: ClaimRunStatus;
  detail_json?: ClaimRunStepRow['detail_json'];
  error_message?: ClaimRunStepRow['error_message'];
}

export interface ClaimRunTrace {
  run: ClaimRunRow;
  steps: ClaimRunStepRow[];
}

export async function saveDraft(
  draft: NewClaimDraftInput,
): Promise<SaveDraftResult> {
  const record = {
    ...draft,
    approved_at: draft.approved_at ?? null,
    tx_hash: draft.tx_hash ?? null,
    last_error: draft.last_error ?? null,
  };

  try {
    const result = await supabase.from('claim_drafts').insert(record).select().single();

    if (result.error) {
      if (result.error.code === '23505') {
        console.log(`[DATABASE] Duplicate draft skipped for URL: ${record.url}`);

        return {
          data: null,
          skippedDuplicate: true,
        };
      }

      throw result.error;
    }

    return {
      data: result.data,
      skippedDuplicate: false,
    };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505'
    ) {
      console.log(`[DATABASE] Duplicate draft skipped for URL: ${record.url}`);

      return {
        data: null,
        skippedDuplicate: true,
      };
    }

    throw error;
  }
}

export async function getDraftById(draftId: string): Promise<ClaimDraftRow | null> {
  const result = await supabase
    .from('claim_drafts')
    .select('*')
    .eq('id', draftId)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimDraftRow | null) ?? null;
}

export async function getDraftsByIds(draftIds: string[]): Promise<ClaimDraftRow[]> {
  if (draftIds.length === 0) {
    return [];
  }

  const uniqueIds = Array.from(new Set(draftIds));
  const result = await supabase
    .from('claim_drafts')
    .select('*')
    .in('id', uniqueIds);

  if (result.error) {
    throw result.error;
  }

  const drafts = (result.data as ClaimDraftRow[] | null) ?? [];
  const ordered = new Map(drafts.map((draft) => [draft.id, draft]));

  return uniqueIds
    .map((draftId) => ordered.get(draftId))
    .filter((draft): draft is ClaimDraftRow => Boolean(draft));
}

export async function fetchPendingDrafts(limit = 25): Promise<ClaimDraftRow[]> {
  const result = await supabase
    .from('claim_drafts')
    .select('*')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimDraftRow[] | null) ?? [];
}

export async function fetchRecentDrafts(limit = 50): Promise<ClaimDraftRow[]> {
  const result = await supabase
    .from('claim_drafts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimDraftRow[] | null) ?? [];
}

export async function fetchDraftsByStatus(
  statuses: DraftStatus[],
  limit = 50,
): Promise<ClaimDraftRow[]> {
  if (statuses.length === 0) {
    return [];
  }

  const result = await supabase
    .from('claim_drafts')
    .select('*')
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimDraftRow[] | null) ?? [];
}

export async function fetchMintedClaims(
  limit = 50,
  source?: ClaimDraftRow['source'],
): Promise<ClaimDraftRow[]> {
  let query = supabase
    .from('claim_drafts')
    .select('*')
    .eq('status', 'MINTED')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (source) {
    query = query.eq('source', source);
  }

  const result = await query;

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimDraftRow[] | null) ?? [];
}

export async function getMintedClaimById(claimId: string): Promise<ClaimDraftRow | null> {
  const result = await supabase
    .from('claim_drafts')
    .select('*')
    .eq('id', claimId)
    .eq('status', 'MINTED')
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimDraftRow | null) ?? null;
}

export async function countDrafts(status?: DraftStatus): Promise<number> {
  let query = supabase
    .from('claim_drafts')
    .select('*', {
      count: 'exact',
      head: true,
    });

  if (status) {
    query = query.eq('status', status);
  }

  const result = await query;

  if (result.error) {
    throw result.error;
  }

  return result.count ?? 0;
}

export async function updateDraft(
  draftId: string,
  patch: DraftUpdateInput,
): Promise<ClaimDraftRow | null> {
  const result = await supabase
    .from('claim_drafts')
    .update(patch)
    .eq('id', draftId)
    .select('*')
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimDraftRow | null) ?? null;
}

export async function createClaimRun(
  input: NewClaimRunInput = {},
): Promise<ClaimRunRow> {
  const record = {
    draft_id: input.draft_id ?? null,
    status: input.status ?? 'RUNNING',
    started_at: input.started_at ?? new Date().toISOString(),
    finished_at: input.finished_at ?? null,
    trigger: input.trigger ?? null,
    initiated_by: input.initiated_by ?? null,
  };

  const result = await supabase
    .from('claim_runs')
    .insert(record)
    .select('*')
    .single();

  if (result.error) {
    throw result.error;
  }

  return result.data as ClaimRunRow;
}

export async function updateClaimRun(
  runId: string,
  patch: ClaimRunUpdateInput,
): Promise<ClaimRunRow | null> {
  const result = await supabase
    .from('claim_runs')
    .update(patch)
    .eq('id', runId)
    .select('*')
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimRunRow | null) ?? null;
}

export async function finishClaimRun(
  runId: string,
  status: Exclude<ClaimRunStatus, 'RUNNING'>,
): Promise<ClaimRunRow | null> {
  return updateClaimRun(runId, {
    status,
    finished_at: new Date().toISOString(),
  });
}

export async function createClaimRunStep(
  input: NewClaimRunStepInput,
): Promise<ClaimRunStepRow> {
  const record = {
    run_id: input.run_id,
    step: input.step,
    status: input.status,
    detail_json: input.detail_json ?? null,
    error_message: input.error_message ?? null,
  };

  const result = await supabase
    .from('claim_run_steps')
    .insert(record)
    .select('*')
    .single();

  if (result.error) {
    throw result.error;
  }

  return result.data as ClaimRunStepRow;
}

export async function getClaimRunById(runId: string): Promise<ClaimRunRow | null> {
  const result = await supabase
    .from('claim_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimRunRow | null) ?? null;
}

export async function fetchClaimRuns(limit = 50): Promise<ClaimRunRow[]> {
  const result = await supabase
    .from('claim_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimRunRow[] | null) ?? [];
}

export async function fetchClaimRunSteps(runId: string): Promise<ClaimRunStepRow[]> {
  const result = await supabase
    .from('claim_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });

  if (result.error) {
    throw result.error;
  }

  return (result.data as ClaimRunStepRow[] | null) ?? [];
}

export async function getClaimRunTrace(runId: string): Promise<ClaimRunTrace | null> {
  const run = await getClaimRunById(runId);

  if (!run) {
    return null;
  }

  const steps = await fetchClaimRunSteps(runId);

  return {
    run,
    steps,
  };
}
