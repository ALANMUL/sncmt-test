'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, Me } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { ROLE_LABELS, cn } from '@/lib/utils';

interface UserRow {
  id: string; name: string; mobile: string | null; email: string | null;
  profile_picture_url: string | null; is_active: boolean; roles: string[];
}

const CARDS = [
  { label: 'Students', roles: ['STUDENT'], color: 'bg-[#fbc4e8]' },
  { label: 'Teachers', roles: ['TEACHER'], color: 'bg-[#ffd878]' },
  { label: 'Guardians', roles: ['GUARDIAN'], color: 'bg-[#c8dbff]' },
  { label: 'Staff and admins', roles: ['SCHOOL_SUPER_ADMIN', 'SCHOOL_ADMIN', 'ACCOUNTANT', 'STAFF'], color: 'bg-[#c4ead5]' },
];

export default function Overview() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
  const summary = useQuery({ queryKey: ['users-summary'], queryFn: () => api<{ role: string; total: number }[]>('/users/summary') });
  const recent = useQuery({ queryKey: ['users', '', ''], queryFn: () => api<UserRow[]>('/users') });

  const count = (roles: string[]) =>
    summary.data ? summary.data.filter((s) => roles.includes(s.role)).reduce((n, s) => n + s.total, 0) : null;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`Welcome, ${me.data?.user.name ?? ''}`}
        crumbs={['Home', 'Dashboard']}
        action={<Link href="/dashboard/users" className="rounded-full bg-field px-5 py-2.5 text-sm font-medium text-white hover:bg-fieldDark">Add user</Link>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {CARDS.map((c) => (
          <div key={c.label} className={cn('rounded-2xl p-5', c.color)}>
            <p className="text-sm font-medium text-ink/80">{c.label}</p>
            <p className="mt-3 font-display text-4xl font-semibold">{count(c.roles) ?? '–'}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
        <section className="rounded-xl bg-white ring-1 ring-line">
          <div className="flex items-center justify-between border-b border-line p-5">
            <h2 className="font-semibold">Recently added</h2>
            <Link href="/dashboard/users" className="text-sm font-medium text-field hover:underline">See all</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <tbody className="divide-y divide-line">
                {recent.data?.slice(0, 6).map((u) => (
                  <tr key={u.id}>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {u.profile_picture_url ? <img src={u.profile_picture_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                          : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-paper text-xs font-semibold ring-1 ring-line">{u.name.slice(0, 1).toUpperCase()}</span>}
                        <div>
                          <p className="font-medium">{u.name}</p>
                          <p className="text-xs text-ink/60">{u.email ?? u.mobile}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4"><span className="rounded-full bg-[#c8dbff]/60 px-2.5 py-0.5 text-xs font-medium">{u.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</span></td>
                    <td className="p-4"><span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', u.is_active ? 'bg-field/10 text-field' : 'bg-flag/10 text-flag')}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                  </tr>
                ))}
                {recent.data?.length === 0 && <tr><td className="p-6 text-ink/60">No users yet.</td></tr>}
                {recent.isLoading && <tr><td className="p-6 text-ink/60">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-3">
          <Link href="/dashboard/users" className="block rounded-xl bg-[#fbc4e8] p-4 text-sm font-medium hover:brightness-95">Add or manage users</Link>
          <Link href="/dashboard/profile" className="block rounded-xl bg-white p-4 text-sm font-medium ring-1 ring-line hover:bg-paper">My profile</Link>
        </aside>
      </div>
    </div>
  );
}