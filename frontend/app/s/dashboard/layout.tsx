'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, LogOut, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api, Me } from '@/lib/api';
import { SchoolMark, useSchool } from '@/components/school-context';

const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/users', label: 'Users', icon: Users },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const school = useSchool();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });

  useEffect(() => {
    if (me.isError) router.replace('/login');
  }, [me.isError, router]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    router.replace('/login');
  }

  if (me.isLoading || me.isError) return <main className="p-8 text-sm text-ink/60">Loading…</main>;
  const isAdmin = me.data?.isPlatformAdmin || me.data?.roles.some((r) => r === 'SCHOOL_SUPER_ADMIN' || r === 'SCHOOL_ADMIN');

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="flex flex-col bg-chalk p-4 text-white md:min-h-screen">
        <div className="flex items-center gap-3 px-2 py-3">
          <SchoolMark school={school} light />
          <span className="font-display text-lg font-semibold leading-tight">{school?.name}</span>
        </div>
        <nav className="mt-4 flex gap-1 md:flex-col" aria-label="Main">
          {isAdmin && nav.map(({ href, label, icon: Icon }) => {
            const active = href === '/dashboard' ? path === href : path.startsWith(href);
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${active ? 'bg-white/15 font-medium' : 'text-white/75 hover:bg-white/10'}`}>
                <Icon size={18} /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden border-t border-white/15 px-2 pt-4 md:block">
          <p className="truncate text-sm font-medium">{me.data?.user.name}</p>
          <button onClick={logout} className="mt-2 flex items-center gap-2 text-sm text-white/70 hover:text-white">
            <LogOut size={16} /> Log out
          </button>
        </div>
      </aside>
      <div className="p-6 md:p-10">
        {isAdmin ? children : (
          <div className="max-w-md">
            <h1 className="font-display text-2xl font-semibold">Welcome, {me.data?.user.name}</h1>
            <p className="mt-2 text-ink/70">Your portal is not available yet. Please check back soon.</p>
            <button onClick={logout} className="mt-6 text-sm font-medium text-field underline underline-offset-4">Log out</button>
          </div>
        )}
      </div>
    </div>
  );
}
