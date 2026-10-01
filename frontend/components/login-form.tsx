'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, Me } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

const schema = z.object({
  identifier: z.string().min(3, 'Enter your email or mobile number'),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof schema>;

export function LoginForm({ mode }: { mode: 'school' | 'platform' }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setError('');
    try {
      await api<Me>('/auth/login', { method: 'POST', json: values });
      router.push(mode === 'platform' ? '/platform' : '/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log in');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field label={mode === 'platform' ? 'Email' : 'Email or mobile number'} error={formState.errors.identifier?.message}
        hint={mode === 'school' ? 'School admins use email. Teachers, students and guardians use their mobile, like 017XXXXXXXX.' : undefined}>
        <Input autoComplete="username" {...register('identifier')} />
      </Field>
      <Field label="Password" error={formState.errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...register('password')} />
      </Field>
      {error && <p role="alert" className="rounded-md bg-flag/10 px-3 py-2 text-sm text-flag">{error}</p>}
      <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
