import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DbService } from './common/db.service';
import { AccessService } from './common/access.service';
import { AuthGuard } from './common/auth.guard';
import { SchoolContextMiddleware } from './common/school-context.middleware';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SchoolsController } from './schools/schools.controller';
import { PlatformController } from './platform/platform.controller';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { UploadsController } from './uploads/uploads.controller';
import { BootstrapService } from './bootstrap/bootstrap.service';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-only-secret',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [
    AuthController,
    SchoolsController,
    PlatformController,
    UsersController,
    UploadsController,
  ],
  providers: [
    DbService,
    AccessService,
    AuthGuard,
    AuthService,
    UsersService,
    BootstrapService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SchoolContextMiddleware).forRoutes('*');
  }
}
