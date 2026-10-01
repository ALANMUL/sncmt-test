import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { DbService } from '../common/db.service';

/** Creates the very first platform admin (only when none exists). */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly log = new Logger('Bootstrap');
  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.PLATFORM_ADMIN_PASSWORD;
    if (!email || !password) {
      this.log.warn('PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD not set; skipping first-admin creation.');
      return;
    }
    try {
      const exists = await this.db.query(
        `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.code = 'PLATFORM_ADMIN' LIMIT 1`,
      );
      if (exists.length) return;
      const hash = await bcrypt.hash(password, 12);
      await this.db.tx(async (q) => {
        let u = await q<{ id: string }>(`SELECT id::text AS id FROM users WHERE email = $1`, [email]);
        if (!u[0]) {
          u = await q<{ id: string }>(
            `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id::text AS id`,
            [process.env.PLATFORM_ADMIN_NAME ?? 'Platform Admin', email, hash],
          );
        }
        // assigned_by NULL is allowed only while no PLATFORM_ADMIN exists (bootstrap rule in the schema).
        await q(
          `INSERT INTO user_roles (user_id, school_id, role_id, assigned_by)
           SELECT $1, NULL, id, NULL FROM roles WHERE code = 'PLATFORM_ADMIN'`,
          [u[0].id],
        );
      });
      this.log.log(`First platform admin created: ${email}`);
    } catch (e: any) {
      this.log.error(`Could not create the first platform admin: ${e.message}`);
    }
  }
}
