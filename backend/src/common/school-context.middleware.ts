import { Injectable, NestMiddleware } from '@nestjs/common';
import { DbService } from './db.service';

export interface SchoolInfo {
  id: string;
  name: string;
  subdomain: string;
  logo_url: string | null;
  banner_url: string | null;
  is_active: boolean;
}

/**
 * Works out which school a request is for. The Next.js proxy forwards the browser's
 * host (e.g. abc.sncmt.com) in `x-school-host`. No school = platform / main site.
 */
@Injectable()
export class SchoolContextMiddleware implements NestMiddleware {
  constructor(private readonly db: DbService) {}

  async use(req: any, _res: any, next: (err?: any) => void) {
    try {
      const raw = String(req.headers['x-school-host'] ?? req.headers.host ?? '');
      const host = raw.split(':')[0].toLowerCase();
      const root = (process.env.ROOT_DOMAIN ?? 'localhost').toLowerCase();
      let sub: string | null = null;
      if (host.endsWith('.' + root)) sub = host.slice(0, -(root.length + 1));
      if (!sub || sub === 'www') sub = null;

      req.subdomain = sub;
      req.school = null as SchoolInfo | null;
      if (sub) {
        const rows = await this.db.query<SchoolInfo>(
          `SELECT id::text AS id, name, subdomain::text AS subdomain, logo_url, banner_url, is_active
             FROM schools WHERE subdomain = $1`,
          [sub],
        );
        req.school = rows[0] ?? null;
      }
      next();
    } catch (e) {
      next(e);
    }
  }
}
