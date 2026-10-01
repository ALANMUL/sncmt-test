import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { AccessService } from '../common/access.service';
import { DbService } from '../common/db.service';
import { SchoolInfo } from '../common/school-context.middleware';
import { normalizeMobile } from '../common/util';

const REFRESH_DAYS = 30;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
  ) {}

  async login(
    identifier: string,
    password: string,
    school: SchoolInfo | null,
    meta: { ip?: string; userAgent?: string },
  ) {
    const id = identifier.trim();
    let rows: { id: string; password_hash: string; is_active: boolean }[] = [];
    if (id.includes('@')) {
      rows = await this.db.query(
        `SELECT id::text AS id, password_hash, is_active FROM users WHERE email = $1`,
        [id],
      );
    } else {
      const mobile = normalizeMobile(id);
      if (mobile) {
        rows = await this.db.query(
          `SELECT id::text AS id, password_hash, is_active FROM users WHERE mobile = $1`,
          [mobile],
        );
      }
    }
    const user = rows[0];
    // Same message for every failure so nobody can probe which accounts exist.
    const bad = new UnauthorizedException('Wrong login or password.');
    if (!user) throw bad;
    if (!(await bcrypt.compare(password, user.password_hash))) throw bad;
    if (!user.is_active) throw new ForbiddenException('This account is disabled.');

    const isPlatform = await this.access.isPlatformAdmin(user.id);
    if (school) {
      if (!school.is_active) throw new ForbiddenException('This school is not approved yet.');
      if (!isPlatform && (await this.access.rolesIn(user.id, school.id)).length === 0) {
        throw new ForbiddenException('You do not have access to this school.');
      }
    } else if (!isPlatform) {
      throw new ForbiddenException('Please log in on your school website.');
    }

    await this.db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    return { userId: user.id, tokens: await this.issue(user.id, school?.id ?? null, meta) };
  }

  private async issue(
    userId: string,
    schoolId: string | null,
    meta: { ip?: string; userAgent?: string },
  ): Promise<Tokens & { refreshId: string }> {
    const accessToken = await this.jwt.signAsync({ sub: userId });
    const refreshToken = randomBytes(48).toString('hex');
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, school_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5, $6) RETURNING id::text AS id`,
      [userId, schoolId, sha256(refreshToken), String(REFRESH_DAYS), meta.ip ?? null, (meta.userAgent ?? '').slice(0, 500) || null],
    );
    return { accessToken, refreshToken, refreshId: rows[0].id };
  }

  async refresh(token: string | undefined, school: SchoolInfo | null, meta: { ip?: string; userAgent?: string }) {
    if (!token) throw new UnauthorizedException('Please log in.');
    const rows = await this.db.query<{ id: string; user_id: string; school_id: string | null; is_active: boolean }>(
      `SELECT t.id::text AS id, t.user_id::text AS user_id, t.school_id::text AS school_id, u.is_active
         FROM refresh_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()`,
      [sha256(token)],
    );
    const old = rows[0];
    if (!old || !old.is_active) throw new UnauthorizedException('Session expired.');
    if ((old.school_id ?? null) !== (school?.id ?? null)) throw new UnauthorizedException('Session expired.');

    const next = await this.issue(old.user_id, old.school_id, meta);
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now(), replaced_by_token_id = $2 WHERE id = $1`,
      [old.id, next.refreshId],
    );
    return next;
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [sha256(token)],
    );
  }

  async me(userId: string, school: SchoolInfo | null) {
    const rows = await this.db.query(
      `SELECT id::text AS id, name, email::text AS email, mobile, profile_picture_url FROM users WHERE id = $1`,
      [userId],
    );
    const isPlatformAdmin = await this.access.isPlatformAdmin(userId);
    const roles = school ? await this.access.rolesIn(userId, school.id) : [];
    return {
      user: rows[0],
      isPlatformAdmin,
      roles,
      school: school ? { id: school.id, name: school.name, logo_url: school.logo_url } : null,
    };
  }
}
