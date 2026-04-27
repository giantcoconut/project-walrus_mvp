import Link from 'next/link';

import { CreateWorkbench } from '../../components/public/create-workbench';
import { Reveal } from '../../components/public/reveal';

export const dynamic = 'force-dynamic';

export default function CreatePage() {
  return (
    <div className="mx-auto w-full max-w-[92rem] px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <Reveal className="max-w-4xl space-y-5" delay={0.03}>
        <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Create</p>
        <h1 className="max-w-5xl font-serif text-[3.3rem] leading-[0.9] tracking-[-0.055em] text-ink sm:text-[5rem]">
          Create atoms. Publish claims. Build lists.
        </h1>
        <p className="max-w-3xl text-base leading-8 text-muted sm:text-lg">
          Connect your wallet, create what is missing, and move between atoms, claims, and lists without
          dealing with raw IDs or protocol clutter.
        </p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/claims"
            className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper"
          >
            Inspect live claims
          </Link>
          <Link
            href="/learn"
            className="inline-flex rounded-full border border-line bg-white/65 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink"
          >
            Study the protocol basics
          </Link>
        </div>
      </Reveal>

      <section className="mt-10">
        <Reveal delay={0.12}>
          <CreateWorkbench />
        </Reveal>
      </section>
    </div>
  );
}
