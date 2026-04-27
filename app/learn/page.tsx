import { Reveal } from '../../components/public/reveal';

export const dynamic = 'force-dynamic';

const COURSE_MODULES = [
  'What Intuition is and why atoms matter',
  'How triples create machine-readable claims',
  'Why provenance makes a claim trustworthy',
  'How this product turns headlines into graph-native records',
] as const;

export default function LearnPage() {
  return (
    <div className="mx-auto w-full max-w-[92rem] px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <Reveal className="max-w-4xl space-y-6" delay={0.03}>
        <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Learning path</p>
        <h1 className="font-serif text-[3.4rem] leading-[0.92] tracking-[-0.05em] text-ink sm:text-[5rem]">
          Learn Intuition from first principles.
        </h1>
        <p className="max-w-2xl text-base leading-8 text-muted">
          This section will eventually walk new users through the protocol, atoms, triples, provenance,
          and how this product turns messy headlines into legible graph records.
        </p>
      </Reveal>

      <section className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_22rem]">
        <Reveal className="border border-line/80 bg-white/70 p-8 shadow-sheet" delay={0.08}>
          <div className="space-y-6">
            <div>
              <p className="text-sm text-muted">Course structure</p>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">
                Think structured onboarding, not protocol fog. More “clear Udemy path” and less “good luck,
                anon.”
              </p>
            </div>

            <div className="divide-y divide-line/70 border-y border-line/70">
              {COURSE_MODULES.map((module, index) => (
                <div key={module} className="grid gap-3 py-4 sm:grid-cols-[3rem_minmax(0,1fr)] sm:items-start">
                  <p className="text-sm text-muted">0{index + 1}</p>
                  <p className="text-sm leading-7 text-ink">{module}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-dashed border-line bg-paper/60 px-5 py-6">
              <p className="font-serif text-[1.7rem] leading-none tracking-[-0.03em] text-ink">
                Coming soon, with fewer existential crises per lesson.
              </p>
              <p className="mt-3 max-w-xl text-sm leading-7 text-muted">
                When this lands, it should teach someone what Intuition is, why semantic structure matters,
                and how to read this product without already living on-chain.
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal className="border border-line/80 bg-white/55 p-6 shadow-sheet" delay={0.14}>
          <div className="space-y-5">
            <div>
              <p className="text-sm text-muted">Status</p>
              <p className="mt-2 font-serif text-[2.4rem] leading-none tracking-[-0.05em] text-ink">
                Coming soon
              </p>
            </div>
            <div className="editorial-rule" />
            <div className="space-y-3 text-sm leading-7 text-muted">
              <p>This will become the public learning surface for the protocol and the product.</p>
              <p>The goal is simple: no jargon wall, no mystery meat navigation, no assumed prior context.</p>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
