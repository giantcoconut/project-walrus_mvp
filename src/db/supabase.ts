import 'dotenv/config';

import {
  createClient,
  type PostgrestSingleResponse,
  type SupabaseClient,
} from '@supabase/supabase-js';

import type { ClaimDraftRow } from '../types/schema';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable.');
}

if (!supabaseServiceKey) {
  throw new Error('Missing SUPABASE_SERVICE_KEY environment variable.');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

export async function saveDraft(
  draft: Omit<ClaimDraftRow, 'id' | 'created_at'>,
): Promise<PostgrestSingleResponse<ClaimDraftRow>> {
  return supabase.from('claim_drafts').insert(draft).select().single();
}
