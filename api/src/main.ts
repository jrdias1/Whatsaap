import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { TenantContextInterceptor } from './security/tenant-context.interceptor.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), { rawBody: true });
  if (process.env.NODE_ENV === 'test' && process.env.PLAYWRIGHT_TEST_TRUST_PROXY === '1') {
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  }
  app.useGlobalInterceptors(app.get(TenantContextInterceptor));
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',') ?? 'http://localhost:5173',
    credentials: true,
  });
  await app.listen(Number(process.env.API_PORT ?? 3002), '0.0.0.0');
}
await bootstrap();
