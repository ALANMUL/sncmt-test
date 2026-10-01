import { NextRequest, NextResponse } from 'next/server';

const ROOT = (process.env.ROOT_DOMAIN ?? 'localhost').toLowerCase();

/**
 * Every request to <school>.ROOT_DOMAIN passes through here:
 *  1. find the subdomain
 *  2. ask the backend for that school
 *  3. unknown -> main site | not approved -> "Pending approval" | active -> school pages (/s/...)
 * The main site (ROOT_DOMAIN / www) is left alone.
 */
export async function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const sub = host.endsWith('.' + ROOT) ? host.slice(0, -(ROOT.length + 1)) : null;
  if (!sub || sub === 'www') return NextResponse.next();

  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  let school: { name: string; is_active: boolean } | null = null;
  try {
    const r = await fetch(`${backend}/schools/by-subdomain/${encodeURIComponent(sub)}`, { cache: 'no-store' });
    if (r.ok) school = await r.json();
  } catch {
    /* backend unreachable: treated like "not found" */
  }
  if (!school) return NextResponse.redirect(process.env.MAIN_URL ?? `http://${ROOT}`);

  const headers = new Headers(req.headers);
  headers.set('x-school-sub', sub);
  const url = req.nextUrl.clone();

  if (!school.is_active) {
    url.pathname = '/pending';
  } else if (!url.pathname.startsWith('/s/') && url.pathname !== '/s') {
    url.pathname = url.pathname === '/' ? '/s' : '/s' + url.pathname;
  }
  return NextResponse.rewrite(url, { request: { headers } });
}

// Skip Next.js internals, the API proxy and static files.
export const config = { matcher: ['/((?!_next/|api/|favicon.ico|.*\\..*).*)'] };
