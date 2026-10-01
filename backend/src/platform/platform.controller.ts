import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuthGuard } from '../common/auth.guard';
import { DbService } from '../common/db.service';

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
}
