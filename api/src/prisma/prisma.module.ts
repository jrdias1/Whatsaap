import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';

@Global()
@Module({ providers: [PrismaService, TenantContext], exports: [PrismaService, TenantContext] })
export class PrismaModule {}
