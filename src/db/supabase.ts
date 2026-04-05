import 'dotenv/config';

import {
  createClient,
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

export interface SaveDraftResult {
  data: ClaimDraftRow | null;
  skippedDuplicate: boolean;
}

export async function saveDraft(
  draft: Omit<ClaimDraftRow, 'id' | 'created_at'>,
): Promise<SaveDraftResult> {
  try {
    const result = await supabase.from('claim_drafts').insert(draft).select().single();

    if (result.error) {
      if (result.error.code === '23505') {
        console.log(`[DATABASE] Duplicate draft skipped for URL: ${draft.url}`);

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
      console.log(`[DATABASE] Duplicate draft skipped for URL: ${draft.url}`);

      return {
        data: null,
        skippedDuplicate: true,
      };
    }

    throw error;
  }
}
