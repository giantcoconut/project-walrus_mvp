import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-line/80">
      <div className="mx-auto flex w-full max-w-[92rem] items-center justify-between gap-6 px-5 py-5 sm:px-8">
        <Link href="/" className="min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-[1.65rem] leading-none tracking-[-0.03em] text-ink">
              Aletheia
            </span>
            <span className="text-[0.68rem] uppercase tracking-terminal text-muted">
              Terminal
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-5 text-sm text-muted">
          <Link className="transition-colors duration-150 hover:text-ink" href="/claims">
            Minted claims
          </Link>
          <span className="hidden text-line sm:inline">/</span>
          <span className="hidden sm:inline">Provable publisher assertions</span>
        </nav>
      </div>
    </header>
  );
}
