import { ForbiddenException, Injectable } from '@nestjs/common';
import { DbService } from './db.service';

/** Thin wrappers over the permission functions that live in the database. */
@Injectable()
export class AccessService {
  constructor(private readonly db: DbService) {}

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const r = await this.db.query<{ ok: boolean }>(`SELECT is_platform_admin($1::bigint) AS ok`, [userId]);
    return r[0]?.ok === true;
  }

  async rolesIn(userId: string, schoolId: string): Promise<string[]> {
    const r = await this.db.query<{ code: string }>(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1 AND ur.school_id = $2`,
      [userId, schoolId],
    );
    return r.map((x) => x.code);
  }

  async can(userId: string, perm: string, schoolId: string): Promise<boolean> {
    const r = await this.db.query<{ ok: boolean }>(
      `SELECT has_permission($1::bigint, $2::text, $3::bigint) AS ok`,
      [userId, perm, schoolId],
    );
    return r[0]?.ok === true;
  }

  async require(userId: string, perm: string, schoolId: string) {
    if (!(await this.can(userId, perm, schoolId))) {
      throw new ForbiddenException('You do not have permission to do this.');
    }
  }
}
