'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, Me } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SchoolRow {
  id: string; name: string; subdomain: string; email: string; logo_url: string | null;
  is_active: boolean; created_at: string; admin_name: string | null; admin_email: string | null;
}

export default function PlatformPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'active'>('pending');
  const [target, setTarget] = useState<SchoolRow | null>(null);
  const [typed, setTyped] = useState('');

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
  useEffect(() => {
    if (me.isError || (me.data && !me.data.isPlatformAdmin)) router.replace('/platform/login');
  }, [me.isError, me.data, router]);

  const ok = me.data?.isPlatformAdmin === true;
  const schools = useQuery({ queryKey: ['schools', tab], queryFn: () => api<SchoolRow[]>(`/platform/schools?status=${tab}`), enabled: ok });
  const approve = useMutation({
    mutationFn: (id: string) => api(`/platform/schools/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schools'] }),
  });
  const remove = useMutation({
    mutationFn: (s: SchoolRow) => api(`/platform/schools/${s.id}?confirm=${encodeURIComponent(s.subdomain)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setTarget(null);
      qc.invalidateQueries({ queryKey: ['schools'] });
    },
  });
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'sncmt.com';

  function openDelete(s: SchoolRow) {
    setTyped('');
    remove.reset();
    setTarget(s);
  }
  function closeDelete() {
    if (!remove.isPending) setTarget(null);
  }
  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    router.replace('/platform/login');
  }
  if (!ok) return <main className="p-8 text-sm text-ink/60">Loading…</main>;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-semibold">Schools</h1>
        <Button variant="outline" onClick={logout}>Log out</Button>
      </div>
      <div className="mt-6 flex gap-2" role="tablist">
        {(['pending', 'active'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-md px-4 py-2 text-sm font-medium ${tab === t ? 'bg-chalk text-white' : 'bg-white text-ink ring-1 ring-line'}`}>
            {t === 'pending' ? 'Waiting for approval' : 'Approved'}
          </button>
        ))}
      </div>

      {approve.isError && <p role="alert" className="mt-4 rounded-md bg-flag/10 px-3 py-2 text-sm text-flag">{(approve.error as Error).message}</p>}

      <div className="mt-6 divide-y divide-line rounded-lg bg-white ring-1 ring-line">
        {schools.isLoading && <p className="p-6 text-sm text-ink/60">Loading…</p>}
        {schools.data?.length === 0 && (
          <p className="p-6 text-sm text-ink/60">{tab === 'pending' ? 'No schools are waiting for approval.' : 'No approved schools yet.'}</p>
        )}
        {schools.data?.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-4 p-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {s.logo_url ? <img src={s.logo_url} alt="" className="h-12 w-12 rounded-md object-contain ring-1 ring-line" />
              : <span className="flex h-12 w-12 items-center justify-center rounded-md bg-paper text-sm font-semibold ring-1 ring-line">{s.name.slice(0, 2).toUpperCase()}</span>}
            <div className="min-w-[200px] flex-1">
              <p className="font-semibold">{s.name}</p>
              <p className="font-mono text-xs text-ink/60">{s.subdomain}.{root}</p>
              <p className="mt-1 text-sm text-ink/70">Admin: {s.admin_name ?? 'unknown'} ({s.admin_email ?? 'no email'})</p>
              <p className="text-xs text-ink/50">Registered {new Date(s.created_at).toLocaleDateString()}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {!s.is_active && (
                <Button onClick={() => approve.mutate(s.id)} disabled={approve.isPending}>Approve school</Button>
              )}
              <Button variant="danger" onClick={() => openDelete(s)}>Delete</Button>
            </div>
          </div>
        ))}
      </div>

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true"
          aria-labelledby="delete-title" onKeyDown={(e) => e.key === 'Escape' && closeDelete()}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 id="delete-title" className="font-display text-xl font-semibold text-flag">Delete this school?</h2>
            <p className="mt-3 text-sm leading-relaxed">
              You are about to permanently delete <b>{target.name}</b> (<span className="font-mono">{target.subdomain}.{root}</span>).
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink/80">
              <li>All its users, students, teachers, classes, exams and results are removed.</li>
              <li>Its web address stops working.</li>
              <li>This cannot be undone.</li>
            </ul>
            <p className="mt-3 text-sm text-ink/70">A school with fee or payment records cannot be deleted, because money history is kept permanently.</p>

            <label className="mt-5 block text-sm font-medium">
              Type <span className="font-mono">{target.subdomain}</span> to confirm
              <Input className="mt-1.5" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </label>

            {remove.isError && <p role="alert" className="mt-3 rounded-md bg-flag/10 px-3 py-2 text-sm text-flag">{(remove.error as Error).message}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={closeDelete} disabled={remove.isPending}>Cancel</Button>
              <Button className="bg-flag hover:bg-flag/90"
                disabled={typed.trim().toLowerCase() !== target.subdomain.toLowerCase() || remove.isPending}
                onClick={() => remove.mutate(target)}>
                {remove.isPending ? 'Deleting…' : 'Delete school'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}