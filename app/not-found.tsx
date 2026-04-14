import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-[92rem] items-center px-5 py-16 sm:px-8">
      <div className="max-w-2xl space-y-6">
        <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Not found</p>
        <h1 className="font-serif text-[3rem] leading-[0.96] tracking-[-0.04em] text-ink sm:text-[4.4rem]">
          That minted claim is not available in the public terminal.
        </h1>
        <p className="max-w-xl text-base leading-7 text-muted">
          Public pages only expose on-chain published records. Drafts, failed runs, and internal pipeline
          states stay in the admin surface.
        </p>
        <Link href="/claims" className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink">
          Browse minted claims
        </Link>
      </div>
    </div>
  );
}
