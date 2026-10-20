import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
  ) {}
  async list() {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    const allowed = ['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'].includes(scope.role)
      ? null
      : (
          await this.prisma.scoped.unitMembership.findMany({
            where: { membershipId: scope.membershipId },
            select: { unitId: true },
          })
        ).map((x) => x.unitId);
    return this.prisma.scoped.unit.findMany({
      where: { active: true, ...(allowed ? { id: { in: allowed } } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }
}
