import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { ALLOW_PENDING_PASSWORD_CHANGE, IS_PUBLIC } from './security.decorators.js';
import type { AuthenticatedRequest } from './security.types.js';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const claims = request.user;
    if (!claims?.tenantId || !claims.membershipId || !claims.sessionId) {
      throw new UnauthorizedException({ code: 'SESSION_INVALID', message: 'A sessão é inválida. Entre novamente.' });
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (![claims.tenantId, claims.membershipId, claims.sessionId, claims.sub].every((value) => uuid.test(value))) {
      throw new UnauthorizedException({ code: 'SESSION_INVALID', message: 'A sessão é inválida. Entre novamente.' });
    }

    const session = await this.prisma.unscoped.authSession.findFirst({
      where: {
        id: claims.sessionId,
        tenantId: claims.tenantId,
        userId: claims.sub,
        membershipId: claims.membershipId,
      },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        tenant: { select: { status: true } },
        membership: { select: { role: true, status: true, tenantId: true, userId: true } },
        user: { select: { active: true, mustChangePassword: true, platformAdminIdentity: { select: { userId: true } } } },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active || session.membership.status !== 'ACTIVE' || session.membership.tenantId !== claims.tenantId || session.membership.userId !== claims.sub) {
      throw new UnauthorizedException({ code: 'SESSION_INVALID', message: 'A sessão expirou ou foi revogada. Entre novamente.' });
    }
    if (!['TRIAL', 'ACTIVE'].includes(session.tenant.status)) {
      throw new ForbiddenException('A clínica está suspensa ou encerrada. Contate o administrador da plataforma.');
    }

    if (session.membership.role === 'PLATFORM_SUPERADMIN' && !session.user.platformAdminIdentity) {
      throw new ForbiddenException('A identidade global da plataforma não está autorizada.');
    }

    const allowsPasswordSetup = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (session.user.mustChangePassword && session.membership.role !== 'PLATFORM_SUPERADMIN' && !allowsPasswordSetup) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Defina uma nova senha para continuar.' });
    }

    request.user.role = session.membership.role;
    return true;
  }
}
