import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { AuthService } from '../auth/auth.service.js';
import { InvitationMailerService } from './invitation-mailer.service.js';
import type { UserRole } from '@prisma/client';
import { UsageService } from '../usage/usage.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly tenantContext: TenantContext, private readonly auth: AuthService, private readonly mailer: InvitationMailerService, private readonly usage: UsageService) {}

  async invite(input: { email?: unknown; displayName?: unknown; role?: unknown; unitIds?: unknown }) {
    const scope = this.tenantContext.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    if (!['TENANT_ADMIN', 'UNIT_MANAGER'].includes(scope.role)) throw new ForbiddenException('Permissão insuficiente para convidar usuários.');
    const role = input.role;
    if (!['UNIT_MANAGER', 'OPERATOR'].includes(role as string)) throw new BadRequestException('O convite deve ser para gerente de unidade ou operador.');
    if (role === 'OPERATOR') throw new BadRequestException('Operadores recebem acesso diretamente do administrador. Use o cadastro de operador com login e senha.');
    if (scope.role === 'UNIT_MANAGER' && role !== 'OPERATOR') throw new ForbiddenException('Gerentes podem convidar somente operadores.');
    if (typeof input.displayName !== 'string' || input.displayName.trim().length < 2 || input.displayName.trim().length > 120) throw new BadRequestException('Nome inválido.');
    const email = this.auth.normalizeEmail(input.email);
    if (!Array.isArray(input.unitIds) || input.unitIds.length === 0 || input.unitIds.some((id) => typeof id !== 'string')) throw new BadRequestException('Informe ao menos uma unidade para este acesso.');
    const unitIds = [...new Set(input.unitIds as string[])];
    const units = await this.prisma.scoped.unit.findMany({ where: { id: { in: unitIds }, active: true }, select: { id: true } });
    if (units.length !== unitIds.length) throw new BadRequestException('Uma ou mais unidades não pertencem à clínica ou estão inativas.');
    if (scope.role === 'UNIT_MANAGER') {
      const managerUnits = await this.prisma.scoped.unitMembership.findMany({ where: { membershipId: scope.membershipId }, select: { unitId: true } });
      const allowed = new Set(managerUnits.map(({ unitId }) => unitId));
      if (unitIds.some((id) => !allowed.has(id))) throw new ForbiddenException('Gerente só pode convidar para unidades sob sua responsabilidade.');
    }

    const existingUser = await this.prisma.unscoped.user.findUnique({ where: { email } });
    if (existingUser) {
      const membership = await this.prisma.scoped.membership.findUnique({ where: { tenantId_userId: { tenantId: scope.tenantId, userId: existingUser.id } } });
      if (membership) throw new BadRequestException('Este usuário já possui acesso ao tenant.');
    }
    const prior = await this.prisma.scoped.userInvitation.findFirst({ where: { tenantId: scope.tenantId, email, acceptedAt: null, expiresAt: { gt: new Date() } } });
    if (prior) throw new BadRequestException('Já existe um convite ativo para este e-mail.');

    const rawToken = randomBytes(48).toString('base64url');
    const invitation = await this.prisma.unscoped.$transaction(async (tx) => {
      await this.usage.assertCapacityWithinTransaction(tx, 'users');
      const prior = await tx.userInvitation.findFirst({ where: { tenantId: scope.tenantId, email, acceptedAt: null, expiresAt: { gt: new Date() } } });
      if (prior) throw new BadRequestException('Já existe um convite ativo para este e-mail.');
      const created = await tx.userInvitation.create({ data: {
        tenantId: scope.tenantId,
        email,
        displayName: (input.displayName as string).trim(),
        role: role as UserRole,
        unitIds,
        tokenHash: this.auth.hash(rawToken),
        invitedById: scope.userId,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'USER_INVITATION_CREATED', entityType: 'UserInvitation', entityId: created.id, metadata: { role: role as UserRole, email, unitIds } } });
      return created;
    });
    if (process.env.NODE_ENV === 'development' || (process.env.NODE_ENV === 'test' && process.env.LOCAL_INVITATION_HANDOFF === '1')) {
      await this.prisma.scoped.auditEvent.create({ data: { actorUserId: scope.userId, action: 'USER_INVITATION_ISSUED_LOCAL', entityType: 'UserInvitation', entityId: invitation.id, metadata: { delivery: 'LOCAL_ONLY', expiresAt: invitation.expiresAt.toISOString() } } });
      return { id: invitation.id, email, role, expiresAt: invitation.expiresAt, delivery: 'LOCAL_ONLY' as const, token: rawToken };
    }
    try {
      const tenant = await this.prisma.scoped.tenant.findFirst({ where: { id: scope.tenantId }, select: { name: true } });
      await this.mailer.send({ email, displayName: input.displayName.trim(), token: rawToken, tenantName: tenant?.name ?? 'a clínica' });
    } catch (error) {
      await this.prisma.unscoped.userInvitation.updateMany({ where: { id: invitation.id, tenantId: scope.tenantId, acceptedAt: null }, data: { expiresAt: new Date() } });
      await this.prisma.scoped.auditEvent.create({ data: { actorUserId: scope.userId, action: 'USER_INVITATION_DELIVERY_FAILED', entityType: 'UserInvitation', entityId: invitation.id } }).catch(() => undefined);
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Não foi possível entregar o convite. O convite pendente foi expirado.');
    }
    return { id: invitation.id, email, role, expiresAt: invitation.expiresAt, delivery: 'EMAIL' as const };
  }

  async createManagedMember(input: { email?: unknown; displayName?: unknown; role?: unknown; password?: unknown; unitIds?: unknown }) {
    const scope = this.tenantContext.current();
    if (!scope || scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Somente o administrador da clínica pode criar acessos de equipe.');
    if (input.role !== 'UNIT_MANAGER' && input.role !== 'OPERATOR') throw new BadRequestException('Selecione gerente ou operador.');
    const role = input.role as UserRole;
    if (typeof input.displayName !== 'string' || input.displayName.trim().length < 2 || input.displayName.trim().length > 120) throw new BadRequestException('Nome inválido.');
    const displayName = input.displayName.trim();
    const email = this.auth.normalizeEmail(input.email);
    if (!Array.isArray(input.unitIds) || input.unitIds.length === 0 || input.unitIds.length > 100 || input.unitIds.some((id) => typeof id !== 'string')) throw new BadRequestException('Selecione ao menos uma unidade para este operador.');
    const unitIds = [...new Set(input.unitIds as string[])];
    const units = await this.prisma.scoped.unit.findMany({ where: { id: { in: unitIds }, active: true }, select: { id: true } });
    if (units.length !== unitIds.length) throw new BadRequestException('Uma ou mais unidades não pertencem à clínica ou estão inativas.');
    const existing = await this.prisma.unscoped.user.findUnique({ where: { email }, select: { id: true, platformAdminIdentity: { select: { userId: true } } } });
    if (existing?.platformAdminIdentity) throw new ConflictException('A identidade global do Superadmin não pode ser adicionada à equipe clínica.');
    if (existing) throw new ConflictException('Este e-mail já está em uso. Informe outro login.');
    const passwordHash = await this.auth.hashPassword(input.password);
    try {
      return await this.prisma.unscoped.$transaction(async (tx) => {
        const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true, platformAdminIdentity: { select: { userId: true } } } });
        if (existingUser?.platformAdminIdentity) throw new ConflictException('A identidade global do Superadmin não pode ser adicionada à equipe clínica.');
        if (existingUser) throw new ConflictException('Este e-mail já está em uso. Informe outro login.');
        await this.usage.assertCapacityWithinTransaction(tx, 'users', scope.tenantId);
        const user = await tx.user.create({ data: { email, displayName, passwordHash, mustChangePassword: true }, select: { id: true, email: true, displayName: true, active: true, mustChangePassword: true } });
        const membership = await tx.membership.create({ data: { tenantId: scope.tenantId, userId: user.id, role, status: 'ACTIVE' } });
        await tx.unitMembership.createMany({ data: unitIds.map((unitId) => ({ tenantId: scope.tenantId, membershipId: membership.id, unitId })) });
        await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'CLINIC_MEMBER_ACCESS_CREATED', entityType: 'Membership', entityId: membership.id, metadata: { email, role, unitIds, passwordManagedByClinic: true, mustChangePassword: true } } });
        return { id: membership.id, role: membership.role, status: membership.status, unitIds, user };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new ConflictException('Este e-mail já está em uso. Informe outro login.');
      throw error;
    }
  }

  async resetMemberPassword(membershipId: string, input: { password?: unknown }) {
    const scope = this.tenantContext.current();
    if (!scope || scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Somente o administrador da clínica pode redefinir senhas da equipe.');
    if (!this.isUuid(membershipId)) throw new BadRequestException('O identificador do acesso é inválido.');
    const target = await this.prisma.scoped.membership.findUnique({ where: { tenantId_id: { tenantId: scope.tenantId, id: membershipId } }, select: { id: true, role: true, status: true, userId: true, user: { select: { id: true, email: true, active: true, passwordHash: true, platformAdminIdentity: { select: { userId: true } } } } } });
    if (!target || target.role === 'PLATFORM_SUPERADMIN' || target.user.platformAdminIdentity) throw new ForbiddenException('Este acesso não pode ser administrado pela clínica.');
    if (target.status !== 'ACTIVE' || !target.user.active) throw new ConflictException('Reative o acesso antes de redefinir a senha.');
    if (target.userId === scope.userId) throw new ForbiddenException('Para trocar sua própria senha, use a área Minha conta.');
    const otherMemberships = await this.prisma.unscoped.membership.count({ where: { userId: target.userId, tenantId: { not: scope.tenantId } } });
    if (otherMemberships) throw new ConflictException('Este login também está vinculado a outra clínica. A senha é compartilhada pela conta; solicite a redefinição ao titular da conta.');
    const passwordHash = await this.auth.hashPassword(input.password);
    if (await this.auth.passwordMatches(input.password, target.user.passwordHash)) throw new BadRequestException('A senha provisória deve ser diferente da senha atual.');
    const result = await this.prisma.unscoped.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({ where: { id: target.userId, passwordHash: target.user.passwordHash, active: true }, data: { passwordHash, mustChangePassword: true } });
      if (!changed.count) throw new ConflictException('A senha foi alterada em outra operação. Atualize a tela e tente novamente.');
      const sessions = await tx.authSession.updateMany({ where: { userId: target.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.passwordRecoveryToken.updateMany({ where: { userId: target.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'USER_PASSWORD_RESET_BY_ADMIN', entityType: 'User', entityId: target.userId, metadata: { membershipId, role: target.role, sessionsRevoked: sessions.count, passwordManagedByClinic: true, mustChangePassword: true } } });
      return { membershipId, email: target.user.email, sessionsRevoked: sessions.count };
    });
    return result;
  }

  async list(query: { q?: unknown; role?: unknown; unitId?: unknown; status?: unknown }) {
    const scope = this.tenantContext.current();
    if (!scope || !['TENANT_ADMIN', 'UNIT_MANAGER'].includes(scope.role)) throw new ForbiddenException('Permissão insuficiente para consultar a equipe.');
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
    const role = typeof query.role === 'string' && ['TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR'].includes(query.role) ? query.role as UserRole : undefined;
    const requestedUnit = typeof query.unitId === 'string' ? query.unitId : undefined;
    const ownUnits = scope.role === 'TENANT_ADMIN'
      ? null
      : (await this.prisma.scoped.unitMembership.findMany({ where: { membershipId: scope.membershipId }, select: { unitId: true } })).map((row) => row.unitId);
    if (requestedUnit && ownUnits && !ownUnits.includes(requestedUnit)) throw new ForbiddenException('Unidade fora do seu escopo.');
    const unitIds = requestedUnit ? [requestedUnit] : ownUnits ?? undefined;
    const memberships = await this.prisma.scoped.membership.findMany({
      where: {
        ...(scope.role === 'UNIT_MANAGER' ? { role: 'OPERATOR' } : {}),
        ...(role ? { role } : {}),
        ...(query.status === 'DISABLED' ? { status: 'DISABLED' } : query.status === 'ACTIVE' ? { status: 'ACTIVE' } : {}),
        ...(unitIds ? { unitScopes: { some: { unitId: { in: unitIds } } } } : {}),
        ...(q ? { user: { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } } : {}),
      },
      orderBy: [{ user: { displayName: 'asc' } }], take: 100,
      select: { id: true, role: true, status: true, createdAt: true, unitScopes: { select: { unitId: true } }, user: { select: { id: true, email: true, displayName: true, active: true } } },
    });
    const invitations = await this.prisma.scoped.userInvitation.findMany({
      where: { ...(scope.role === 'UNIT_MANAGER' ? { role: 'OPERATOR' } : {}), ...(role ? { role } : {}), ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } : {}) },
      orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, email: true, displayName: true, role: true, unitIds: true, expiresAt: true, acceptedAt: true, createdAt: true },
    });
    const visibleInvitations = invitations.filter((invitation) => (!requestedUnit || invitation.unitIds.includes(requestedUnit)) && (!ownUnits || invitation.unitIds.every((unitId) => ownUnits.includes(unitId))));
    return { users: memberships, invitations: visibleInvitations };
  }

  async updateMembership(membershipId: string, input: { role?: unknown; unitIds?: unknown; status?: unknown }) {
    const scope = this.tenantContext.current();
    if (!this.isUuid(membershipId)) throw new BadRequestException('O identificador do acesso é inválido.');
    if (!scope || !['TENANT_ADMIN', 'UNIT_MANAGER'].includes(scope.role)) throw new ForbiddenException('Permissão insuficiente para administrar a equipe.');
    const target = await this.prisma.scoped.membership.findUnique({ where: { tenantId_id: { tenantId: scope.tenantId, id: membershipId } }, include: { user: { select: { id: true, platformAdminIdentity: { select: { userId: true } } } }, unitScopes: { select: { unitId: true } } } });
    if (!target || target.role === 'PLATFORM_SUPERADMIN' || target.user.platformAdminIdentity) throw new ForbiddenException('Acesso não pode ser administrado por este painel.');
    const managerUnits = scope.role === 'UNIT_MANAGER' ? new Set(await this.managerUnitIds(scope.membershipId)) : null;
    if (managerUnits && (target.role !== 'OPERATOR' || target.unitScopes.some(({ unitId }) => !managerUnits.has(unitId)))) throw new ForbiddenException('Gerente só pode administrar operadores das próprias unidades.');
    if (target.userId === scope.userId && input.role !== undefined) throw new ForbiddenException('Não é permitido alterar o próprio papel.');
    if (input.role !== undefined && !['TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR'].includes(input.role as string)) throw new BadRequestException('Papel inválido. Superadmin não pode ser atribuído pela clínica.');
    if (scope.role === 'UNIT_MANAGER' && input.role !== undefined && input.role !== 'OPERATOR') throw new ForbiddenException('Gerente só pode manter operadores.');
    if (input.status !== undefined && !['ACTIVE', 'DISABLED'].includes(input.status as string)) throw new BadRequestException('Status inválido.');
    if (input.unitIds !== undefined && (!Array.isArray(input.unitIds) || input.unitIds.some((value) => typeof value !== 'string'))) throw new BadRequestException('Lista de unidades inválida.');
    const nextRole = input.role as UserRole | undefined;
    const nextStatus = input.status as 'ACTIVE' | 'DISABLED' | undefined;
    const unitIds = input.unitIds === undefined ? undefined : [...new Set(input.unitIds as string[])];
    if (unitIds && !unitIds.length) throw new BadRequestException('Informe ao menos uma unidade ativa.');
    if (unitIds) {
      const valid = await this.prisma.scoped.unit.findMany({ where: { id: { in: unitIds }, active: true }, select: { id: true } });
      if (valid.length !== unitIds.length) throw new BadRequestException('Unidade inexistente, inativa ou fora do tenant.');
      if (scope.role === 'UNIT_MANAGER') {
        const allowed = new Set(await this.managerUnitIds(scope.membershipId));
        if (unitIds.some((id) => !allowed.has(id))) throw new ForbiddenException('Gerente só pode atribuir as próprias unidades.');
      }
    }
    const changed = await this.prisma.unscoped.$transaction(async (tx) => {
    if ((nextStatus === 'DISABLED' || (nextRole !== undefined && nextRole !== 'TENANT_ADMIN')) && target.role === 'TENANT_ADMIN') {
        const otherAdmins = await tx.membership.count({ where: { tenantId: scope.tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE', id: { not: target.id } } });
      if (otherAdmins === 0) throw new ConflictException('A clínica precisa manter ao menos um administrador ativo.');
    }
      const updated = await tx.membership.update({ where: { tenantId_id: { tenantId: scope.tenantId, id: target.id } }, data: { ...(nextRole ? { role: nextRole } : {}), ...(nextStatus ? { status: nextStatus } : {}) }, select: { id: true, role: true, status: true } });
      if (unitIds) {
        await tx.unitMembership.deleteMany({ where: { tenantId: scope.tenantId, membershipId: target.id } });
        await tx.unitMembership.createMany({ data: unitIds.map((unitId) => ({ tenantId: scope.tenantId, membershipId: target.id, unitId })) });
      }
      const revokeSessions = Boolean(nextRole || nextStatus === 'DISABLED' || unitIds);
      const revoked = revokeSessions ? await tx.authSession.updateMany({ where: { tenantId: scope.tenantId, membershipId: target.id, revokedAt: null }, data: { revokedAt: new Date() } }) : { count: 0 };
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: nextStatus === 'DISABLED' ? 'USER_ACCESS_REVOKED' : nextStatus === 'ACTIVE' ? 'USER_ACCESS_REACTIVATED' : 'USER_MEMBERSHIP_UPDATED', entityType: 'Membership', entityId: target.id, metadata: { changedRole: nextRole ?? null, status: nextStatus ?? null, unitIds: unitIds ?? null, sessionsRevoked: revoked.count } } });
      return { ...updated, unitIds: unitIds ?? target.unitScopes.map(({ unitId }) => unitId), sessionsRevoked: revoked.count };
    }, { isolationLevel: 'Serializable' });
    return changed;
  }

  async history(membershipId: string) {
    const scope = this.tenantContext.current();
    if (!scope || !['TENANT_ADMIN', 'UNIT_MANAGER'].includes(scope.role)) throw new ForbiddenException('Você não tem permissão para consultar o histórico de acessos.');
    if (!this.isUuid(membershipId)) throw new BadRequestException('O identificador do acesso é inválido.');
    const target = await this.prisma.scoped.membership.findUnique({ where: { tenantId_id: { tenantId: scope.tenantId, id: membershipId } }, select: { id: true, role: true, userId: true, unitScopes: { select: { unitId: true } } } });
    if (!target || target.role === 'PLATFORM_SUPERADMIN') throw new ForbiddenException('Este acesso não está disponível no painel da clínica.');
    if (scope.role === 'UNIT_MANAGER') {
      const own = new Set(await this.managerUnitIds(scope.membershipId));
      if (target.role !== 'OPERATOR' || target.unitScopes.some(({ unitId }) => !own.has(unitId))) throw new ForbiddenException('Gerentes só podem consultar operadores das unidades sob sua responsabilidade.');
    }
    return this.prisma.scoped.auditEvent.findMany({ where: { tenantId: scope.tenantId, OR: [{ entityType: 'Membership', entityId: target.id }, { entityType: 'User', entityId: target.userId }] }, orderBy: { occurredAt: 'desc' }, take: 50, select: { id: true, actorUserId: true, action: true, metadata: true, occurredAt: true } });
  }

  async revokeSessions(membershipId: string) {
    const scope = this.tenantContext.current();
    if (!this.isUuid(membershipId)) throw new BadRequestException('O identificador do acesso é inválido.');
    if (!scope || !['TENANT_ADMIN', 'UNIT_MANAGER'].includes(scope.role)) throw new ForbiddenException('Permissão insuficiente para revogar sessões.');
    const target = await this.prisma.scoped.membership.findUnique({ where: { tenantId_id: { tenantId: scope.tenantId, id: membershipId } }, select: { id: true, role: true, unitScopes: { select: { unitId: true } } } });
    if (!target || target.role === 'PLATFORM_SUPERADMIN') throw new ForbiddenException('Acesso não autorizado.');
    const managerUnits = scope.role === 'UNIT_MANAGER' ? new Set(await this.managerUnitIds(scope.membershipId)) : null;
    if (managerUnits && (target.role !== 'OPERATOR' || target.unitScopes.some(({ unitId }) => !managerUnits.has(unitId)))) throw new ForbiddenException('Gerente só pode administrar operadores das próprias unidades.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const result = await tx.authSession.updateMany({ where: { tenantId: scope.tenantId, membershipId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'USER_SESSIONS_REVOKED', entityType: 'Membership', entityId: membershipId, metadata: { count: result.count } } });
      return { revoked: result.count };
    });
  }

  async issueRecovery(membershipId: string, input: { currentPassword?: unknown; identityVerification?: unknown; reason?: unknown }) {
    const scope = this.tenantContext.current();
    if (!this.isUuid(membershipId)) throw new BadRequestException('O identificador do acesso é inválido.');
    if (!scope || scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Somente administrador da clínica pode emitir recuperação assistida.');
    await this.auth.verifyCurrentPassword(scope.userId, input.currentPassword);
    const verification = input.identityVerification;
    if (!['IN_PERSON', 'VERIFIED_CALLBACK', 'SUPERVISOR_REVIEW'].includes(verification as string)) throw new BadRequestException('Registre o método de verificação de identidade antes de emitir o token.');
    if (typeof input.reason !== 'string' || input.reason.trim().length < 8 || input.reason.trim().length > 300) throw new BadRequestException('Informe o motivo da recuperação (8 a 300 caracteres).');
    const verificationMethod = verification as string;
    const recoveryReason = input.reason.trim();
    const membership = await this.prisma.scoped.membership.findUnique({ where: { tenantId_id: { tenantId: scope.tenantId, id: membershipId } }, select: { id: true, role: true, status: true, user: { select: { id: true, active: true, platformAdminIdentity: { select: { userId: true } } } } } });
    if (!membership || membership.status !== 'ACTIVE' || !membership.user.active || membership.role === 'PLATFORM_SUPERADMIN' || membership.user.platformAdminIdentity) throw new BadRequestException('Conta clínica ativa não encontrada para recuperação.');
    if (membership.role === 'OPERATOR') throw new BadRequestException('Redefina a senha do operador diretamente na lista da equipe; o operador não usa token de recuperação.');
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 20 * 60_000);
    await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.passwordRecoveryToken.updateMany({ where: { tenantId: scope.tenantId, userId: membership.user.id, usedAt: null }, data: { usedAt: now } });
      const recovery = await tx.passwordRecoveryToken.create({ data: { tenantId: scope.tenantId, userId: membership.user.id, createdById: scope.userId, tokenHash: this.auth.hash(token), expiresAt } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'PASSWORD_RECOVERY_TOKEN_ISSUED', entityType: 'PasswordRecoveryToken', entityId: recovery.id, metadata: { targetMembershipId: membership.id, verification: verificationMethod, reason: recoveryReason, expiresAt: expiresAt.toISOString() } } });
    });
    return { token, expiresAt, delivery: 'ADMIN_HANDOFF_AFTER_IDENTITY_VERIFICATION' as const };
  }

  private async managerUnitIds(membershipId: string) {
    return (await this.prisma.scoped.unitMembership.findMany({ where: { membershipId }, select: { unitId: true } })).map(({ unitId }) => unitId);
  }

  private isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
}
