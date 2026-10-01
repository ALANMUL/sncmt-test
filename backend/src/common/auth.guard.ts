import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DbService } from './db.service';

export interface AuthUser {
  id: string;
  name: string;
}

/** Reads the access token from the httpOnly cookie (or a Bearer header). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const token: string | undefined = req.cookies?.sncmt_at || bearer || undefined;
    if (!token) throw new UnauthorizedException('Please log in.');

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Session expired.');
    }
    const rows = await this.db.query<{ id: string; name: string; is_active: boolean }>(
      `SELECT id::text AS id, name, is_active FROM users WHERE id = $1`,
      [payload.sub],
    );
    if (!rows[0] || !rows[0].is_active) throw new UnauthorizedException('Account is disabled.');
    req.user = { id: rows[0].id, name: rows[0].name } as AuthUser;
    return true;
  }
}
