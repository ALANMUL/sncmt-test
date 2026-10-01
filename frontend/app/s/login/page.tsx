'use client';
import { LoginForm } from '@/components/login-form';
import { SchoolMark, useSchool } from '@/components/school-context';

export default function SchoolLogin() {
  const school = useSchool();
  return (
    <main className="grid min-h-screen md:grid-cols-[1fr_1.1fr]">
      <section className="relative hidden flex-col justify-end bg-chalk p-10 text-white md:flex"
        style={school?.banner_url ? { backgroundImage: `linear-gradient(rgba(15,42,34,.75),rgba(15,42,34,.9)), url(${school.banner_url})`, backgroundSize: 'cover' } : undefined}>
        <SchoolMark school={school} size={72} light />
        <h1 className="mt-6 font-display text-4xl font-semibold leading-tight">{school?.name ?? 'Your school'}</h1>
        <p className="mt-2 text-white/70">Log in to your school portal.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 md:hidden">
            <SchoolMark school={school} />
            <span className="font-display text-xl font-semibold">{school?.name}</span>
          </div>
          <h2 className="font-display text-2xl font-semibold">Log in</h2>
          <div className="mt-6"><LoginForm mode="school" /></div>
        </div>
      </section>
    </main>
  );
}
