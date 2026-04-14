'use client';

import { usePathname } from 'next/navigation';

import { SiteHeader } from '../public/site-header';

export function RootChrome() {
  const pathname = usePathname();

  if (pathname.startsWith('/admin')) {
    return null;
  }

  return <SiteHeader />;
}
