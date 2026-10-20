import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext, type TenantScope } from '../security/tenant-context.js';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}

  private scope(): TenantScope {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    return scope;
  }

  private async allowedUnits(scope: TenantScope) {
    if (scope.role === 'TENANT_ADMIN' || scope.role === 'PLATFORM_SUPERADMIN') return null;
    return (await this.prisma.scoped.unitMembership.findMany({ where: { membershipId: scope.membershipId }, select: { unitId: true } })).map((row) => row.unitId);
  }

  async list(query: { unitId?: string; assigneeId?: string; status?: string; appointmentId?: string } = {}) {
    const scope = this.scope();
    const allowed = await this.allowedUnits(scope);
    if (query.unitId && allowed && !allowed.includes(query.unitId)) throw new ForbiddenException('Unidade fora do escopo.');
    if (query.status && !Object.values(TaskStatus).includes(query.status as TaskStatus)) throw new BadRequestException('Status de tarefa inválido.');
    if (query.appointmentId) {
      const appointment = await this.prisma.scoped.appointment.findFirst({ where: { tenantId: scope.tenantId, id: query.appointmentId, ...(allowed ? { unitId: { in: allowed } } : {}) }, select: { id: true } });
      if (!appointment) throw new NotFoundException('Agendamento não encontrado.');
    }
    return this.prisma.scoped.task.findMany({
      where: {
        tenantId: scope.tenantId,
        ...(query.unitId ? { unitId: query.unitId } : allowed ? { unitId: { in: allowed } } : {}),
        ...(scope.role === 'OPERATOR' ? { assignedToId: scope.userId } : query.assigneeId ? { assignedToId: query.assigneeId } : {}),
        ...(query.status ? { status: query.status as TaskStatus } : {}),
        ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
      },
      include: {
        unit: { select: { id: true, name: true } },
        patient: { select: { id: true, fullName: true } },
        conversation: { select: { id: true, status: true, patientId: true } },
        appointment: { select: { id: true, status: true, startsAt: true, patientId: true } },
        assignee: { select: { id: true, displayName: true } },
        creator: { select: { id: true, displayName: true } },
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
  }

  async create(input: Record<string, unknown>) {
    const scope = this.scope();
    const unitId = this.text(input.unitId, 'Unidade', 36, 36);
    const title = this.text(input.title, 'Título', 2, 160);
    const description = this.optionalText(input.description, 2000);
    const patientId = this.optionalUuid(input.patientId, 'Paciente');
    const conversationId = this.optionalUuid(input.conversationId, 'Conversa');
    const appointmentId = this.optionalUuid(input.appointmentId, 'Agendamento');
    if (conversationId && (patientId || appointmentId)) throw new BadRequestException('Vincule a tarefa a uma conversa ou a um paciente/agendamento.');
    const assignedToId = this.optionalUuid(input.assignedToId, 'Responsável') ?? scope.userId;
    const priority = input.priority == null || input.priority === '' ? TaskPriority.NORMAL : this.enumValue(input.priority, TaskPriority, 'Prioridade');
    const dueAt = this.dateValue(input.dueAt);
    const allowed = await this.allowedUnits(scope);
    if (allowed && !allowed.includes(unitId)) throw new ForbiddenException('Unidade fora do escopo.');
    if (scope.role === 'OPERATOR' && assignedToId !== scope.userId) throw new ForbiddenException('Operador só pode criar tarefa para si.');

    return this.prisma.unscoped.$transaction(async (tx) => {
      const unit = await tx.unit.findFirst({ where: { tenantId: scope.tenantId, id: unitId, active: true } });
      if (!unit) throw new BadRequestException('Unidade inválida.');
      await this.assertAssignee(tx, scope, assignedToId, unitId);
      if (patientId) {
        const patient = await tx.patient.findFirst({ where: { tenantId: scope.tenantId, id: patientId, deletedAt: null } });
        if (!patient || (patient.unitId && patient.unitId !== unitId)) throw new BadRequestException('Paciente inválido para esta unidade.');
      }
      if (appointmentId) {
        const appointment = await tx.appointment.findFirst({ where: { tenantId: scope.tenantId, id: appointmentId, unitId } });
        if (!appointment || (patientId && appointment.patientId !== patientId)) throw new BadRequestException('Agendamento inválido para esta unidade ou paciente.');
      }
      if (conversationId) {
        const conversation = await tx.conversation.findFirst({ where: { tenantId: scope.tenantId, id: conversationId, unitId } });
        if (!conversation) throw new BadRequestException('Conversa inválida para esta unidade.');
      }
      const linkedPatientId = patientId ?? (appointmentId ? (await tx.appointment.findFirstOrThrow({ where: { tenantId: scope.tenantId, unitId, id: appointmentId }, select: { patientId: true } })).patientId : null);
      const task = await tx.task.create({ data: { tenantId: scope.tenantId, unitId, patientId: linkedPatientId, appointmentId, conversationId, title, description, assignedToId, createdById: scope.userId, priority, dueAt } });
      await tx.taskHistory.create({ data: { tenantId: scope.tenantId, taskId: task.id, actorUserId: scope.userId, action: 'CREATED', after: this.snapshot(task) } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'TASK_CREATED', entityType: 'Task', entityId: task.id } });
      return task;
    });
  }

  async update(id: string, input: Record<string, unknown>) {
    const scope = this.scope();
    const allowed = await this.allowedUnits(scope);
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Task" WHERE "tenantId" = ${scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const current = await tx.task.findFirst({ where: { tenantId: scope.tenantId, id, ...(allowed ? { unitId: { in: allowed } } : {}) } });
      if (!current) throw new NotFoundException('Tarefa não encontrada.');
      this.assertCanManage(scope, current.assignedToId, current.unitId);
      const data: Prisma.TaskUpdateInput = {};
      if (input.title !== undefined) data.title = this.text(input.title, 'Título', 2, 160);
      if (input.description !== undefined) data.description = this.optionalText(input.description, 2000);
      if (input.priority !== undefined) data.priority = this.enumValue(input.priority, TaskPriority, 'Prioridade');
      if (input.dueAt !== undefined) data.dueAt = this.dateValue(input.dueAt);
      if (input.assignedToId !== undefined) {
        const assigneeId = this.optionalUuid(input.assignedToId, 'Responsável');
        if (!assigneeId) throw new BadRequestException('Tarefa precisa ter um responsável.');
        if (scope.role === 'OPERATOR' && assigneeId !== scope.userId) throw new ForbiddenException('Operador não pode transferir tarefa.');
        await this.assertAssignee(tx, scope, assigneeId, current.unitId);
        data.assignee = { connect: { id: assigneeId } };
      }
      const updated = await tx.task.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data });
      await tx.taskHistory.create({ data: { tenantId: scope.tenantId, taskId: id, actorUserId: scope.userId, action: 'UPDATED', before: this.snapshot(current), after: this.snapshot(updated) } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'TASK_UPDATED', entityType: 'Task', entityId: id } });
      return updated;
    });
  }

  async changeStatus(id: string, value: unknown) {
    const scope = this.scope();
    const status = this.enumValue(value, TaskStatus, 'Status');
    const allowed = await this.allowedUnits(scope);
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Task" WHERE "tenantId" = ${scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const current = await tx.task.findFirst({ where: { tenantId: scope.tenantId, id, ...(allowed ? { unitId: { in: allowed } } : {}) } });
      if (!current) throw new NotFoundException('Tarefa não encontrada.');
      this.assertCanManage(scope, current.assignedToId, current.unitId);
      const completedAt = status === TaskStatus.DONE ? new Date() : null;
      const updated = await tx.task.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data: { status, completedAt } });
      await tx.taskHistory.create({ data: { tenantId: scope.tenantId, taskId: id, actorUserId: scope.userId, action: 'STATUS_CHANGED', before: { status: current.status }, after: { status, completedAt } } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'TASK_STATUS_CHANGED', entityType: 'Task', entityId: id, metadata: { from: current.status, to: status } } });
      return updated;
    });
  }

  async history(id: string) {
    const scope = this.scope();
    const allowed = await this.allowedUnits(scope);
    const task = await this.prisma.scoped.task.findFirst({ where: { id, ...(allowed ? { unitId: { in: allowed } } : {}), ...(scope.role === 'OPERATOR' ? { assignedToId: scope.userId } : {}) }, select: { id: true } });
    if (!task) throw new NotFoundException('Tarefa não encontrada.');
    return this.prisma.scoped.taskHistory.findMany({ where: { taskId: id }, include: { actor: { select: { id: true, displayName: true } } }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
  }

  private assertCanManage(scope: TenantScope, assignedToId: string, _unitId: string) {
    if (scope.role === 'OPERATOR' && assignedToId !== scope.userId) throw new ForbiddenException('Tarefa atribuída a outra pessoa.');
  }

  private async assertAssignee(tx: Prisma.TransactionClient, scope: TenantScope, userId: string, unitId: string) {
    const membership = await tx.membership.findFirst({ where: { tenantId: scope.tenantId, userId, status: 'ACTIVE', user: { active: true } }, select: { role: true, unitScopes: { where: { unitId }, select: { unitId: true } } } });
    if (!membership || (!['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'].includes(membership.role) && !membership.unitScopes.length)) throw new BadRequestException('Responsável sem acesso ativo à unidade.');
  }

  private snapshot(value: { id: string; unitId: string; patientId: string | null; conversationId: string | null; title: string; description: string | null; assignedToId: string; priority: TaskPriority; dueAt: Date | null; status: TaskStatus; completedAt: Date | null }) {
    return { id: value.id, unitId: value.unitId, patientId: value.patientId, conversationId: value.conversationId, title: value.title, description: value.description, assignedToId: value.assignedToId, priority: value.priority, dueAt: value.dueAt?.toISOString() ?? null, status: value.status, completedAt: value.completedAt?.toISOString() ?? null };
  }

  private text(value: unknown, label: string, min: number, max: number) { if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new BadRequestException(`${label} inválido.`); return value.trim(); }
  private optionalText(value: unknown, max: number) { if (value == null || value === '') return null; if (typeof value !== 'string' || value.trim().length > max) throw new BadRequestException('Descrição inválida.'); return value.trim() || null; }
  private optionalUuid(value: unknown, label: string): string | null { if (value == null || value === '') return null; if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException(`${label} inválido.`); return value; }
  private dateValue(value: unknown): Date | null { if (value == null || value === '') return null; const date = new Date(String(value)); if (Number.isNaN(date.getTime())) throw new BadRequestException('Prazo inválido.'); return date; }
  private enumValue<T extends Record<string, string>>(value: unknown, values: T, label: string): T[keyof T] { if (typeof value !== 'string' || !Object.values(values).includes(value)) throw new BadRequestException(`${label} inválido.`); return value as T[keyof T]; }
}
