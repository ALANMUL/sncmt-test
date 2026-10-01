import Link from 'next/link';

export function SiteHeader({ dark }: { dark?: boolean }) {
  return (
    <header className={`mx-auto flex max-w-6xl items-center justify-between px-6 py-5 ${dark ? 'text-white' : 'text-ink'}`}>
      <Link href="/" className="font-display text-xl font-semibold tracking-tight">SNCMT</Link>
      <nav className="flex items-center gap-5 text-sm">
        <Link href="/platform/login" className="opacity-80 hover:opacity-100">Platform admin</Link>
        <Link href="/register" className="rounded-md bg-white px-4 py-2 font-medium text-chalk hover:bg-white/90">
          Create school account
        </Link>
      </nav>
    </header>
  );
}
