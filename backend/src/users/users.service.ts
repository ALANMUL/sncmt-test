import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AccessService } from '../common/access.service';
import { DbService } from '../common/db.service';
import { normalizeMobile, parse } from '../common/util';

export const CREATABLE_ROLES = ['SCHOOL_ADMIN', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'GUARDIAN', 'STUDENT'] as const;

const createSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(255),
  role: z.enum(CREATABLE_ROLES),
  mobile: z.string().trim().min(1, 'Enter a mobile number'),
  password: z.string().min(6, 'Use at least 6 characters').max(100),
  profilePictureUrl: z.string().url().max(500).optional().or(z.literal('')),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  isActive: z.boolean().optional(),
  profilePictureUrl: z.string().url().max(500).nullable().optional(),
  password: z.string().min(6).max(100).optional(),
});

const code = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase()}`;

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService, private readonly access: AccessService) {}

  async list(schoolId: string, userId: string, role?: string, search?: string) {
    await this.access.require(userId, 'user.update', schoolId);
    const q = search?.trim() ? `%${search.trim()}%` : null;
    return this.db.query(
      `SELECT u.id::text AS id, u.name, u.mobile, u.email::text AS email, u.profile_picture_url,
              u.is_active, array_agg(DISTINCT r.code ORDER BY r.code) AS roles
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.school_id = $1
          AND ($2::text IS NULL OR EXISTS (
                SELECT 1 FROM user_roles x JOIN roles xr ON xr.id = x.role_id
                 WHERE x.user_id = u.id AND x.school_id = $1 AND xr.code = $2))
          AND ($3::text IS NULL OR u.name ILIKE $3 OR u.mobile ILIKE $3 OR u.email::text ILIKE $3)
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT 200`,
      [schoolId, role || null, q],
    );
  }

  async summary(schoolId: string, userId: string) {
    await this.access.require(userId, 'user.update', schoolId);
    return this.db.query(
      `SELECT r.code AS role, count(DISTINCT ur.user_id)::int AS total
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.school_id = $1 GROUP BY r.code ORDER BY r.code`,
      [schoolId],
    );
  }

  async create(schoolId: string, actorId: string, body: unknown) {
    const b = parse(createSchema, body);
    await this.access.require(actorId, 'user.create', schoolId);
    await this.access.require(actorId, 'user.assign_role', schoolId);
    const mobile = normalizeMobile(b.mobile);
    if (!mobile) throw new BadRequestException('mobile: Enter a valid number like 017XXXXXXXX');

    return this.db.tx(async (q) => {
      // One account per person: reuse the account when the mobile already exists.
      let u = await q<{ id: string }>(`SELECT id::text AS id FROM users WHERE mobile = $1`, [mobile]);
      let reused = true;
      if (!u[0]) {
        reused = false;
        const hash = await bcrypt.hash(b.password, 12);
        u = await q<{ id: string }>(
          `INSERT INTO users (name, mobile, password_hash, profile_picture_url)
           VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
          [b.name, mobile, hash, b.profilePictureUrl || null],
        );
      }
      const userId = u[0].id;

      const dup = await q(
        `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 AND ur.school_id = $2 AND r.code = $3`,
        [userId, schoolId, b.role],
      );
      if (dup.length) throw new ConflictException('This person already has that role in your school');

      await q(
        `INSERT INTO user_roles (user_id, school_id, role_id, assigned_by)
         SELECT $1, $2, r.id, $3 FROM roles r WHERE r.code = $4`,
        [userId, schoolId, actorId, b.role],
      );
      if (b.role === 'TEACHER') {
        await q(
          `INSERT INTO teachers (school_id, user_id, teacher_code) VALUES ($1, $2, $3)
           ON CONFLICT (school_id, user_id) DO NOTHING`,
          [schoolId, userId, code('T')],
        );
      }
      if (b.role === 'STUDENT') {
        await q(
          `INSERT INTO students (school_id, user_id, student_code, name) VALUES ($1, $2, $3, $4)
           ON CONFLICT (school_id, user_id) DO NOTHING`,
          [schoolId, userId, code('S'), b.name],
        );
      }
      return { id: userId, reusedExistingAccount: reused };
    });
  }

  async update(schoolId: string, actorId: string, targetId: string, body: unknown) {
    if (!/^\d+$/.test(targetId)) throw new BadRequestException('Bad user id');
    const b = parse(updateSchema, body);
    await this.access.require(actorId, 'user.update', schoolId);

    const inSchool = await this.db.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND school_id = $2 LIMIT 1`,
      [targetId, schoolId],
    );
    if (!inSchool.length) throw new NotFoundException('User not found in this school');

    if (b.isActive !== undefined) {
      await this.access.require(actorId, 'user.deactivate', schoolId);
      if (targetId === actorId && b.isActive === false) throw new ForbiddenException('You cannot disable your own account.');
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (b.name !== undefined) add('name', b.name);
    if (b.isActive !== undefined) add('is_active', b.isActive);
    if (b.profilePictureUrl !== undefined) add('profile_picture_url', b.profilePictureUrl);
    if (b.password !== undefined) add('password_hash', await bcrypt.hash(b.password, 12));
    if (!sets.length) return { ok: true };

    vals.push(targetId);
    await this.db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    return { ok: true };
  }
}
