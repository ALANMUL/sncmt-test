import { BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const field = first.path.join('.');
    throw new BadRequestException(field ? `${field}: ${first.message}` : first.message);
  }
  return r.data;
}

/** 017XXXXXXXX -> +88017XXXXXXXX. Returns null when it is not a valid BD mobile. */
export function normalizeMobile(input: string): string | null {
  let v = input.replace(/[\s-]/g, '');
  if (v.startsWith('+')) v = v.slice(1);
  if (v.startsWith('01')) v = '88' + v;
  const out = '+' + v;
  return /^\+8801[0-9]{9}$/.test(out) ? out : null;
}

export const RESERVED_SUBDOMAINS = [
  'www', 'api', 'admin', 'app', 'mail', 'ftp', 'static', 'cdn', 'dashboard',
  'login', 'platform', 'sncmt', 'support', 'help', 'test',
];
