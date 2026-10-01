'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/logo-upload';

const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'sncmt.com';

const schema = z.object({
  schoolName: z.string().trim().min(2, 'Enter the school name'),
  subdomain: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, 'Use 3-30 letters, numbers or hyphens'),
  schoolEmail: z.string().trim().email('Enter a valid school email'),
  adminName: z.string().trim().min(2, 'Enter the admin name'),
  adminEmail: z.string().trim().email('Enter a valid admin email'),
  password: z.string().min(8, 'Use at least 8 characters'),
  logoUrl: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const { register, control, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { logoUrl: '' },
  });
  const sub = watch('subdomain');

  async function onSubmit(values: Values) {
    setError('');
    try {
      await api('/schools/register', { method: 'POST', json: values });
      router.push('/pending');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the account');
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-display text-xl font-semibold">SNCMT</Link>
      <h1 className="mt-8 font-display text-3xl font-semibold">Create your school account</h1>
      <p className="mt-2 text-ink/70">We review every school before it goes live. You will log in with the admin email below.</p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
        <Field label="School name" error={errors.schoolName?.message}>
          <Input {...register('schoolName')} />
        </Field>
        <Field label="School web address" error={errors.subdomain?.message}
          hint={`Your school will open at ${sub || 'abc'}.${root}`}>
          <div className="flex items-center gap-2">
            <Input {...register('subdomain')} placeholder="abc" />
            <span className="whitespace-nowrap text-sm text-ink/60">.{root}</span>
          </div>
        </Field>
        <Field label="School email" error={errors.schoolEmail?.message} hint="The school's own contact email. It must be different from the admin email.">
          <Input type="email" {...register('schoolEmail')} />
        </Field>
        <Controller control={control} name="logoUrl" render={({ field }) => (
          <ImageUpload label="School logo (optional)" value={field.value} onChange={field.onChange} />
        )} />
        <hr className="border-line" />
        <Field label="Admin name" error={errors.adminName?.message}>
          <Input {...register('adminName')} />
        </Field>
        <Field label="Admin email" error={errors.adminEmail?.message} hint="You will log in with this email.">
          <Input type="email" autoComplete="email" {...register('adminEmail')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        {error && <p role="alert" className="rounded-md bg-flag/10 px-3 py-2 text-sm text-flag">{error}</p>}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create school account'}
        </Button>
      </form>
    </main>
  );
}
