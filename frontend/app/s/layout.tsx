import { headers } from 'next/headers';
import { SchoolProvider, School } from '@/components/school-context';

export const dynamic = 'force-dynamic';

async function loadSchool(): Promise<School | null> {
  const sub = headers().get('x-school-sub'); // set by middleware.ts
  if (!sub) return null;
  try {
    const r = await fetch(`${process.env.BACKEND_URL ?? 'http://localhost:4000'}/schools/by-subdomain/${encodeURIComponent(sub)}`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as School) : null;
  } catch {
    return null;
  }
}

export default async function SchoolLayout({ children }: { children: React.ReactNode }) {
  const school = await loadSchool();
  return <SchoolProvider school={school}>{children}</SchoolProvider>;
}
