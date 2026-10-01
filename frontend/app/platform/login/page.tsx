import { LoginForm } from '@/components/login-form';

export default function PlatformLogin() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-2xl font-semibold">Platform admin</h1>
      <p className="mb-6 mt-1 text-sm text-ink/70">Log in to review and approve schools.</p>
      <LoginForm mode="platform" />
    </main>
  );
}
