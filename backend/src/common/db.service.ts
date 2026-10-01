import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

export type Q = <T extends QueryResultRow = any>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

/**
 * Plain SQL access. We use `pg` (not the Prisma client) for queries because the
 * schema uses CITEXT columns and BIGINT ids: `pg` returns BIGINT as strings, so
 * nothing breaks when we send JSON. Prisma is used for migrations.
 * Every query is parameterised ($1, $2 ...). Never build SQL from user input.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private pool: Pool;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set in backend/.env');
    const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
    this.pool = new Pool({
      connectionString: url,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 10,
    });
  }

  async query<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query<T>(text, params as any[]);
    return r.rows;
  }

  async tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const q: Q = async (text, params = []) =>
        (await client.query(text, params as any[])).rows as any;
      const out = await fn(q);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
