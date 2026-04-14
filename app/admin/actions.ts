'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { updateDraft } from '../../src/db/supabase';
import {
  createAdminSession,
  clearAdminSession,
  requireAdminAuth,
  verifyAdminPassword,
} from '../../src/site/admin-auth';
import { runManualFetchIngestion } from '../../src/services/manual-fetch';

function getSafeRedirectTarget(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string' || !value.startsWith('/admin')) {
    return '/admin';
  }

  return value;
}

export async function loginAction(formData: FormData): Promise<void> {
  const password = typeof formData.get('password') === 'string' ? String(formData.get('password')) : '';
  const next = getSafeRedirectTarget(formData.get('next'));

  if (!(await verifyAdminPassword(password))) {
    redirect('/admin?error=invalid');
  }

  await createAdminSession();
  redirect(next === '/admin' ? '/admin/controls' : next);
}

export async function logoutAction(): Promise<void> {
  await clearAdminSession();
  redirect('/admin');
}

export async function manualFetchLatestAction(): Promise<void> {
  await requireAdminAuth();
  const summary = await runManualFetchIngestion('admin-ui');

  revalidatePath('/admin');
  revalidatePath('/admin/controls');
  revalidatePath('/admin/inbox');
  revalidatePath('/admin/runs');

  redirect(`/admin/runs/${summary.runId}`);
}

export async function approveDraftAction(formData: FormData): Promise<void> {
  await requireAdminAuth();
  const draftId = String(formData.get('draftId') ?? '');
  const redirectTo = getSafeRedirectTarget(formData.get('redirectTo'));

  if (!draftId) {
    throw new Error('Missing draft id.');
  }

  await updateDraft(draftId, {
    status: 'APPROVED',
    approved_at: new Date().toISOString(),
    last_error: null,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/inbox');
  revalidatePath('/admin/errors');
  revalidatePath(`/admin/drafts/${draftId}`);

  redirect(redirectTo || '/admin/inbox');
}

export async function rejectDraftAction(formData: FormData): Promise<void> {
  await requireAdminAuth();
  const draftId = String(formData.get('draftId') ?? '');
  const redirectTo = getSafeRedirectTarget(formData.get('redirectTo'));

  if (!draftId) {
    throw new Error('Missing draft id.');
  }

  await updateDraft(draftId, {
    status: 'REJECTED',
    last_error: null,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/inbox');
  revalidatePath(`/admin/drafts/${draftId}`);

  redirect(redirectTo || '/admin/inbox');
}

export async function retryDraftAction(formData: FormData): Promise<void> {
  await requireAdminAuth();
  const draftId = String(formData.get('draftId') ?? '');
  const redirectTo = getSafeRedirectTarget(formData.get('redirectTo'));
  const approvedAt = typeof formData.get('approvedAt') === 'string' ? String(formData.get('approvedAt')) : '';

  if (!draftId) {
    throw new Error('Missing draft id.');
  }

  await updateDraft(draftId, {
    status: approvedAt ? 'APPROVED' : 'PENDING',
    last_error: null,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/errors');
  revalidatePath('/admin/inbox');
  revalidatePath(`/admin/drafts/${draftId}`);

  redirect(redirectTo || '/admin/errors');
}
