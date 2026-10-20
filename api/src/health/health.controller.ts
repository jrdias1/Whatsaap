import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../security/security.decorators.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  async check() {
    let database: 'connected' | 'not_configured' | 'unavailable' = 'not_configured';
    if (process.env.DATABASE_URL) {
      try {
        await this.prisma.unscoped.$queryRaw`SELECT 1`;
        database = 'connected';
      } catch {
        database = 'unavailable';
      }
    }
    return { status: database === 'unavailable' ? 'degraded' : 'ok', database };
  }
}
