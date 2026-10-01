import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:4000';

/**
 * Same-origin proxy to the backend. Because the browser only ever talks to its own
 * host (abc.sncmt.com/api/...), cookies stay separate per school.
 */
async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const target = `${BACKEND}/${params.path.join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const name of ['content-type', 'cookie', 'authorization', 'user-agent']) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set('x-school-host', req.headers.get('host') ?? '');
  headers.set('x-forwarded-for', req.headers.get('x-forwarded-for') ?? '');

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'The server is not reachable. Is the backend running?' }, { status: 502 });
  }

  const out = new NextResponse(res.status === 204 ? null : await res.arrayBuffer(), { status: res.status });
  const type = res.headers.get('content-type');
  if (type) out.headers.set('content-type', type);
  for (const c of res.headers.getSetCookie()) out.headers.append('set-cookie', c);
  return out;
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
