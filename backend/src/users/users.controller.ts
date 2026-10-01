import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  private school(req: any): string {
    if (!req.school?.is_active) throw new BadRequestException('Open this from your school website.');
    return req.school.id;
  }

  @Get()
  list(@Req() req: any, @Query('role') role?: string, @Query('q') q?: string) {
    return this.users.list(this.school(req), req.user.id, role, q);
  }

  @Get('summary')
  summary(@Req() req: any) {
    return this.users.summary(this.school(req), req.user.id);
  }

  @Post()
  create(@Req() req: any, @Body() body: unknown) {
    return this.users.create(this.school(req), req.user.id, body);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {
    return this.users.update(this.school(req), req.user.id, id, body);
  }
}
