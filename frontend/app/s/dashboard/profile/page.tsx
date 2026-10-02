'use client';
import { useQuery } from '@tanstack/react-query';
import { api, Me } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/utils';

export default function ProfilePage() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
  const u = me.data?.user;
  const roles = [...(me.data?.roles ?? []), ...(me.data?.isPlatformAdmin ? ['PLATFORM_ADMIN'] : [])];

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-3xl font-semibold">My profile</h1>
      {u && (
        <div className="mt-8 rounded-lg bg-white p-6 ring-1 ring-line">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {u.profile_picture_url ? <img src={u.profile_picture_url} alt="" className="h-16 w-16 rounded-full object-cover" />
              : <span className="flex h-16 w-16 items-center justify-center rounded-full bg-paper text-xl font-semibold ring-1 ring-line">{u.name.slice(0, 1).toUpperCase()}</span>}
            <div>
              <p className="text-lg font-semibold">{u.name}</p>
              <p className="text-sm text-ink/60">{me.data?.school?.name}</p>
            </div>
          </div>
          <dl className="mt-6 divide-y divide-line text-sm">
            <div className="flex justify-between py-3"><dt className="text-ink/60">Email</dt><dd>{u.email ?? 'None'}</dd></div>
            <div className="flex justify-between py-3"><dt className="text-ink/60">Mobile</dt><dd>{u.mobile ?? 'None'}</dd></div>
            <div className="flex justify-between py-3"><dt className="text-ink/60">Roles</dt><dd>{roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}