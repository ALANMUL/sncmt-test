import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { parse } from '../common/util';
import { AuthService, Tokens } from './auth.service';

const loginSchema = z.object({
  identifier: z.string().min(3, 'Enter your email or mobile number'),
  password: z.string().min(1, 'Enter your password'),
});

const secure = () => process.env.NODE_ENV === 'production';

function setCookies(res: any, t: Tokens) {
  const base = { httpOnly: true, sameSite: 'lax' as const, secure: secure(), path: '/' };
  res.cookie('sncmt_at', t.accessToken, { ...base, maxAge: 15 * 60 * 1000 });
  res.cookie('sncmt_rt', t.refreshToken, { ...base, maxAge: 30 * 24 * 60 * 60 * 1000 });
}
function clearCookies(res: any) {
  res.clearCookie('sncmt_at', { path: '/' });
  res.clearCookie('sncmt_rt', { path: '/' });
}
const metaOf = (req: any) => ({
  ip: String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim() || undefined,
  userAgent: req.headers['user-agent'] as string | undefined,
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const b = parse(loginSchema, body);
    const { userId, tokens } = await this.auth.login(b.identifier, b.password, req.school, metaOf(req));
    setCookies(res, tokens);
    return this.auth.me(userId, req.school);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const tokens = await this.auth.refresh(req.cookies?.sncmt_rt, req.school, metaOf(req));
    setCookies(res, tokens);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.auth.logout(req.cookies?.sncmt_rt);
    clearCookies(res);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: any) {
    return this.auth.me(req.user.id, req.school);
  }
}
