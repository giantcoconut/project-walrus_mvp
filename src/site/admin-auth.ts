import { createHash, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const ADMIN_COOKIE_NAME = 'aletheia_admin_session';
const DEFAULT_SESSION_SALT = 'aletheia-terminal-admin';

function getConfiguredPassword(): string {
  return process.env.ADMIN_PASSWORD?.trim() ?? '';
}

function getSessionSalt(): string {
  return process.env.ADMIN_SESSION_SALT?.trim() || DEFAULT_SESSION_SALT;
}

function createSessionValue(password: string): string {
  return createHash('sha256')
    .update(`${password}:${getSessionSalt()}`)
    .digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminConfigured(): boolean {
  return getConfiguredPassword().length > 0;
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const password = getConfiguredPassword();

  if (!password) {
    return false;
  }

  const cookieStore = cookies();
  const session = cookieStore.get(ADMIN_COOKIE_NAME)?.value;

  if (!session) {
    return false;
  }

  return safeEqual(session, createSessionValue(password));
}

export async function requireAdminAuth(): Promise<void> {
  if (!(await isAdminAuthenticated())) {
    redirect('/admin');
  }
}

export async function verifyAdminPassword(candidate: string): Promise<boolean> {
  const password = getConfiguredPassword();

  if (!password) {
    return false;
  }

  return safeEqual(candidate.trim(), password);
}

export async function createAdminSession(): Promise<void> {
  const password = getConfiguredPassword();

  if (!password) {
    throw new Error('ADMIN_PASSWORD is not configured.');
  }

  cookies().set(ADMIN_COOKIE_NAME, createSessionValue(password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
}

export async function clearAdminSession(): Promise<void> {
  cookies().delete(ADMIN_COOKIE_NAME);
}
