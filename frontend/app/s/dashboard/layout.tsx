'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, LogOut, Menu, Search, UserCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, Me } from '@/lib/api';
import { flatten, isActivePath, isGroup, navFor, type NavLeaf } from '@/components/nav-config';
import { SchoolMark, useSchool } from '@/components/school-context';
import { ROLE_LABELS, cn } from '@/lib/utils';

interface Hit { id: string; name: string; mobile: string | null; email: string | null; roles: string[] }

function SearchBox() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const hits = useQuery({
    queryKey: ['search', term],
    queryFn: () => api<Hit[]>(`/users?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
  });

  return (
    <div className="relative w-full max-w-md">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search people"
        aria-label="Search people"
        className="w-full rounded-md bg-paper py-2 pl-9 pr-3 text-sm placeholder:text-ink/40"
      />
      {open && term.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-line">
          {hits.isLoading && <p className="p-3 text-sm text-ink/60">Searching…</p>}
          {hits.data?.length === 0 && <p className="p-3 text-sm text-ink/60">No one found.</p>}
          {hits.data?.slice(0, 6).map((h) => (
            <button key={h.id} onMouseDown={() => router.push('/dashboard/users')}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-paper">
              <span className="font-medium">{h.name}</span>
              <span className="truncate text-xs text-ink/60">
                {h.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')} · {h.email ?? h.mobile}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NavLink({ leaf, path }: { leaf: NavLeaf; path: string }) {
  const Icon = leaf.icon;
  const active = isActivePath(leaf.href, path);
  return (
    <Link href={leaf.href}
      className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm',
        active ? 'bg-field/10 font-medium text-field' : 'text-ink/75 hover:bg-paper')}>
      <Icon size={18} /> {leaf.label}
    </Link>
  );
}

const ROLE_ORDER = ['PLATFORM_ADMIN', 'SCHOOL_SUPER_ADMIN', 'SCHOOL_ADMIN', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'GUARDIAN', 'STUDENT'];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const school = useSchool();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [groups, setGroups] = useState<Record<string, boolean>>({});

  const myRoles = me.data ? [...me.data.roles, ...(me.data.isPlatformAdmin ? ['PLATFORM_ADMIN'] : [])] : [];
  const entries = navFor(myRoles);
  const flat = flatten(entries);
  const canSeeThisPage = flat.some((i) => isActivePath(i.href, path));
  const firstPage = flat[0]?.href;
  const canSearch = flat.some((i) => i.href === '/dashboard/users');
  const topRole = ROLE_ORDER.find((r) => myRoles.includes(r));

  useEffect(() => {
    if (window.innerWidth < 768) setCollapsed(true);
  }, []);
  useEffect(() => {
    if (me.isError) router.replace('/login');
  }, [me.isError, router]);
  useEffect(() => {
    if (me.data && !canSeeThisPage && firstPage) router.replace(firstPage);
  }, [me.data, canSeeThisPage, firstPage, router]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    router.replace('/login');
  }

  if (me.isLoading || me.isError) return <main className="p-8 text-sm text-ink/60">Loading…</main>;
  const u = me.data?.user;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white px-4">
        <div className="flex shrink-0 items-center gap-3 md:w-[216px]">
          <SchoolMark school={school} size={36} />
          <span className="hidden truncate font-display text-lg font-semibold sm:inline">{school?.name}</span>
        </div>
        <button aria-label="Show or hide menu" onClick={() => setCollapsed((v) => !v)} className="rounded-md p-2 hover:bg-paper">
          <Menu size={20} />
        </button>
        {canSearch && <div className="hidden min-w-0 flex-1 sm:block"><SearchBox /></div>}

        <div className="relative ml-auto">
          <button onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}
            className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-paper">
            <span className="hidden text-right sm:block">
              <span className="block text-sm font-medium leading-tight">{u?.name}</span>
              <span className="block text-xs text-ink/60">{topRole ? ROLE_LABELS[topRole] : ''}</span>
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {u?.profile_picture_url ? <img src={u.profile_picture_url} alt="" className="h-9 w-9 rounded-full object-cover" />
              : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-field text-sm font-semibold text-white">{u?.name.slice(0, 1).toUpperCase()}</span>}
            <ChevronDown size={16} />
          </button>
          {menu && (
            <>
              <button aria-label="Close menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-48 rounded-md bg-white py-1 shadow-lg ring-1 ring-line">
                <Link href="/dashboard/profile" role="menuitem" onClick={() => setMenu(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper"><UserCircle size={16} /> My profile</Link>
                <button role="menuitem" onClick={logout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-flag hover:bg-paper"><LogOut size={16} /> Log out</button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        {!collapsed && (
          <aside className="w-60 shrink-0 border-r border-line bg-white p-3">
            <nav aria-label="Main" className="space-y-1">
              {entries.map((entry) => {
                if (!isGroup(entry)) return <NavLink key={entry.href} leaf={entry} path={path} />;
                const Icon = entry.icon;
                const hasActive = entry.children.some((c) => isActivePath(c.href, path));
                const open = groups[entry.label] ?? hasActive;
                return (
                  <div key={entry.label}>
                    <button onClick={() => setGroups((g) => ({ ...g, [entry.label]: !open }))} aria-expanded={open}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-ink/75 hover:bg-paper">
                      <Icon size={18} />
                      <span className="flex-1 text-left">{entry.label}</span>
                      <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
                    </button>
                    {open && (
                      <div className="ml-5 mt-1 space-y-1 border-l border-line pl-3">
                        {entry.children.map((c) => <NavLink key={c.href} leaf={c} path={path} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </aside>
        )}
        <main className="min-w-0 flex-1 p-6 md:p-8">{canSeeThisPage ? children : null}</main>
      </div>
    </div>
  );
}