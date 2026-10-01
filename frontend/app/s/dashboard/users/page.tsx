'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '@/lib/api';
import { ROLE_LABELS, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { ImageUpload } from '@/components/logo-upload';

interface UserRow {
  id: string; name: string; mobile: string | null; email: string | null;
  profile_picture_url: string | null; is_active: boolean; roles: string[];
}
const CREATABLE = ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN', 'ACCOUNTANT', 'STAFF'] as const;

const schema = z.object({
  name: z.string().trim().min(2, 'Enter a name'),
  role: z.enum(CREATABLE),
  mobile: z.string().trim().min(1, 'Enter a mobile number'),
  password: z.string().min(6, 'Use at least 6 characters'),
  profilePictureUrl: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export default function UsersPage() {
  const qc = useQueryClient();
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');

  const users = useQuery({
    queryKey: ['users', role, search],
    queryFn: () => api<UserRow[]>(`/users?${new URLSearchParams({ ...(role && { role }), ...(search && { q: search }) })}`),
  });

  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'TEACHER', profilePictureUrl: '' },
  });

  async function onCreate(values: Values) {
    setFormError('');
    try {
      await api('/users', { method: 'POST', json: values });
      reset({ role: values.role, profilePictureUrl: '', name: '', mobile: '', password: '' });
      setAdding(false);
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['users-summary'] });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not add the user');
    }
  }

  const toggle = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}`, { method: 'PATCH', json: { isActive: !u.is_active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold">Users</h1>
        <Button onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Add user'}</Button>
      </div>

      {adding && (
        <form onSubmit={handleSubmit(onCreate)} noValidate className="mt-6 grid gap-5 rounded-lg bg-white p-6 ring-1 ring-line sm:grid-cols-2">
          <Field label="Full name" error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Role" error={errors.role?.message}>
            <Select {...register('role')}>{CREATABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
          </Field>
          <Field label="Mobile number" error={errors.mobile?.message} hint="Like 017XXXXXXXX. They use it to log in. If this person already has an account, the role is added to it.">
            <Input inputMode="tel" {...register('mobile')} />
          </Field>
          <Field label="Password" error={errors.password?.message} hint="Ignored if the person already has an account.">
            <Input type="password" autoComplete="new-password" {...register('password')} />
          </Field>
          <div className="sm:col-span-2">
            <Controller control={control} name="profilePictureUrl" render={({ field }) => (
              <ImageUpload label="Profile picture (optional)" value={field.value} onChange={field.onChange} round />
            )} />
          </div>
          {formError && <p role="alert" className="rounded-md bg-flag/10 px-3 py-2 text-sm text-flag sm:col-span-2">{formError}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Adding…' : 'Add user'}</Button>
          </div>
        </form>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder="Search by name, mobile or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
        <Select className="w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
          <option value="">All roles</option>
          {['SCHOOL_SUPER_ADMIN', ...CREATABLE].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </Select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg bg-white ring-1 ring-line">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-line text-ink/60">
            <tr><th className="p-4 font-medium">Name</th><th className="p-4 font-medium">Login</th><th className="p-4 font-medium">Roles</th><th className="p-4 font-medium">Status</th><th className="p-4" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {u.profile_picture_url ? <img src={u.profile_picture_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                      : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-paper text-xs font-semibold ring-1 ring-line">{u.name.slice(0, 1).toUpperCase()}</span>}
                    <span className="font-medium">{u.name}</span>
                  </div>
                </td>
                <td className="p-4 text-ink/70">{u.email ?? u.mobile}</td>
                <td className="p-4">{u.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</td>
                <td className="p-4"><span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', u.is_active ? 'bg-field/10 text-field' : 'bg-flag/10 text-flag')}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                <td className="p-4 text-right">
                  <Button variant={u.is_active ? 'danger' : 'outline'} className="px-3 py-1.5" onClick={() => toggle.mutate(u)} disabled={toggle.isPending}>
                    {u.is_active ? 'Disable' : 'Enable'}
                  </Button>
                </td>
              </tr>
            ))}
            {users.data?.length === 0 && <tr><td colSpan={5} className="p-6 text-ink/60">No users match. Use Add user to create the first one.</td></tr>}
            {users.isLoading && <tr><td colSpan={5} className="p-6 text-ink/60">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      {toggle.isError && <p role="alert" className="mt-3 text-sm text-flag">{(toggle.error as Error).message}</p>}
    </div>
  );
}
