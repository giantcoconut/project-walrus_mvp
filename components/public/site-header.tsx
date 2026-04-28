'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { PublicWalletButton } from '../shared/public-wallet-button';

const NAV_ITEMS = [
  { href: '/', label: 'Home', note: 'Overview' },
  { href: '/claims', label: 'Claims', note: 'Published graph' },
  { href: '/create', label: 'Create', note: 'Protocol entry' },
  { href: '/learn', label: 'Learn', note: 'Protocol basics' },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-line/80 bg-paper/70 backdrop-blur-[2px]">
      <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-5 px-5 py-5 sm:px-8 lg:flex-row lg:items-end lg:justify-between">
        <Link href="/" className="min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-[1.65rem] leading-none tracking-[-0.03em] text-ink">
              Aletheia
            </span>
            <span className="text-[0.68rem] uppercase tracking-terminal text-muted">
              Terminal
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">
            Structured claims, provenance, and semantic memory.
          </p>
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <nav className="flex flex-wrap items-center gap-2 sm:gap-3">
            {NAV_ITEMS.map((item) => {
              const isActive = item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg border px-3 py-2 transition-colors duration-150 ${
                    isActive
                      ? 'border-ink/15 bg-white/70 text-ink'
                      : 'border-transparent text-muted hover:border-line hover:bg-white/50 hover:text-ink'
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm">{item.label}</span>
                    <span className="hidden text-[0.72rem] text-muted sm:inline">{item.note}</span>
                  </div>
                </Link>
              );
            })}
          </nav>
          <PublicWalletButton />
        </div>
      </div>
    </header>
  );
}
