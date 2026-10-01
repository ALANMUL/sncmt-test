import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'sncmt.com';

const services = [
  ['Your own school address', 'Every school opens at its own web address with its own logo, so parents and teachers know they are in the right place.'],
  ['Students and guardians', 'One guardian account can follow several children, in one school or across schools.'],
  ['Teachers and staff', 'Add teachers, accountants and staff by mobile number. Give each person only what they need.'],
  ['Fees and accounting', 'One-time and monthly fees, a fund for each fee type, and payment history that is never deleted, only reversed.'],
  ['Exams and results', 'Set up exams by class, let each teacher enter marks for their own subjects, then publish results.'],
  ['Roles and permissions', 'Fine-grained access for every role, with a full audit trail of who changed what.'],
];

export default function Landing() {
  return (
    <main>
      <section className="bg-chalk text-white">
        <SiteHeader dark />
        <div className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-16 md:grid-cols-[1.15fr_1fr] md:items-center">
          <div>
            <h1 className="font-display text-4xl font-semibold leading-[1.1] md:text-6xl">
              Every school gets its own website, fees and results.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/75">
              SNCMT helps schools and colleges in Bangladesh manage students, teachers, fees and exams, without
              installing anything.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/register" className="rounded-md bg-white px-6 py-3 font-medium text-chalk hover:bg-white/90">
                Create school account
              </Link>
              <span className="text-sm text-white/60">Free to register. We review every school before it goes live.</span>
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.06] p-5 ring-1 ring-white/15">
            <div className="flex items-center gap-2 rounded-md bg-white px-4 py-3 text-ink shadow-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-field" />
              <span className="font-mono text-sm sm:text-base">
                <b>greenfield</b>.{root}
              </span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-white/70">
              This is what a school&apos;s address looks like. Parents and teachers log in here, under your school&apos;s
              name and logo.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-3xl font-semibold">What your school gets</h2>
        <dl className="mt-10 grid gap-x-12 md:grid-cols-2">
          {services.map(([title, text]) => (
            <div key={title} className="border-t border-line py-6">
              <dt className="font-semibold">{title}</dt>
              <dd className="mt-1.5 max-w-md leading-relaxed text-ink/70">{text}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10">
          <Link href="/register" className="rounded-md bg-field px-6 py-3 font-medium text-white hover:bg-fieldDark">
            Create school account
          </Link>
        </div>
      </section>

      <footer className="border-t border-line py-8 text-center text-sm text-ink/60">
        © {new Date().getFullYear()} SNCMT. School & College Management Technology.
      </footer>
    </main>
  );
}
