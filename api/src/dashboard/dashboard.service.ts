import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}

  async overview(unitId?: string) {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    let allowed: string[] | null = null;
    if (!['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'].includes(scope.role)) {
      allowed = (await this.prisma.scoped.unitMembership.findMany({ where: { membershipId: scope.membershipId }, select: { unitId: true } })).map((row) => row.unitId);
    }
    if (unitId) {
      const unit = await this.prisma.scoped.unit.findFirst({ where: { id: unitId, tenantId: scope.tenantId }, select: { id: true } });
      if (!unit || (allowed && !allowed.includes(unitId))) throw new ForbiddenException('Unidade fora do escopo.');
    }
    const unitFilter = unitId ? [unitId] : allowed;
    const now = new Date();
    const localParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const p = Object.fromEntries(localParts.map(({ type, value }) => [type, value]));
    const dayStart = new Date(`${p.year}-${p.month}-${p.day}T03:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const unitsWhere = unitFilter ? { unitId: { in: unitFilter } } : {};
    const [appointments, appointmentsToday, confirmed, pending, activePatients, waitingConversations, openTasks, overdueTasks, failedOutbox, tenant, units, pendingNpsFollowups, plannedNps] = await Promise.all([
      this.prisma.scoped.appointment.findMany({ where: { tenantId: scope.tenantId, ...unitsWhere, startsAt: { gte: dayStart, lt: dayEnd }, status: { notIn: ['CANCELLED'] } }, include: { patient: { select: { id: true, fullName: true } }, procedure: { select: { name: true } }, resources: { include: { resource: { select: { name: true, type: true } } } }, unit: { select: { id: true, name: true } } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 12 }),
      this.prisma.scoped.appointment.count({ where: { tenantId: scope.tenantId, ...unitsWhere, startsAt: { gte: dayStart, lt: dayEnd }, status: { not: 'CANCELLED' } } }),
      this.prisma.scoped.appointment.count({ where: { tenantId: scope.tenantId, ...unitsWhere, startsAt: { gte: dayStart, lt: dayEnd }, status: 'CONFIRMED' } }),
      this.prisma.scoped.appointment.count({ where: { tenantId: scope.tenantId, ...unitsWhere, startsAt: { gte: dayStart, lt: dayEnd }, status: 'PENDING' } }),
      this.prisma.scoped.patient.count({ where: { tenantId: scope.tenantId, active: true, deletedAt: null, ...(unitFilter ? { OR: [{ unitId: { in: unitFilter } }, { unitId: null }] } : {}) } }),
      this.prisma.scoped.conversation.count({ where: { tenantId: scope.tenantId, ...unitsWhere, status: 'WAITING_HUMAN' } }),
      this.prisma.scoped.task.count({ where: { tenantId: scope.tenantId, ...unitsWhere, status: { in: ['TODO', 'IN_PROGRESS'] }, ...(scope.role === 'OPERATOR' ? { assignedToId: scope.userId } : {}) } }),
      this.prisma.scoped.task.count({ where: { tenantId: scope.tenantId, ...unitsWhere, status: { in: ['TODO', 'IN_PROGRESS'] }, dueAt: { lt: now }, ...(scope.role === 'OPERATOR' ? { assignedToId: scope.userId } : {}) } }),
      this.prisma.scoped.outboxMessage.count({ where: { tenantId: scope.tenantId, status: 'FAILED', ...(unitFilter ? { patient: { unitId: { in: unitFilter } } } : {}) } }),
      this.prisma.scoped.tenant.findUnique({ where: { id: scope.tenantId }, select: { name: true } }),
      this.prisma.scoped.unit.findMany({ where: { tenantId: scope.tenantId, active: true, ...(unitFilter ? { id: { in: unitFilter } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.scoped.task.count({ where: { tenantId: scope.tenantId, ...unitsWhere, title: { startsWith: 'Follow-up NPS:' }, status: { in: ['TODO', 'IN_PROGRESS'] }, ...(scope.role === 'OPERATOR' ? { assignedToId: scope.userId } : {}) } }),
      this.prisma.scoped.npsSurvey.count({ where: { tenantId: scope.tenantId, ...unitsWhere, status: 'PLANNED' } }),
    ]);
    return { clinicName: tenant?.name ?? 'Clínica', timezone: 'America/Sao_Paulo', dayStart: dayStart.toISOString(), dayEnd: dayEnd.toISOString(), selectedUnitId: unitId ?? null, units, metrics: { appointmentsToday, confirmedToday: confirmed, awaitingConfirmation: pending, activePatients, conversationsWaitingHuman: waitingConversations, openTasks, overdueTasks, failedOutbox, pendingNpsFollowups, plannedNpsSurveys: plannedNps }, appointments };
  }
}
