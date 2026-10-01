import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { DbExceptionFilter } from './common/db-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalFilters(new DbExceptionFilter());
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`SNCMT backend running on http://localhost:${port}`);
}
bootstrap();
