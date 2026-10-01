import Link from 'next/link';

export default function PendingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <h1 className="font-display text-3xl font-semibold">Pending approval</h1>
      <p className="mt-4 leading-relaxed text-ink/75">
        Thank you. The school account has been created and is waiting for review. Once it is approved, the school
        website opens and the admin can log in with the email and password chosen during registration.
      </p>
      <Link href="/" className="mt-8 text-sm font-medium text-field underline underline-offset-4">Back to the main site</Link>
    </main>
  );
}
