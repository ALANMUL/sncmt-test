import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { DbService } from '../common/db.service';
import { RESERVED_SUBDOMAINS, parse } from '../common/util';

const registerSchema = z.object({
  schoolName: z.string().trim().min(2, 'Enter the school name').max(255),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, 'Use 3-30 letters, numbers or hyphens'),
  schoolEmail: z.string().trim().email('Enter a valid school email'),
  adminName: z.string().trim().min(2, 'Enter the admin name').max(255),
  adminEmail: z.string().trim().email('Enter a valid admin email'),
  password: z.string().min(8, 'Use at least 8 characters').max(100),
  logoUrl: z.string().url().max(500).optional().or(z.literal('')),
});

@Controller('schools')
export class SchoolsController {
  constructor(private readonly db: DbService) {}

  /** Used by the Next.js middleware to brand and gate each school website. */
  @Get('by-subdomain/:sub')
  async bySubdomain(@Param('sub') sub: string) {
    const rows = await this.db.query(
      `SELECT name, subdomain::text AS subdomain, logo_url, banner_url, is_active
         FROM schools WHERE subdomain = $1`,
      [sub],
    );
    if (!rows[0]) throw new NotFoundException('School not found');
    return rows[0];
  }

  @Get('check-subdomain/:sub')
  async check(@Param('sub') sub: string) {
    const s = sub.toLowerCase();
    if (RESERVED_SUBDOMAINS.includes(s)) return { available: false };
    const rows = await this.db.query(`SELECT 1 FROM schools WHERE subdomain = $1`, [s]);
    return { available: rows.length === 0 };
  }

  @Post('register')
  async register(@Body() body: unknown) {
    const b = parse(registerSchema, body);
    if (RESERVED_SUBDOMAINS.includes(b.subdomain)) throw new BadRequestException('subdomain: This name is reserved');
    if (b.schoolEmail.toLowerCase() === b.adminEmail.toLowerCase()) {
      throw new BadRequestException('The school email and admin email must be different');
    }

    await this.db.tx(async (q) => {
      if ((await q(`SELECT 1 FROM schools WHERE subdomain = $1`, [b.subdomain])).length)
        throw new ConflictException('That subdomain is already taken');
      if ((await q(`SELECT 1 FROM schools WHERE email = $1`, [b.schoolEmail])).length)
        throw new ConflictException('A school with that email already exists');
      if ((await q(`SELECT 1 FROM users WHERE email = $1`, [b.schoolEmail])).length)
        throw new ConflictException('That school email belongs to a user already');
      if ((await q(`SELECT 1 FROM users WHERE email = $1`, [b.adminEmail])).length
        || (await q(`SELECT 1 FROM schools WHERE email = $1`, [b.adminEmail])).length)
        throw new ConflictException('That admin email is already in use');

      const hash = await bcrypt.hash(b.password, 12);
      const u = await q<{ id: string }>(
        `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id::text AS id`,
        [b.adminName, b.adminEmail, hash],
      );
      await q(
        `INSERT INTO schools (name, subdomain, email, logo_url, is_active, admin_user_id)
         VALUES ($1, $2, $3, $4, FALSE, $5)`,
        [b.schoolName, b.subdomain, b.schoolEmail, b.logoUrl || null, u[0].id],
      );
    });
    return { ok: true, status: 'PENDING_APPROVAL' };
  }
}
