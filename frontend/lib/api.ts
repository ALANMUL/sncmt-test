export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

interface ApiInit extends Omit<RequestInit, 'body'> {
  json?: unknown;
  body?: BodyInit | null;
}

/** All calls go to /api/... on the SAME host; the Next.js proxy forwards them to the backend. */
export async function api<T>(path: string, init: ApiInit = {}, canRetry = true): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch('/api' + path, { ...init, headers, body, credentials: 'same-origin' });

  if (res.status === 401 && canRetry && !path.startsWith('/auth/')) {
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
    if (r.ok) return api<T>(path, init, false);
  }
  if (!res.ok) {
    let msg = 'Something went wrong. Please try again.';
    try {
      const j = await res.json();
      msg = Array.isArray(j.message) ? j.message.join(', ') : j.message ?? msg;
    } catch {
      /* keep default */
    }
    throw new ApiError(msg, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await api<{ url: string }>('/uploads/image', { method: 'POST', body: fd });
  return r.url;
}

export interface Me {
  user: { id: string; name: string; email: string | null; mobile: string | null; profile_picture_url: string | null };
  isPlatformAdmin: boolean;
  roles: string[];
  school: { id: string; name: string; logo_url: string | null } | null;
}
