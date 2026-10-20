import { ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { resolvePlanLimits } from './plan-limits.js';

type Metric = 'messages' | 'campaigns';

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}

  private scope() {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    return scope;
  }

  private async subscription() {
    const s = this.scope();
    const subscription = await this.prisma.scoped.subscription.findUnique({ where: { tenantId: s.tenantId }, include: { plan: true } });
    if (!subscription || !subscription.plan.enabled || !['TRIAL', 'ACTIVE'].includes(subscription.status) || subscription.cycleStartsAt > new Date() || subscription.cycleEndsAt <= new Date()) {
      throw new ServiceUnavailableException('Tenant sem plano/ciclo ativo. O Superadmin precisa provisionar a assinatura antes de usar cotas.');
    }
    return subscription;
  }

  async summary() {
    const s = this.scope();
    const subscription = await this.subscription();
    const [patients, activeUsers, pendingInvites, units, connections, automations, messages, campaigns] = await Promise.all([
      this.prisma.scoped.patient.count({ where: { tenantId: s.tenantId, active: true, deletedAt: null } }),
      this.prisma.scoped.membership.count({ where: { tenantId: s.tenantId, status: 'ACTIVE' } }),
      this.prisma.scoped.userInvitation.count({ where: { tenantId: s.tenantId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
      this.prisma.scoped.unit.count({ where: { tenantId: s.tenantId, active: true } }),
      Promise.all([this.prisma.scoped.metaConnection.count({ where: { tenantId: s.tenantId } }), this.prisma.scoped.evolutionConnection.count({ where: { tenantId: s.tenantId } })]).then(([meta, evolution]) => meta + evolution),
      this.prisma.scoped.automation.count({ where: { tenantId: s.tenantId, status: 'ACTIVE' } }),
      this.prisma.scoped.usageEntry.aggregate({ where: { tenantId: s.tenantId, metric: 'messages', cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt }, _sum: { quantity: true } }),
      this.prisma.scoped.usageEntry.aggregate({ where: { tenantId: s.tenantId, metric: 'campaigns', cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt }, _sum: { quantity: true } }),
    ]);
    const { plan } = subscription;
    const limits = resolvePlanLimits(plan, subscription.limitOverrides);
    return {
      plan: { code: plan.code, name: plan.name, priceCents: plan.priceCents },
      cycle: { startsAt: subscription.cycleStartsAt, endsAt: subscription.cycleEndsAt, status: subscription.status },
      usage: {
        patients: { current: patients, limit: limits.patientLimit },
        users: { current: activeUsers, pendingInvitations: pendingInvites, limit: limits.userLimit },
        units: { current: units, limit: limits.unitLimit },
        whatsappConnections: { current: connections, limit: limits.connectionLimit, status: 'SERVER_MANAGED_QR_CONNECTIONS' },
        activeAutomations: { current: automations, limit: limits.activeAutomationLimit },
        messages: { current: messages._sum.quantity ?? 0, limit: limits.messageLimitPerCycle },
        campaigns: { current: campaigns._sum.quantity ?? 0, limit: limits.campaignLimitPerCycle },
      },
    };
  }

  async assertCapacityWithinTransaction(tx: Prisma.TransactionClient, metric: 'patients' | 'users' | 'units' | 'activeAutomations' | 'connections', tenantIdOverride?: string) {
    const tenantId = tenantIdOverride ?? this.scope().tenantId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:capacity:${metric}`}, 0))`;
    const subscription = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!subscription || !subscription.plan.enabled || !['TRIAL', 'ACTIVE'].includes(subscription.status) || subscription.cycleStartsAt > new Date() || subscription.cycleEndsAt <= new Date()) {
      throw new ServiceUnavailableException('Tenant sem plano/ciclo ativo. O Superadmin precisa provisionar a assinatura antes de usar cotas.');
    }
    let current = metric === 'patients'
      ? await tx.patient.count({ where: { tenantId, active: true, deletedAt: null } })
      : metric === 'users'
        ? await tx.membership.count({ where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } } })
        : metric === 'units'
          ? await tx.unit.count({ where: { tenantId, active: true } })
          : metric === 'activeAutomations'
            ? await tx.automation.count({ where: { tenantId, status: 'ACTIVE' } })
            : (await tx.metaConnection.count({ where: { tenantId } })) + (await tx.evolutionConnection.count({ where: { tenantId } }));
    if (metric === 'users') current += await tx.userInvitation.count({ where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } } });
    const effectiveLimits = resolvePlanLimits(subscription.plan, subscription.limitOverrides);
    const limits = { patients: effectiveLimits.patientLimit, users: effectiveLimits.userLimit, units: effectiveLimits.unitLimit, activeAutomations: effectiveLimits.activeAutomationLimit, connections: effectiveLimits.connectionLimit };
    const limit = limits[metric];
    if (limit !== null && current >= limit) throw new HttpException({ statusCode: 402, message: `Cota de ${metric} atingida (${current}/${limit}). Faça upgrade do plano.` }, 402);
  }

  async consume(metric: Metric, idempotencyKey: string, quantity = 1) {
    this.scope();
    if (!idempotencyKey || idempotencyKey.length > 180 || !Number.isInteger(quantity) || quantity < 1) throw new HttpException('Reserva de uso inválida.', 400);
    const subscription = await this.subscription();
    return this.prisma.unscoped.$transaction((tx) => this.consumeWithinTransaction(tx, metric, idempotencyKey, quantity, subscription));
  }

  async consumeWithinTransaction(tx: Prisma.TransactionClient, metric: Metric, idempotencyKey: string, quantity: number, knownSubscription?: Awaited<ReturnType<UsageService['subscription']>>) {
    const s = this.scope();
    if (!idempotencyKey || idempotencyKey.length > 180 || !Number.isInteger(quantity) || quantity < 1) throw new HttpException('Reserva de uso inválida.', 400);
    const observed = knownSubscription ?? await this.subscription();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${s.tenantId}:${metric}:${observed.cycleStartsAt.toISOString()}`}, 0))`;
    const subscription = await tx.subscription.findUnique({ where: { tenantId: s.tenantId }, include: { plan: true } });
    if (!subscription || !subscription.plan.enabled || !['TRIAL', 'ACTIVE'].includes(subscription.status) || subscription.cycleStartsAt > new Date() || subscription.cycleEndsAt <= new Date()) {
      throw new ServiceUnavailableException('Tenant sem plano/ciclo ativo. O Superadmin precisa provisionar a assinatura antes de usar cotas.');
    }
    const existing = await tx.usageEntry.findUnique({ where: { tenantId_metric_idempotencyKey: { tenantId: s.tenantId, metric, idempotencyKey } } });
    if (existing) return { reserved: true, duplicate: true };
    const current = await tx.usageEntry.aggregate({ where: { tenantId: s.tenantId, metric, cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt }, _sum: { quantity: true } });
    const effectiveLimits = resolvePlanLimits(subscription.plan, subscription.limitOverrides);
    const limit = metric === 'messages' ? effectiveLimits.messageLimitPerCycle : effectiveLimits.campaignLimitPerCycle;
    const used = current._sum.quantity ?? 0;
    if (used + quantity > limit) throw new HttpException({ statusCode: 402, message: `Cota de ${metric} do ciclo atingida (${used}/${limit}). Faça upgrade do plano.` }, 402);
    await tx.usageEntry.create({ data: { subscriptionId: subscription.id, tenantId: s.tenantId, metric, quantity, idempotencyKey, cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt } });
    return { reserved: true, duplicate: false, current: used + quantity, limit };
  }
}
