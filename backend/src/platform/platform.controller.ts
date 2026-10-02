import { BadRequestException, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuthGuard } from '../common/auth.guard';
import { DbService } from '../common/db.service';

// Tables that hold money history. A school with any row in these can never be deleted.
const MONEY_TABLES = ['funds', 'fee_types', 'fee_rates', 'student_fees', 'payments', 'transactions'];

// Children first, so the many RESTRICT links in the schema never block the delete. $1 = school id.
const DELETE_STEPS = [
  'DELETE FROM result_summary WHERE school_id = $1',
  'DELETE FROM exam_results WHERE school_id = $1',
  'DELETE FROM exam_subjects WHERE school_id = $1',
  'DELETE FROM exam_classes WHERE school_id = $1',
  'DELETE FROM exams WHERE school_id = $1',
  'DELETE FROM exam_types WHERE school_id = $1',
  'DELETE FROM grade_scales WHERE school_id = $1',
  'DELETE FROM class_subjects WHERE school_id = $1',
  'DELETE FROM student_academic_history WHERE school_id = $1',
  'DELETE FROM guardian_students WHERE student_id IN (SELECT id FROM students WHERE school_id = $1)',
  'DELETE FROM students WHERE school_id = $1',
  'DELETE FROM teachers WHERE school_id = $1',
  'DELETE FROM sections WHERE school_id = $1',
  'DELETE FROM subjects WHERE school_id = $1',
  'DELETE FROM classes WHERE school_id = $1',
  'DELETE FROM academic_years WHERE school_id = $1',
  'DELETE FROM user_permissions WHERE school_id = $1',
  'DELETE FROM user_roles WHERE school_id = $1',
  'DELETE FROM refresh_tokens WHERE school_id = $1',
  'DELETE FROM school_modules WHERE school_id = $1',
];

@Controller('platform')
@UseGuards(AuthGuard)
export class PlatformController {
  constructor(private readonly db: DbService, private readonly access: AccessService) {}

  private async admin(req: any) {
    if (!(await this.access.isPlatformAdmin(req.user.id))) {
      throw new ForbiddenException('Platform admins only.');
    }
  }

  @Get('schools')
  async list(@Req() req: any, @Query('status') status?: string) {
    await this.admin(req);
    const filter = status === 'pending' ? 'WHERE NOT s.is_active' : status === 'active' ? 'WHERE s.is_active' : '';
    return this.db.query(
      `SELECT s.id::text AS id, s.name, s.subdomain::text AS subdomain, s.email::text AS email,
              s.logo_url, s.is_active, s.created_at,
              u.name AS admin_name, u.email::text AS admin_email
         FROM schools s LEFT JOIN users u ON u.id = s.admin_user_id
         ${filter} ORDER BY s.created_at DESC LIMIT 500`,
    );
  }

  @Post('schools/:id/approve')
  async approve(@Req() req: any, @Param('id') id: string) {
    await this.admin(req);
    if (!/^\d+$/.test(id)) throw new BadRequestException('Bad school id');
    await this.db.tx(async (q) => {
      const rows = await q<{ admin_user_id: string | null; is_active: boolean }>(
        `SELECT admin_user_id::text AS admin_user_id, is_active FROM schools WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException('School not found');
      if (!rows[0].admin_user_id) throw new BadRequestException('This school has no registered admin');
      await q(`UPDATE schools SET is_active = TRUE WHERE id = $1`, [id]);
      // The registering user becomes SCHOOL_SUPER_ADMIN. The DB trigger checks the actor is a platform admin.
      await q(
        `INSERT INTO user_roles (user_id, school_id, role_id, assigned_by)
         SELECT $1, $2, r.id, $3 FROM roles r WHERE r.code = 'SCHOOL_SUPER_ADMIN'
         ON CONFLICT DO NOTHING`,
        [rows[0].admin_user_id, id, req.user.id],
      );
    });
    return { ok: true };
  }

  /**
   * Permanently deletes a school and everything inside it. Platform admins only.
   * The caller must send ?confirm=<the school's subdomain>.
   * Refused when the school has any fee/payment records (money history is permanent).
   */
  @Delete('schools/:id')
  async remove(@Req() req: any, @Param('id') id: string, @Query('confirm') confirm?: string) {
    await this.admin(req);
    if (!/^\d+$/.test(id)) throw new BadRequestException('Bad school id');

    await this.db.tx(async (q) => {
      const rows = await q<{ subdomain: string; admin_user_id: string | null }>(
        `SELECT subdomain::text AS subdomain, admin_user_id::text AS admin_user_id
           FROM schools WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException('School not found');
      if ((confirm ?? '').trim().toLowerCase() !== rows[0].subdomain.toLowerCase()) {
        throw new BadRequestException('Type the school address to confirm the delete.');
      }

      for (const table of MONEY_TABLES) {
        const used = await q(`SELECT 1 FROM ${table} WHERE school_id = $1 LIMIT 1`, [id]);
        if (used.length) {
          throw new ConflictException(
            'This school has fee or payment records. Money history is permanent, so it cannot be deleted.',
          );
        }
      }

      // Remember who belonged to this school, to tidy up their accounts afterwards.
      const members = await q<{ id: string }>(
        `SELECT DISTINCT user_id::text AS id FROM user_roles WHERE school_id = $1`,
        [id],
      );
      const userIds = members.map((m) => m.id);
      if (rows[0].admin_user_id) userIds.push(rows[0].admin_user_id);

      // Permanent record of the deletion (audit_logs has no foreign keys, so it outlives the school).
      await q(
        `INSERT INTO audit_logs (school_id, table_name, row_id, action, actor_user_id, old_data)
         SELECT id, 'schools', id, 'DELETE', $2, to_jsonb(s) FROM schools s WHERE id = $1`,
        [id, req.user.id],
      );

      for (const sql of DELETE_STEPS) await q(sql, [id]);
      await q(`DELETE FROM schools WHERE id = $1`, [id]);

      // Remove accounts that now belong to no school at all. Accounts that still have a role
      // somewhere else (one person, several schools) are kept.
      if (userIds.length) {
        await q(
          `DELETE FROM users u
            WHERE u.id = ANY($1::bigint[])
              AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = u.id)
              AND NOT EXISTS (SELECT 1 FROM user_roles WHERE assigned_by = u.id)
              AND NOT EXISTS (SELECT 1 FROM user_permissions WHERE granted_by = u.id)`,
          [userIds],
        );
      }
    });
    return { ok: true };
  }
}