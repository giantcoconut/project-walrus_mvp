import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/controls', label: 'Controls' },
  { href: '/admin/inbox', label: 'Inbox' },
  { href: '/admin/runs', label: 'Runs' },
  { href: '/admin/minted', label: 'Minted' },
  { href: '/admin/errors', label: 'Errors' },
] as const;

export function AdminShell({
  title,
  kicker,
  children,
  actions,
}: {
  title: string;
  kicker: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(7,7,8,0.98),rgba(13,13,15,1))] text-zinc-100">
      <div className="mx-auto grid min-h-screen max-w-[96rem] gap-0 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="border-b border-zinc-800 px-5 py-6 lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
          <div className="space-y-8">
            <div className="space-y-2">
              <Link href="/" className="inline-flex items-baseline gap-3">
                <span className="font-serif text-[1.55rem] tracking-[-0.03em] text-zinc-50">Aletheia</span>
                <span className="text-[0.68rem] uppercase tracking-terminal text-zinc-500">Ops</span>
              </Link>
              <p className="max-w-[13rem] text-sm leading-6 text-zinc-500">
                Surgical internal surface for ingestion, review, and claim execution.
              </p>
            </div>

            <nav className="space-y-1.5">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors duration-150 hover:bg-zinc-900 hover:text-zinc-50"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="border-b border-zinc-800 px-5 py-6 sm:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <p className="text-[0.72rem] uppercase tracking-terminal text-zinc-500">{kicker}</p>
                <h1 className="font-serif text-[2.5rem] leading-none tracking-[-0.04em] text-zinc-50 sm:text-[3.15rem]">
                  {title}
                </h1>
              </div>
              {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
            </div>
          </header>

          <div className="px-5 py-8 sm:px-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
