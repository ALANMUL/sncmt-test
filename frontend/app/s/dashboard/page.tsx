'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, Me } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/utils';

export default function Overview() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
  const summary = useQuery({ queryKey: ['users-summary'], queryFn: () => api<{ role: string; total: number }[]>('/users/summary') });

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Welcome, {me.data?.user.name}</h1>
      <p className="mt-2 text-ink/70">Here is who is in your school.</p>

      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line sm:grid-cols-3">
        {summary.data?.map((s) => (
          <div key={s.role} className="bg-white p-5">
            <dt className="text-sm text-ink/60">{ROLE_LABELS[s.role] ?? s.role}</dt>
            <dd className="mt-1 font-display text-3xl font-semibold">{s.total}</dd>
          </div>
        ))}
      </dl>
      {summary.data?.length === 0 && <p className="mt-6 text-sm text-ink/60">No users yet.</p>}

      <Link href="/dashboard/users" className="mt-8 inline-block rounded-md bg-field px-5 py-2.5 text-sm font-medium text-white hover:bg-fieldDark">
        Manage users
      </Link>
    </div>
  );
}
