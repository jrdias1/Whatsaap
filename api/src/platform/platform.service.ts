import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { AuthService } from '../auth/auth.service.js';
import { UsageService } from '../usage/usage.service.js';
import { InvitationMailerService } from '../users/invitation-mailer.service.js';

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext, private readonly auth: AuthService, private readonly usage: UsageService, private readonly invitationMailer: InvitationMailerService) {}

  private async scope() {
    const scope = this.context.current();
    if (!scope || scope.role !== 'PLATFORM_SUPERADMIN' || !await this.prisma.unscoped.platformAdminIdentity.findUnique({ where: { userId: scope.userId }, select: { userId: true } })) throw new ForbiddenException('Acesso exclusivo à administração da plataforma.');
    return scope;
  }
  async dashboard() {
    const actor = await this.scope();
    const now = new Date();
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [counts, tenants, plans, recentAudit, totalTenants, units, activeUsers, metaConnections, evolutionConnections, unoConnections, newTenants30d, activePatients, messagesReserved30d, campaignsReserved30d, activeAutomations, pendingInvitations, trialsEndingSoon, failedOutbox, pausedAutomations] = await Promise.all([
      Promise.all(['ACTIVE', 'TRIAL', 'SUSPENDED'].map(async (status) => [status, await this.prisma.unscoped.tenant.count({ where: { status: status as TenantStatus } })] as const)),
      this.prisma.unscoped.tenant.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 200, select: {
        id: true, name: true, slug: true, status: true, createdAt: true,
        units: { where: { active: true }, select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } },
        subscription: { select: { status: true, cycleStartsAt: true, cycleEndsAt: true, limitOverrides: true, plan: { select: { code: true, name: true, enabled: true } } } },
        _count: { select: { memberships: { where: { status: 'ACTIVE' } }, automations: true, tasks: { where: { status: { in: ['TODO', 'IN_PROGRESS'] } } }, outbox: { where: { status: { in: ['FAILED', 'PENDING', 'RETRY'] } } } } },
      } }),
      this.prisma.unscoped.plan.findMany({ where: { enabled: true }, orderBy: { priceCents: 'asc' }, select: { id: true, code: true, name: true, priceCents: true, patientLimit: true, messageLimitPerCycle: true, userLimit: true, unitLimit: true, connectionLimit: true, activeAutomationLimit: true, campaignLimitPerCycle: true, enabled: true } }),
      this.prisma.unscoped.auditEvent.findMany({ orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 50, select: { id: true, tenantId: true, actorUserId: true, action: true, entityType: true, entityId: true, occurredAt: true } }),
      this.prisma.unscoped.tenant.count(),
      this.prisma.unscoped.unit.count(),
      this.prisma.unscoped.user.count({ where: { active: true, platformAdminIdentity: { is: null }, memberships: { some: { status: 'ACTIVE', tenant: { status: { in: ['ACTIVE', 'TRIAL'] } } } } } }),
      this.prisma.unscoped.metaConnection.count(),
      this.prisma.unscoped.evolutionConnection.count(),
      this.prisma.unscoped.unoConnection.count(),
      this.prisma.unscoped.tenant.count({ where: { createdAt: { gte: last30Days } } }),
      this.prisma.unscoped.patient.count({ where: { active: true, deletedAt: null, tenant: { status: { in: ['ACTIVE', 'TRIAL'] } } } }),
      this.prisma.unscoped.usageEntry.aggregate({ where: { metric: 'messages', createdAt: { gte: last30Days } }, _sum: { quantity: true } }),
      this.prisma.unscoped.usageEntry.aggregate({ where: { metric: 'campaigns', createdAt: { gte: last30Days } }, _sum: { quantity: true } }),
      this.prisma.unscoped.automation.count({ where: { status: 'ACTIVE' } }),
      this.prisma.unscoped.userInvitation.count({ where: { acceptedAt: null, expiresAt: { gt: now }, tenant: { status: { in: ['ACTIVE', 'TRIAL'] } } } }),
      this.prisma.unscoped.subscription.count({ where: { status: 'TRIAL', cycleEndsAt: { gte: now, lte: next7Days }, tenant: { status: { in: ['ACTIVE', 'TRIAL'] } } } }),
      this.prisma.unscoped.outboxMessage.count({ where: { status: 'FAILED' } }),
      this.prisma.unscoped.automation.count({ where: { status: 'PAUSED' } }),
    ]);
    const map = Object.fromEntries(counts);
    await this.auditRead(actor.userId, 'PLATFORM_DASHBOARD_VIEWED', 'PlatformDashboard', null, { tenantRowsReturned: tenants.length });
    return {
      generatedAt: now.toISOString(),
      counts: {
        tenants: totalTenants, active: map.ACTIVE, trial: map.TRIAL, suspended: map.SUSPENDED,
        units, activeUsers, configuredConnections: metaConnections + evolutionConnections + unoConnections, newTenants30d,
      },
      usage: {
        activePatients, messagesReserved30d: messagesReserved30d._sum.quantity ?? 0,
        campaignsReserved30d: campaignsReserved30d._sum.quantity ?? 0, activeAutomations,
        periodStart: last30Days.toISOString(), periodEnd: now.toISOString(),
      },
      operations: { pendingInvitations, trialsEndingSoon, failedOutbox, pausedAutomations },
      tenants, plans, recentAudit,
    };
  }
  async plans() { const actor = await this.scope(); const plans = await this.prisma.unscoped.plan.findMany({ where: { enabled: true }, orderBy: { priceCents: 'asc' }, select: { id: true, code: true, name: true, priceCents: true, patientLimit: true, messageLimitPerCycle: true, userLimit: true, unitLimit: true, connectionLimit: true, activeAutomationLimit: true, campaignLimitPerCycle: true } }); await this.auditRead(actor.userId, 'PLATFORM_PLANS_VIEWED', 'Plan', null, { count: plans.length }); return plans; }
  async tenantDetails(id: string) {
    const actor = await this.scope();
    const row = await this.prisma.unscoped.tenant.findUnique({ where: { id }, select: {
      id: true, name: true, slug: true, status: true, timezone: true, createdAt: true, updatedAt: true,
      units: { orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, active: true, scheduleEnabled: true } },
      unoConnections: { select: { id: true, unitId: true, status: true, sourceOfTruth: true, writeEnabled: true, lastCheckedAt: true, lastEventAt: true } },
      memberships: { orderBy: { createdAt: 'asc' }, select: { id: true, role: true, status: true, createdAt: true, user: { select: { id: true, email: true, displayName: true, active: true, mustChangePassword: true } }, unitScopes: { select: { unitId: true } } } },
      invitations: { where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, email: true, displayName: true, role: true, unitIds: true, expiresAt: true, createdAt: true } },
      subscription: { select: { id: true, status: true, cycleStartsAt: true, cycleEndsAt: true, limitOverrides: true, plan: { select: { id: true, code: true, name: true, priceCents: true, patientLimit: true, messageLimitPerCycle: true, userLimit: true, unitLimit: true, connectionLimit: true, activeAutomationLimit: true, campaignLimitPerCycle: true, enabled: true } }, usageEntries: { orderBy: { createdAt: 'desc' }, take: 100, select: { metric: true, quantity: true, cycleStartsAt: true, cycleEndsAt: true, createdAt: true } } } },
      metaConnections: { select: { id: true, unitId: true, displayName: true, status: true, enabled: true, updatedAt: true } },
      evolutionConnections: { select: { id: true, unitId: true, displayName: true, mode: true, status: true, enabled: true, updatedAt: true } },
      automations: { select: { id: true, name: true, trigger: true, status: true, updatedAt: true } },
      tasks: { where: { status: { in: ['TODO', 'IN_PROGRESS'] } }, orderBy: { dueAt: 'asc' }, take: 50, select: { id: true, status: true, priority: true, dueAt: true, unitId: true } },
      outbox: { where: { status: { in: ['FAILED', 'PENDING', 'RETRY'] } }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, purpose: true, status: true, createdAt: true } },
      auditEvents: { orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 100, select: { id: true, actorUserId: true, action: true, entityType: true, entityId: true, occurredAt: true } },
      _count: { select: { memberships: true, units: true, patients: true, automations: true, outbox: true } },
    } });
    if (!row) throw new NotFoundException('Empresa não encontrada.');
    await this.auditRead(actor.userId, 'PLATFORM_TENANT_DETAILS_VIEWED', 'Tenant', id, { sections: ['units', 'memberships', 'subscription', 'connections', 'automations', 'tasks', 'audit'] });
    return { ...row, tasks: row.tasks.map((task) => ({ ...task, title: 'Pendência operacional' })) };
  }
  async provision(input: Record<string, unknown>) {
    const actor = await this.scope();
    const key = this.text(input.idempotencyKey, 'idempotencyKey', 120);
    if (key.length < 12) throw new BadRequestException('A chave idempotente deve ter ao menos 12 caracteres.');
    const name = this.text(input.name, 'name', 160), slug = this.slug(input.slug);
    const unitName = this.text(input.unitName, 'unitName', 120), unitSlug = input.unitSlug ? this.slug(input.unitSlug) : this.slugFrom(unitName);
    const adminName = this.text(input.adminName, 'adminName', 120), adminEmail = this.auth.normalizeEmail(input.adminEmail);
    const directAccount = typeof input.adminPassword === 'string' && input.adminPassword.length > 0;
    const existingAdmin = directAccount ? await this.prisma.unscoped.user.findUnique({ where: { email: adminEmail }, select: { id: true, email: true, displayName: true, active: true, mustChangePassword: true, platformAdminIdentity: { select: { userId: true } } } }) : null;
    if (existingAdmin?.platformAdminIdentity) throw new ConflictException('A conta global do Superadmin não pode ser usada como administrador de clínica.');
    if (existingAdmin && !existingAdmin.active) throw new ConflictException('A conta desse e-mail está desativada.');
    const adminPasswordHash = directAccount && !existingAdmin ? await this.auth.hashPassword(input.adminPassword) : undefined;
    const planCode = this.text(input.planCode, 'planCode', 40).toUpperCase(), trialDays = this.integer(input.trialDays ?? 30, 'trialDays', 1, 90);
    const prior = await this.prisma.unscoped.tenant.findUnique({ where: { provisioningKey: key }, select: { id: true, name: true, slug: true, status: true } });
    if (prior) return { tenant: prior, alreadyProvisioned: true, invitation: null };
    const plan = (await this.prisma.unscoped.plan.findUnique({ where: { code: planCode } }))
      ?? await this.prisma.unscoped.plan.findFirst({ where: { code: { equals: planCode, mode: 'insensitive' } } });
    if (!plan?.enabled) throw new BadRequestException('Plano inicial inexistente ou desativado.');
    const token = randomBytes(48).toString('base64url'), start = new Date(), end = new Date(start.getTime() + trialDays * 86400000);
    try {
      return await this.prisma.unscoped.$transaction(async (tx) => {
        const duplicate = await tx.tenant.findFirst({ where: { OR: [{ provisioningKey: key }, { slug }] }, select: { id: true, name: true, slug: true, status: true, provisioningKey: true } });
        if (duplicate) {
          if (duplicate.provisioningKey === key) return { tenant: duplicate, alreadyProvisioned: true, invitation: null };
          throw new ConflictException('Já existe uma empresa com este identificador.');
        }
        const tenant = await tx.tenant.create({ data: { name, slug, status: 'TRIAL', provisioningKey: key } });
        const unit = await tx.unit.create({ data: { tenantId: tenant.id, name: unitName, slug: unitSlug } });
        const subscription = await tx.subscription.create({ data: { tenantId: tenant.id, planId: plan.id, status: 'TRIAL', cycleStartsAt: start, cycleEndsAt: end } });
        let invitation: { id: string; email: string; role: UserRole; expiresAt: Date } | null = null;
        let initialAccount: { id: string; email: string; displayName: string; role: UserRole; mustChangePassword: boolean; reused: boolean } | null = null;
        if (directAccount) {
          const user = existingAdmin ?? await tx.user.create({ data: { email: adminEmail, displayName: adminName, passwordHash: adminPasswordHash!, mustChangePassword: true }, select: { id: true, email: true, displayName: true, mustChangePassword: true } });
          const membership = await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'TENANT_ADMIN', status: 'ACTIVE' } });
          await tx.unitMembership.create({ data: { tenantId: tenant.id, membershipId: membership.id, unitId: unit.id } });
          initialAccount = { id: membership.id, email: user.email, displayName: user.displayName, role: membership.role, mustChangePassword: user.mustChangePassword, reused: Boolean(existingAdmin) };
          await tx.auditEvent.create({ data: { tenantId: tenant.id, actorUserId: actor.userId, action: existingAdmin ? 'PLATFORM_CLINIC_ADMIN_LINKED' : 'PLATFORM_CLINIC_ADMIN_CREATED', entityType: 'Membership', entityId: membership.id, metadata: { email: user.email, unitId: unit.id, accountReused: Boolean(existingAdmin), mustChangePassword: user.mustChangePassword } } });
        } else {
          invitation = await tx.userInvitation.create({ data: { tenantId: tenant.id, email: adminEmail, displayName: adminName, role: 'TENANT_ADMIN', unitIds: [unit.id], tokenHash: this.auth.hash(token), invitedById: actor.userId, expiresAt: end } });
          await tx.auditEvent.create({ data: { tenantId: tenant.id, actorUserId: actor.userId, action: 'PLATFORM_INVITATION_CREATED_LOCAL', entityType: 'UserInvitation', entityId: invitation.id, metadata: { role: 'TENANT_ADMIN', unitId: unit.id, expiresAt: end.toISOString() } } });
        }
        await tx.auditEvent.create({ data: { tenantId: tenant.id, actorUserId: actor.userId, action: 'PLATFORM_TENANT_PROVISIONED', entityType: 'Tenant', entityId: tenant.id, metadata: { slug, unitId: unit.id, planCode: plan.code, trialDays, invitationId: invitation?.id ?? null, initialMembershipId: initialAccount?.id ?? null } } });
        return { tenant: { id: tenant.id, name, slug, status: tenant.status }, alreadyProvisioned: false, account: initialAccount, invitation: invitation ? { id: invitation.id, email: adminEmail, role: invitation.role, expiresAt: end, token, delivery: 'LOCAL_ONLY', tenantSlug: slug, unit: { id: unit.id, name: unitName }, subscription: { id: subscription.id, planCode: plan.code, cycleStartsAt: start, cycleEndsAt: end } } : null };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const same = await this.prisma.unscoped.tenant.findUnique({ where: { provisioningKey: key }, select: { id: true, name: true, slug: true, status: true } });
        if (same) return { tenant: same, alreadyProvisioned: true, invitation: null };
        throw new ConflictException('Já existe uma empresa com este identificador.');
      }
      throw error;
    }
  }
  async updateTenant(id: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    const data: Prisma.TenantUpdateInput = {};
    if (input.name !== undefined) data.name = this.text(input.name, 'name', 160);
    if (input.slug !== undefined) data.slug = this.slug(input.slug);
    if (!Object.keys(data).length) throw new BadRequestException('Informe pelo menos um dado administrativo.');
    const updated = await this.prisma.unscoped.$transaction(async (tx) => {
      const result = await tx.tenant.update({ where: { id }, data });
      await tx.auditEvent.create({ data: { tenantId: id, actorUserId: actor.userId, action: 'PLATFORM_TENANT_UPDATED', entityType: 'Tenant', entityId: id, metadata: { changedFields: Object.keys(data) } } });
      return { id: result.id, name: result.name, slug: result.slug, status: result.status };
    }); return updated;
  }
  async status(id: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    if (input.status !== 'ACTIVE' && input.status !== 'SUSPENDED') throw new BadRequestException('Status deve ser ACTIVE ou SUSPENDED.');
    const reason = this.text(input.reason, 'reason', 500);
    const tenant = await this.prisma.unscoped.tenant.findUnique({ where: { id }, include: { subscription: { include: { plan: true } } } });
    if (!tenant) throw new NotFoundException('Empresa não encontrada.');
    if (input.status === 'ACTIVE' && (!tenant.subscription || !tenant.subscription.plan.enabled || !['TRIAL', 'ACTIVE'].includes(tenant.subscription.status) || tenant.subscription.cycleStartsAt > new Date() || tenant.subscription.cycleEndsAt <= new Date())) throw new ConflictException('Plano/período de acesso inválido; empresa não foi reativada.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const status: TenantStatus = input.status === 'SUSPENDED' ? 'SUSPENDED' : tenant.subscription?.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
      await tx.tenant.update({ where: { id }, data: { status } });
      let suppressedOutboxCount = 0, suppressedExecutionCount = 0;
      if (status === 'SUSPENDED') {
        await tx.authSession.updateMany({ where: { tenantId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        suppressedOutboxCount = (await tx.outboxMessage.updateMany({ where: { tenantId: id, status: { in: ['PENDING', 'RETRY'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'TENANT_SUSPENDED', lastError: 'Tenant suspenso pelo Superadmin.' } })).count;
        suppressedExecutionCount = (await tx.automationExecution.updateMany({ where: { tenantId: id, status: 'PENDING' }, data: { status: 'SUPPRESSED', lastError: 'Tenant suspenso pelo Superadmin.' } })).count;
        await tx.metaConnection.updateMany({ where: { tenantId: id }, data: { status: 'DISCONNECTED', enabled: false } });
        await tx.evolutionConnection.updateMany({ where: { tenantId: id }, data: { status: 'DISCONNECTED', enabled: false, lastError: 'Tenant suspenso; exige nova validação local.' } });
      }
      await tx.auditEvent.create({ data: { tenantId: id, actorUserId: actor.userId, action: status === 'SUSPENDED' ? 'PLATFORM_TENANT_SUSPENDED' : 'PLATFORM_TENANT_REACTIVATED', entityType: 'Tenant', entityId: id, metadata: { reason, suppressedOutboxCount, suppressedExecutionCount, sessionsRevoked: status === 'SUSPENDED', oldExecutionsWillNotResume: true, connectionsNeedLocalRevalidation: true } } });
      return { id, status, reason, historicalDataPreserved: true, oldExecutionsWillNotResume: true };
    });
  }
  async limits(id: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    const allowed = ['patientLimit', 'messageLimitPerCycle', 'userLimit', 'unitLimit', 'connectionLimit', 'activeAutomationLimit', 'campaignLimitPerCycle'] as const;
    const changes: Record<string, number | null> = {};
    for (const key of allowed) if (key in input) {
      const value = input[key];
      if (key === 'patientLimit' && value === null) changes[key] = null;
      else if (Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000) changes[key] = value as number;
      else throw new BadRequestException(`Limite ${key} inválido.`);
    }
    if (!Object.keys(changes).length) throw new BadRequestException('Informe pelo menos um limite.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { tenantId: id }, select: { id: true, limitOverrides: true, cycleStartsAt: true } });
      if (!sub) throw new ConflictException('Empresa sem assinatura.');
      await this.lockTenantLimitRows(tx, id, sub.cycleStartsAt);
      const prior = sub.limitOverrides && typeof sub.limitOverrides === 'object' && !Array.isArray(sub.limitOverrides) ? sub.limitOverrides as Record<string, unknown> : {};
      const overrides = { ...prior, ...changes } as Prisma.InputJsonObject;
      await tx.subscription.update({ where: { id: sub.id }, data: { limitOverrides: overrides } });
      await tx.auditEvent.create({ data: { tenantId: id, actorUserId: actor.userId, action: 'PLATFORM_TENANT_LIMITS_UPDATED', entityType: 'Subscription', entityId: sub.id, metadata: { changes } } });
      return { tenantId: id, overrides };
    });
  }
  async changePlan(id: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    const code = this.text(input.planCode, 'planCode', 40).toUpperCase();
    const plan = (await this.prisma.unscoped.plan.findUnique({ where: { code }, select: { id: true, code: true, enabled: true } }))
      ?? await this.prisma.unscoped.plan.findFirst({ where: { code: { equals: code, mode: 'insensitive' }, enabled: true }, select: { id: true, code: true, enabled: true } });
    if (!plan?.enabled) throw new BadRequestException('Plano inexistente ou desativado.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const current = await tx.subscription.findUnique({ where: { tenantId: id }, select: { id: true, cycleStartsAt: true } });
      if (!current) throw new NotFoundException('Assinatura não encontrada.');
      await this.lockTenantLimitRows(tx, id, current.cycleStartsAt);
      const subscription = await tx.subscription.update({ where: { tenantId: id }, data: { planId: plan.id, limitOverrides: Prisma.DbNull }, select: { id: true, status: true, cycleStartsAt: true, cycleEndsAt: true, limitOverrides: true, plan: { select: { code: true } } } });
      await tx.auditEvent.create({ data: { tenantId: id, actorUserId: actor.userId, action: 'PLATFORM_TENANT_PLAN_CHANGED', entityType: 'Subscription', entityId: subscription.id, metadata: { planCode: plan.code, perTenantLimitOverridesReset: true } } });
      return subscription;
    });
  }
  async inviteTenantMember(tenantId: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    this.assertUuid(tenantId, 'Clínica');
    const reason = this.text(input.reason, 'Motivo', 500);
    if (reason.length < 8) throw new BadRequestException('Informe um motivo com pelo menos 8 caracteres.');
    const role = input.role as string;
    if (!['TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR'].includes(role as string)) throw new BadRequestException('Papel inválido. Superadmin é uma identidade global e não pode ser atribuído a uma clínica.');
    const name = this.text(input.displayName, 'Nome', 120);
    if (name.length < 2) throw new BadRequestException('Nome deve ter ao menos 2 caracteres.');
    const email = this.auth.normalizeEmail(input.email);
    if (!Array.isArray(input.unitIds) || !input.unitIds.length || input.unitIds.some((id) => typeof id !== 'string')) throw new BadRequestException('Selecione ao menos uma unidade.');
    const unitIds = [...new Set(input.unitIds as string[])];
    const [tenant, units, existingUser] = await Promise.all([
      this.prisma.unscoped.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, status: true } }),
      this.prisma.unscoped.unit.findMany({ where: { tenantId, id: { in: unitIds }, active: true }, select: { id: true } }),
      this.prisma.unscoped.user.findUnique({ where: { email }, select: { id: true, email: true, displayName: true, active: true, mustChangePassword: true, platformAdminIdentity: { select: { userId: true } }, memberships: { where: { tenantId }, select: { id: true } } } }),
    ]);
    if (!tenant || !['ACTIVE', 'TRIAL'].includes(tenant.status)) throw new NotFoundException('Clínica inexistente, suspensa ou encerrada.');
    if (units.length !== unitIds.length) throw new BadRequestException('Uma ou mais unidades não pertencem à clínica ou estão inativas.');
    if (existingUser?.platformAdminIdentity) throw new ConflictException('A identidade global do Superadmin não pode ser adicionada à equipe clínica.');
    if (existingUser?.memberships.length) throw new ConflictException('Este e-mail já possui acesso à clínica. Edite o acesso existente.');
    if (existingUser && !existingUser.active) throw new ConflictException('Esta conta está desativada; não é possível convidá-la.');
    const duplicate = await this.prisma.unscoped.userInvitation.findFirst({ where: { tenantId, email, acceptedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (duplicate) throw new ConflictException('Já existe um convite válido para este e-mail.');
    const token = randomBytes(48).toString('base64url');
    const invitation = await this.prisma.unscoped.$transaction(async (tx) => {
      await this.usage.assertCapacityWithinTransaction(tx, 'users', tenantId);
      const concurrentDuplicate = await tx.userInvitation.findFirst({ where: { tenantId, email, acceptedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (concurrentDuplicate) throw new ConflictException('Já existe um convite válido para este e-mail.');
      const created = await tx.userInvitation.create({ data: { tenantId, email, displayName: name, role: role as UserRole, unitIds, tokenHash: this.auth.hash(token), invitedById: actor.userId, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) } });
      const metadata = { role, email, unitIds, reason, invitationId: created.id };
      await tx.auditEvent.createMany({ data: [
        { actorUserId: actor.userId, action: 'PLATFORM_CLINIC_MEMBER_INVITATION_CREATED', entityType: 'UserInvitation', entityId: created.id, metadata },
        { tenantId, actorUserId: actor.userId, action: 'PLATFORM_CLINIC_MEMBER_INVITATION_CREATED', entityType: 'UserInvitation', entityId: created.id, metadata },
      ] });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (process.env.NODE_ENV !== 'production') {
      await this.prisma.unscoped.auditEvent.create({ data: { tenantId, actorUserId: actor.userId, action: 'PLATFORM_CLINIC_MEMBER_INVITATION_LOCAL_HANDOFF', entityType: 'UserInvitation', entityId: invitation.id, metadata: { delivery: 'LOCAL_ONLY', expiresAt: invitation.expiresAt.toISOString(), reason } } });
      return { id: invitation.id, email, displayName: name, role, expiresAt: invitation.expiresAt, delivery: 'LOCAL_ONLY', token };
    }
    try {
      await this.invitationMailer.send({ email, displayName: name, token, tenantName: tenant.name });
      return { id: invitation.id, email, displayName: name, role, expiresAt: invitation.expiresAt, delivery: 'EMAIL' };
    } catch (error) {
      await this.prisma.unscoped.userInvitation.updateMany({ where: { id: invitation.id, tenantId, acceptedAt: null }, data: { expiresAt: new Date() } });
      await this.prisma.unscoped.auditEvent.create({ data: { tenantId, actorUserId: actor.userId, action: 'PLATFORM_CLINIC_MEMBER_INVITATION_DELIVERY_FAILED', entityType: 'UserInvitation', entityId: invitation.id, metadata: { reason } } }).catch(() => undefined);
      throw error;
    }
  }

  async createTenantMember(tenantId: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    this.assertUuid(tenantId, 'Clínica');
    const role = input.role as string;
    if (!['TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR'].includes(role)) throw new BadRequestException('Papel inválido.');
    const displayName = this.text(input.displayName, 'Nome', 120);
    if (displayName.length < 2) throw new BadRequestException('Nome deve ter ao menos 2 caracteres.');
    const email = this.auth.normalizeEmail(input.email);
    if (!Array.isArray(input.unitIds) || !input.unitIds.length || input.unitIds.some((id) => typeof id !== 'string')) throw new BadRequestException('Selecione ao menos uma unidade.');
    const unitIds = [...new Set(input.unitIds as string[])];
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
    const [tenant, units, existingUser] = await Promise.all([
      this.prisma.unscoped.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } }),
      this.prisma.unscoped.unit.findMany({ where: { tenantId, id: { in: unitIds }, active: true }, select: { id: true } }),
      this.prisma.unscoped.user.findUnique({ where: { email }, select: { id: true, email: true, displayName: true, active: true, mustChangePassword: true, platformAdminIdentity: { select: { userId: true } }, memberships: { where: { tenantId }, select: { id: true } } } }),
    ]);
    if (!tenant || !['ACTIVE', 'TRIAL'].includes(tenant.status)) throw new NotFoundException('Clínica inexistente, suspensa ou encerrada.');
    if (units.length !== unitIds.length) throw new BadRequestException('Uma ou mais unidades não pertencem à clínica ou estão inativas.');
    if (existingUser?.platformAdminIdentity) throw new ConflictException('A conta global do Superadmin não pode ser adicionada à equipe clínica.');
    if (existingUser?.memberships.length) throw new ConflictException('Este e-mail já tem acesso a esta clínica. Edite o usuário existente.');
    if (existingUser && !existingUser.active) throw new ConflictException('Esta conta está desativada.');
    const passwordHash = existingUser ? undefined : await this.auth.hashPassword(input.password);
    const metadata = { email, role, unitIds, accountReused: Boolean(existingUser), mustChangePassword: existingUser?.mustChangePassword ?? true, reason: reason || null };
    return this.prisma.unscoped.$transaction(async (tx) => {
      await this.usage.assertCapacityWithinTransaction(tx, 'users', tenantId);
      const user = existingUser
        ? { id: existingUser.id, email: existingUser.email, displayName: existingUser.displayName, active: existingUser.active, mustChangePassword: existingUser.mustChangePassword }
        : await tx.user.create({ data: { email, displayName, passwordHash: passwordHash!, mustChangePassword: true }, select: { id: true, email: true, displayName: true, active: true, mustChangePassword: true } });
      const membership = await tx.membership.create({ data: { tenantId, userId: user.id, role: role as UserRole, status: 'ACTIVE' } });
      await tx.unitMembership.createMany({ data: unitIds.map((unitId) => ({ tenantId, membershipId: membership.id, unitId })) });
      const action = existingUser ? 'PLATFORM_CLINIC_MEMBER_LINKED' : 'PLATFORM_CLINIC_MEMBER_CREATED';
      await tx.auditEvent.createMany({ data: [
        { actorUserId: actor.userId, action, entityType: 'Membership', entityId: membership.id, metadata: { tenantId, ...metadata } },
        { tenantId, actorUserId: actor.userId, action, entityType: 'Membership', entityId: membership.id, metadata },
      ] });
      return { id: membership.id, role: membership.role, status: membership.status, unitIds, accountReused: Boolean(existingUser), user };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async resetTenantMemberPassword(tenantId: string, membershipId: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    this.assertUuid(tenantId, 'Clínica'); this.assertUuid(membershipId, 'Usuário');
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
    const target = await this.prisma.unscoped.membership.findUnique({ where: { tenantId_id: { tenantId, id: membershipId } }, select: { id: true, role: true, status: true, userId: true, user: { select: { id: true, active: true, passwordHash: true, platformAdminIdentity: { select: { userId: true } } } } } });
    if (!target || target.role === 'PLATFORM_SUPERADMIN' || target.user.platformAdminIdentity) throw new NotFoundException('Usuário clínico não encontrado.');
    if (target.status !== 'ACTIVE' || !target.user.active) throw new ConflictException('Ative o acesso antes de redefinir a senha.');
    const passwordHash = await this.auth.hashPassword(input.password);
    if (await this.auth.passwordMatches(input.password, target.user.passwordHash)) throw new BadRequestException('A senha provisória deve ser diferente da senha atual.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({ where: { id: target.userId, passwordHash: target.user.passwordHash, active: true }, data: { passwordHash, mustChangePassword: true } });
      if (!changed.count) throw new ConflictException('A senha foi alterada em outra operação. Atualize a tela e tente novamente.');
      const sessions = await tx.authSession.updateMany({ where: { userId: target.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.passwordRecoveryToken.updateMany({ where: { userId: target.userId, usedAt: null }, data: { usedAt: new Date() } });
      const metadata = { membershipId, mustChangePassword: true, sessionsRevoked: sessions.count, passwordReset: true, reason: reason || null };
      await tx.auditEvent.createMany({ data: [
        { actorUserId: actor.userId, action: 'PLATFORM_CLINIC_PASSWORD_RESET', entityType: 'User', entityId: target.userId, metadata: { tenantId, ...metadata } },
        { tenantId, actorUserId: actor.userId, action: 'PLATFORM_CLINIC_PASSWORD_RESET', entityType: 'User', entityId: target.userId, metadata },
      ] });
      return { membershipId, sessionsRevoked: sessions.count, mustChangePassword: true };
    });
  }
  async updateTenantMember(tenantId: string, membershipId: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    this.assertUuid(tenantId, 'Clínica'); this.assertUuid(membershipId, 'Usuário');
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
    if (input.role !== undefined && !['TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR'].includes(input.role as string)) throw new BadRequestException('Papel inválido. Superadmin não pode ser atribuído a uma clínica.');
    if (input.status !== undefined && !['ACTIVE', 'DISABLED'].includes(input.status as string)) throw new BadRequestException('Status inválido.');
    if (input.unitIds !== undefined && (!Array.isArray(input.unitIds) || input.unitIds.some((id) => typeof id !== 'string'))) throw new BadRequestException('Lista de unidades inválida.');
    const unitIds = input.unitIds === undefined ? undefined : [...new Set(input.unitIds as string[])];
    if (unitIds && !unitIds.length) throw new BadRequestException('Selecione ao menos uma unidade ativa.');
    const target = await this.prisma.unscoped.membership.findUnique({ where: { tenantId_id: { tenantId, id: membershipId } }, include: { user: { select: { id: true, platformAdminIdentity: { select: { userId: true } } } }, unitScopes: { select: { unitId: true } } } });
    if (!target || target.role === 'PLATFORM_SUPERADMIN' || target.user.platformAdminIdentity) throw new NotFoundException('Usuário clínico não encontrado.');
    if (unitIds) {
      const activeUnits = await this.prisma.unscoped.unit.findMany({ where: { tenantId, id: { in: unitIds }, active: true }, select: { id: true } });
      if (activeUnits.length !== unitIds.length) throw new BadRequestException('Uma ou mais unidades não pertencem à clínica ou estão inativas.');
    }
    if (input.displayName !== undefined) {
      const displayName = this.text(input.displayName, 'Nome', 120);
      if (displayName.length < 2) throw new BadRequestException('Nome deve ter ao menos 2 caracteres.');
      input.displayName = displayName;
    }
    const nextRole = input.role as UserRole | undefined;
    const nextStatus = input.status as 'ACTIVE' | 'DISABLED' | undefined;
    return this.prisma.unscoped.$transaction(async (tx) => {
      if (target.status === 'ACTIVE' && (nextStatus === 'DISABLED' || (nextRole !== undefined && nextRole !== 'TENANT_ADMIN')) && target.role === 'TENANT_ADMIN') {
        const otherAdmins = await tx.membership.count({ where: { tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE', id: { not: target.id } } });
        if (otherAdmins === 0) throw new ConflictException('A clínica precisa manter ao menos um administrador ativo.');
      }
      const changed = await tx.membership.update({ where: { tenantId_id: { tenantId, id: target.id } }, data: { ...(nextRole ? { role: nextRole } : {}), ...(nextStatus ? { status: nextStatus } : {}) }, select: { id: true, role: true, status: true } });
      const priorUnitIds = new Set(target.unitScopes.map(({ unitId }) => unitId));
      const unitsChanged = unitIds !== undefined && (unitIds.length !== priorUnitIds.size || unitIds.some((id) => !priorUnitIds.has(id)));
      if (unitsChanged && unitIds) {
        await tx.unitMembership.deleteMany({ where: { tenantId, membershipId } });
        await tx.unitMembership.createMany({ data: unitIds.map((unitId) => ({ tenantId, membershipId, unitId })) });
      }
      if (input.displayName !== undefined) await tx.user.update({ where: { id: target.userId }, data: { displayName: input.displayName as string } });
      const permissionsChanged = Boolean((nextRole && nextRole !== target.role) || (nextStatus && nextStatus !== target.status) || unitsChanged);
      const sessions = permissionsChanged ? await tx.authSession.updateMany({ where: { tenantId, membershipId, revokedAt: null }, data: { revokedAt: new Date() } }) : { count: 0 };
      const metadata = { changedRole: nextRole && nextRole !== target.role ? nextRole : null, status: nextStatus && nextStatus !== target.status ? nextStatus : null, unitIds: unitsChanged ? unitIds : null, displayNameChanged: input.displayName !== undefined, sessionsRevoked: sessions.count, reason };
      await tx.auditEvent.createMany({ data: [
        { actorUserId: actor.userId, action: 'PLATFORM_CLINIC_MEMBER_UPDATED', entityType: 'Membership', entityId: membershipId, metadata: { tenantId, ...metadata } },
        { tenantId, actorUserId: actor.userId, action: 'PLATFORM_CLINIC_MEMBER_UPDATED', entityType: 'Membership', entityId: membershipId, metadata },
      ] });
      return { ...changed, unitIds: unitIds ?? target.unitScopes.map(({ unitId }) => unitId), sessionsRevoked: sessions.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async recoverTenantMember(tenantId: string, membershipId: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    this.assertUuid(tenantId, 'Clínica'); this.assertUuid(membershipId, 'Usuário');
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
    if (!['IN_PERSON', 'VERIFIED_CALLBACK', 'SUPERVISOR_REVIEW'].includes(input.identityVerification as string)) throw new BadRequestException('Registre o método de verificação da identidade.');
    const member = await this.prisma.unscoped.membership.findUnique({ where: { tenantId_id: { tenantId, id: membershipId } }, select: { id: true, status: true, role: true, user: { select: { id: true, email: true, active: true, platformAdminIdentity: { select: { userId: true } } } } } });
    if (!member || member.status !== 'ACTIVE' || !member.user.active || member.role === 'PLATFORM_SUPERADMIN' || member.user.platformAdminIdentity) throw new NotFoundException('Usuário clínico ativo não encontrado.');
    const tenant = await this.prisma.unscoped.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
    if (!tenant || !['ACTIVE', 'TRIAL'].includes(tenant.status)) throw new ConflictException('A clínica precisa estar ativa para emitir recuperação de senha.');
    const token = randomBytes(32).toString('base64url');
    const now = new Date(), expiresAt = new Date(now.getTime() + 20 * 60_000);
    await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.passwordRecoveryToken.updateMany({ where: { tenantId, userId: member.user.id, usedAt: null }, data: { usedAt: now } });
      const recovery = await tx.passwordRecoveryToken.create({ data: { tenantId, userId: member.user.id, createdById: actor.userId, tokenHash: this.auth.hash(token), expiresAt } });
      const metadata = { membershipId, verification: input.identityVerification as string, reason, expiresAt: expiresAt.toISOString(), oneTime: true };
      await tx.auditEvent.createMany({ data: [
        { actorUserId: actor.userId, action: 'PLATFORM_CLINIC_PASSWORD_RECOVERY_ISSUED', entityType: 'PasswordRecoveryToken', entityId: recovery.id, metadata: { tenantId, ...metadata } },
        { tenantId, actorUserId: actor.userId, action: 'PLATFORM_CLINIC_PASSWORD_RECOVERY_ISSUED', entityType: 'PasswordRecoveryToken', entityId: recovery.id, metadata },
      ] });
    });
    return { token, email: member.user.email, tenantId, expiresAt, delivery: 'ONE_TIME_LOCAL_HANDOFF' };
  }
  async revokeTenantMemberSessions(tenantId: string, membershipId: string, input: Record<string, unknown>) {
    const actor = await this.scope();
    this.assertUuid(tenantId, 'Clínica'); this.assertUuid(membershipId, 'Usuário');
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
    const member = await this.prisma.unscoped.membership.findUnique({ where: { tenantId_id: { tenantId, id: membershipId } }, select: { id: true, role: true, user: { select: { platformAdminIdentity: { select: { userId: true } } } } } });
    if (!member || member.role === 'PLATFORM_SUPERADMIN' || member.user.platformAdminIdentity) throw new NotFoundException('Usuário clínico não encontrado.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const result = await tx.authSession.updateMany({ where: { tenantId, membershipId, revokedAt: null }, data: { revokedAt: new Date() } });
      const metadata = { reason, sessionsRevoked: result.count };
      await tx.auditEvent.createMany({ data: [
        { actorUserId: actor.userId, action: 'PLATFORM_CLINIC_MEMBER_SESSIONS_REVOKED', entityType: 'Membership', entityId: membershipId, metadata: { tenantId, ...metadata } },
        { tenantId, actorUserId: actor.userId, action: 'PLATFORM_CLINIC_MEMBER_SESSIONS_REVOKED', entityType: 'Membership', entityId: membershipId, metadata },
      ] });
      return { membershipId, revoked: result.count };
    });
  }
  private assertUuid(value: string, label: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException(`${label} inválida.`); }
  private async auditRead(actorUserId: string, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown>) { await this.prisma.unscoped.auditEvent.create({ data: { actorUserId, action, entityType, entityId, metadata: metadata as Prisma.InputJsonObject } }); }
  private async lockTenantLimitRows(tx: Prisma.TransactionClient, tenantId: string, cycleStartsAt: Date) {
    const locks = [
      `${tenantId}:campaigns:${cycleStartsAt.toISOString()}`, `${tenantId}:messages:${cycleStartsAt.toISOString()}`,
      ...['activeAutomations', 'connections', 'patients', 'units', 'users'].map((metric) => `${tenantId}:capacity:${metric}`),
    ].sort();
    for (const key of locks) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
  private text(value: unknown, key: string, max: number) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(`${key} obrigatório (máximo ${max}).`); return value.trim(); }
  private slug(value: unknown) { const result = this.text(value, 'slug', 80).toLowerCase(); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) throw new BadRequestException('Identificador aceita letras minúsculas, números e hífens.'); return result; }
  private slugFrom(value: string) { const slug = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); return this.slug(slug); }
  private integer(value: unknown, key: string, min: number, max: number) { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new BadRequestException(`${key} deve estar entre ${min} e ${max}.`); return value as number; }
}
