import 'dotenv/config';

import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

import type { ClaimDraftRow, DraftStatus } from '../types/schema';

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
