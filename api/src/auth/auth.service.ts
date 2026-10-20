import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { decryptSecret } from '../security/secret-crypto.js';
import { verifyTotp } from './totp.js';
import type { UserRole } from '@prisma/client';

const ACCESS_TTL_SECONDS = 15 * 60;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_HASH = '$2b$12$wA7B7VYy5M8i9J3z7o5DheUQ8sJe9obY1yQ8kw/v4q6u5/XhVvq5a';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async login(emailInput: unknown, passwordInput: unknown, tenantSlugInput: unknown, otpInput?: unknown) {
    const email = this.email(emailInput);
    const password = typeof passwordInput === 'string' ? passwordInput : '';
    const tenantSlug = typeof tenantSlugInput === 'string' ? tenantSlugInput.trim().toLowerCase() : '';
    const user = await this.prisma.unscoped.user.findUnique({
      where: { email },
      include: { platformAdminIdentity: { select: { userId: true, totpSecretEncrypted: true, lastTotpStep: true } }, memberships: { where: { status: 'ACTIVE', tenant: { slug: tenantSlug, status: { in: ['ACTIVE', 'TRIAL'] } } }, include: { tenant: true } } },
    });
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    const membership = user?.memberships[0];
    if (!user?.active || !passwordOk || !membership || (membership.role === 'PLATFORM_SUPERADMIN' && !user.platformAdminIdentity)) throw new UnauthorizedException('Credenciais inválidas.');
    if (membership.role === 'PLATFORM_SUPERADMIN') {
      const identity = user.platformAdminIdentity!;
      const step = verifyTotp(decryptSecret(identity.totpSecretEncrypted), otpInput);
      if (step === null) throw new UnauthorizedException('Código MFA inválido ou ausente.');
      const consumed = await this.prisma.unscoped.platformAdminIdentity.updateMany({ where: { userId: user.id, lastTotpStep: { lt: step } }, data: { lastTotpStep: step } });
      if (!consumed.count) throw new UnauthorizedException('Código MFA já utilizado. Aguarde o próximo código.');
    }
    return this.createSession(user.id, membership.tenantId, membership.id, membership.role);
  }

  async refresh(rawToken: unknown) {
    if (typeof rawToken !== 'string' || rawToken.length < 32) throw new UnauthorizedException('Sessão inválida.');
    const tokenHash = this.hash(rawToken);
    const session = await this.prisma.unscoped.authSession.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() }, user: { active: true }, membership: { status: 'ACTIVE' }, tenant: { status: { in: ['ACTIVE', 'TRIAL'] } } },
      include: { membership: true },
    });
    if (!session) throw new UnauthorizedException('Sessão inválida ou expirada.');
    const nextToken = randomBytes(48).toString('base64url');
    const nextHash = this.hash(nextToken);
    const nextId = randomUUID();
    await this.prisma.unscoped.$transaction(async (tx) => {
      const result = await tx.authSession.updateMany({ where: { id: session.id, tokenHash, revokedAt: null }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
      if (!result.count) throw new UnauthorizedException('Sessão já utilizada.');
      await tx.authSession.create({ data: { id: nextId, tokenHash: nextHash, tenantId: session.tenantId, userId: session.userId, membershipId: session.membershipId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    });
    const accessToken = await this.accessToken(session.userId, session.tenantId, session.membershipId, nextId, session.membership.role);
    return { accessToken, refreshToken: nextToken };
  }

  async logout(rawToken: unknown) {
    if (typeof rawToken === 'string' && rawToken.length >= 32) {
      await this.prisma.unscoped.authSession.updateMany({ where: { tokenHash: this.hash(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return { success: true };
  }

  async acceptInvitation(tokenInput: unknown, passwordInput: unknown) {
    if (typeof tokenInput !== 'string' || tokenInput.length < 32) throw new BadRequestException('Convite inválido.');
    const password = this.validatePassword(passwordInput);
    const tokenHash = this.hash(tokenInput);
    const invitation = await this.prisma.unscoped.userInvitation.findFirst({ where: { tokenHash, acceptedAt: null, expiresAt: { gt: new Date() } } });
    if (!invitation) throw new BadRequestException('Convite inválido ou expirado.');
    if (invitation.role === 'OPERATOR') throw new BadRequestException('O acesso de operador é criado pelo administrador. Solicite diretamente seu login e senha à clínica.');
    const passwordHash = await bcrypt.hash(password, 12);
    return this.prisma.unscoped.$transaction(async (tx) => {
      const claimed = await tx.userInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
      if (!claimed.count) throw new BadRequestException('Convite já utilizado.');
      let user = await tx.user.findUnique({ where: { email: invitation.email } });
      if (!user) user = await tx.user.create({ data: { email: invitation.email, displayName: invitation.displayName, passwordHash } });
      else if (!user.active) throw new BadRequestException('Usuário desativado.');
      const membershipExists = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } } });
      if (membershipExists) throw new BadRequestException('Usuário já vinculado a este tenant.');
      const membership = await tx.membership.create({ data: { tenantId: invitation.tenantId, userId: user.id, role: invitation.role, status: 'ACTIVE' } });
      if (invitation.unitIds.length) {
        const units = await tx.unit.findMany({ where: { tenantId: invitation.tenantId, id: { in: invitation.unitIds }, active: true }, select: { id: true } });
        if (units.length !== invitation.unitIds.length) throw new BadRequestException('Unidade do convite inválida ou inativa.');
        await tx.unitMembership.createMany({ data: invitation.unitIds.map((unitId) => ({ tenantId: invitation.tenantId, membershipId: membership.id, unitId })) });
      }
      await tx.auditEvent.create({ data: { tenantId: invitation.tenantId, actorUserId: user.id, action: 'USER_INVITATION_ACCEPTED', entityType: 'User', entityId: user.id } });
      return { success: true };
    });
  }

  async completePasswordRecovery(tenantSlugInput: unknown, emailInput: unknown, tokenInput: unknown, passwordInput: unknown) {
    const tenantSlug = typeof tenantSlugInput === 'string' ? tenantSlugInput.trim().toLowerCase() : '';
    const email = this.email(emailInput);
    if (!tenantSlug || typeof tokenInput !== 'string' || tokenInput.length < 32 || tokenInput.length > 128) throw new BadRequestException('Solicitação inválida ou expirada.');
    const password = this.validatePassword(passwordInput);
    const tokenHash = this.hash(tokenInput);
    const now = new Date();
    const candidate = await this.prisma.unscoped.passwordRecoveryToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now }, tenant: { slug: tenantSlug, status: { in: ['TRIAL', 'ACTIVE'] } }, user: { email, active: true, platformAdminIdentity: { is: null }, memberships: { some: { tenant: { slug: tenantSlug }, status: 'ACTIVE', role: { not: 'OPERATOR' } } } } },
      select: { id: true, tenantId: true, userId: true },
    });
    if (!candidate) throw new BadRequestException('Solicitação inválida ou expirada.');
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.unscoped.$transaction(async (tx) => {
      const current = await tx.passwordRecoveryToken.findFirst({ where: { id: candidate.id, tokenHash, usedAt: null, expiresAt: { gt: new Date() }, tenant: { status: { in: ['TRIAL', 'ACTIVE'] } }, user: { active: true, platformAdminIdentity: { is: null }, memberships: { some: { tenantId: candidate.tenantId, status: 'ACTIVE', role: { not: 'OPERATOR' } } } } }, select: { id: true, userId: true, tenantId: true } });
      if (!current) throw new BadRequestException('Solicitação inválida ou expirada.');
      const claimed = await tx.passwordRecoveryToken.updateMany({ where: { id: current.id, tokenHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!claimed.count) throw new BadRequestException('Solicitação inválida ou expirada.');
      await tx.user.update({ where: { id: current.userId }, data: { passwordHash, mustChangePassword: false } });
      const revoked = await tx.authSession.updateMany({ where: { userId: current.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.passwordRecoveryToken.updateMany({ where: { userId: current.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.auditEvent.create({ data: { tenantId: current.tenantId, actorUserId: current.userId, action: 'PASSWORD_RECOVERY_COMPLETED', entityType: 'User', entityId: current.userId, metadata: { sessionsRevoked: revoked.count, passwordReset: true } } });
    });
    return { success: true, message: 'Senha atualizada. Entre novamente com a nova senha.' };
  }

  async changeOwnPassword(userId: string, tenantId: string, sessionId: string, currentPasswordInput: unknown, nextPasswordInput: unknown) {
    const [membership, user] = await Promise.all([
      this.prisma.unscoped.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { role: true } }),
      this.prisma.unscoped.user.findFirst({ where: { id: userId, active: true }, select: { passwordHash: true, platformAdminIdentity: { select: { userId: true } } } }),
    ]);
    if (!membership || membership.role === 'PLATFORM_SUPERADMIN' || user?.platformAdminIdentity) throw new ForbiddenException('A identidade da plataforma usa o fluxo de autenticação próprio.');
    if (!user || typeof currentPasswordInput !== 'string' || currentPasswordInput.length > 72 || !await bcrypt.compare(currentPasswordInput, user.passwordHash)) throw new UnauthorizedException('Senha atual incorreta.');
    const password = this.validatePassword(nextPasswordInput);
    if (await bcrypt.compare(password, user.passwordHash)) throw new BadRequestException('A nova senha deve ser diferente da senha provisória atual.');
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.unscoped.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({ where: { id: userId, passwordHash: user.passwordHash, active: true }, data: { passwordHash, mustChangePassword: false } });
      if (!changed.count) throw new ConflictException('A senha foi alterada em outra operação. Entre novamente e tente de novo.');
      await tx.authSession.updateMany({ where: { userId, id: { not: sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.passwordRecoveryToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.auditEvent.create({ data: { tenantId, actorUserId: userId, action: 'USER_PASSWORD_CHANGED', entityType: 'User', entityId: userId, metadata: { otherSessionsRevoked: true } } });
    });
    return { success: true, mustChangePassword: false };
  }

  async hashPassword(input: unknown) {
    return bcrypt.hash(this.validatePassword(input), 12);
  }

  private async createSession(userId: string, tenantId: string, membershipId: string, role: UserRole) {
    const refreshToken = randomBytes(48).toString('base64url');
    const session = await this.prisma.unscoped.authSession.create({ data: { tenantId, userId, membershipId, tokenHash: this.hash(refreshToken), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    return { accessToken: await this.accessToken(userId, tenantId, membershipId, session.id, role), refreshToken };
  }

  private accessToken(sub: string, tenantId: string, membershipId: string, sessionId: string, role: UserRole) {
    return new SignJWT({ tenantId, membershipId, sessionId, role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub)
      .setIssuer('clinic-api').setAudience('clinic-web').setIssuedAt().setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.secret());
  }

  private secret() {
    const value = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!value || value.length < 32) throw new Error('JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres.');
    return new TextEncoder().encode(value);
  }

  private email(input: unknown) {
    if (typeof input !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())) throw new BadRequestException('E-mail inválido.');
    return input.trim().toLowerCase();
  }

  validatePassword(input: unknown) {
    if (typeof input !== 'string' || input.length < 8 || Buffer.byteLength(input, 'utf8') > 72) throw new BadRequestException('A senha deve ter no mínimo 8 caracteres e até 72 bytes.');
    return input;
  }

  async verifyCurrentPassword(userId: string, value: unknown) {
    const user = typeof value === 'string' && value.length <= 72
      ? await this.prisma.unscoped.user.findFirst({ where: { id: userId, active: true }, select: { passwordHash: true } })
      : null;
    if (!user || !await bcrypt.compare(value as string, user.passwordHash)) throw new UnauthorizedException('Senha atual incorreta.');
  }

  async passwordMatches(value: unknown, passwordHash: string) {
    return typeof value === 'string' && value.length <= 72 && bcrypt.compare(value, passwordHash);
  }

  normalizeEmail(input: unknown) { return this.email(input); }
  hash(input: string) { return createHash('sha256').update(input).digest('hex'); }
}
