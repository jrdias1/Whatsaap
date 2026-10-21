import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { AutomationsService } from '../automations/automations.service.js';
import { ReferralsService } from '../referrals/referrals.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { SchedulingRulesService } from './scheduling-rules.service.js';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
    private readonly automations: AutomationsService,
    private readonly referrals: ReferralsService,
    private readonly schedulingRules: SchedulingRulesService,
    private readonly reports: ReportsService,
  ) {}
  private scope() {
    const s = this.context.current();
    if (!s) throw new ForbiddenException('Tenant obrigatório.');
    return s;
  }
  private async units() {
    const s = this.scope();
    if (s.role === 'TENANT_ADMIN' || s.role === 'PLATFORM_SUPERADMIN')
      return null;
    return (
      await this.prisma.scoped.unitMembership.findMany({
        where: { membershipId: s.membershipId },
        select: { unitId: true },
      })
    ).map((x) => x.unitId);
  }
  async list(from?: string, to?: string, filters: { unitId?: string; status?: string; search?: string; resourceId?: string } = {}) {
    const s = this.scope();
    const allowed = await this.units();
    const start = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
    const end = to ? new Date(to) : new Date(Date.now() + 30 * 86400000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw new BadRequestException('O intervalo de datas é inválido.');
    if (filters.status && !Object.values(AppointmentStatus).includes(filters.status as AppointmentStatus)) throw new BadRequestException('O status do agendamento é inválido.');
    if (filters.unitId && allowed && !allowed.includes(filters.unitId)) throw new ForbiddenException('A unidade está fora do seu escopo.');
    const appointments = await this.prisma.scoped.appointment.findMany({
      where: {
        tenantId: s.tenantId, startsAt: { lt: end }, endsAt: { gt: start },
        ...(filters.unitId ? { unitId: filters.unitId } : allowed ? { unitId: { in: allowed } } : {}),
        ...(filters.status ? { status: filters.status as AppointmentStatus } : {}),
        ...(filters.resourceId ? { resources: { some: { resourceId: filters.resourceId } } } : {}),
        ...(filters.search?.trim() ? { patient: { fullName: { contains: filters.search.trim().slice(0, 120), mode: 'insensitive' } } } : {}),
      },
        include: { patient: { select: { id: true, fullName: true, phone: true } }, unit: { select: { id: true, name: true } }, procedure: { select: { id: true, name: true, appointmentDurationMinutes: true } }, resources: { include: { resource: { select: { id: true, name: true, type: true, active: true } } } } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 1000,
    });
    return this.withOutsideHoursFlags(s.tenantId, appointments);
  }

  async get(id: string) {
    const scope = this.scope();
    const allowed = await this.units();
    const appointment = await this.prisma.scoped.appointment.findFirst({
      where: { tenantId: scope.tenantId, id, ...(allowed ? { unitId: { in: allowed } } : {}) },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, email: true } }, unit: { select: { id: true, name: true } },
        procedure: { select: { id: true, name: true, appointmentDurationMinutes: true } },
        resources: { include: { resource: { select: { id: true, name: true, type: true, active: true } } } },
        tasks: { where: { tenantId: scope.tenantId }, include: { assignee: { select: { id: true, displayName: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] },
        automationExecutions: { where: { tenantId: scope.tenantId }, include: { automation: { select: { id: true, name: true, trigger: true } }, satisfactionSurvey: { select: { id: true, state: true, classification: true, expiresAt: true, respondedAt: true } } }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }] },
        satisfactionSurveys: { where: { tenantId: scope.tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] },
      },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado.');
    const history = await this.prisma.scoped.auditEvent.findMany({ where: { tenantId: scope.tenantId, entityType: 'Appointment', entityId: id }, include: { actor: { select: { id: true, displayName: true } } }, orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }], take: 100 });
    const outboxIds = appointment.automationExecutions.map((row) => row.outboxMessageId).filter((id): id is string => Boolean(id));
    const outbox = outboxIds.length ? await this.prisma.scoped.outboxMessage.findMany({ where: { tenantId: scope.tenantId, id: { in: outboxIds } }, select: { id: true, status: true, purpose: true, suppressionReason: true, lastError: true } }) : [];
    const outboxById = new Map(outbox.map((row) => [row.id, row]));
    const createdBy = appointment.createdById ? await this.prisma.scoped.user.findFirst({ where: { id: appointment.createdById, memberships: { some: { tenantId: scope.tenantId } } }, select: { id: true, displayName: true } }) : null;
    const latestScheduleChange = history.find((event) => ['APPOINTMENT_CREATED', 'APPOINTMENT_RESCHEDULED'].includes(event.action));
    const outsideHoursOverride = (latestScheduleChange?.metadata as Record<string, unknown> | null)?.outsideHoursOverride === true;
    return { ...appointment, outsideHoursOverride, createdBy, history, automationExecutions: appointment.automationExecutions.map((row) => ({ ...row, outbox: row.outboxMessageId ? outboxById.get(row.outboxMessageId) ?? null : null })) };
  }

  async availability(input: { unitId?: string; procedureId?: string; startsAt?: string; durationMinutes?: string; resourceIds?: string[]; excludeAppointmentId?: string; allowOutsideHours?: boolean }) {
    const scope = this.scope();
    const unitId = input.unitId ?? '';
    const startsAt = new Date(input.startsAt ?? '');
    if (!unitId || Number.isNaN(startsAt.getTime())) throw new BadRequestException('Informe a unidade e um horário inicial válido.');
    const allowed = await this.units();
    if (allowed && !allowed.includes(unitId)) throw new ForbiddenException('A unidade está fora do seu escopo.');
    const unit = await this.prisma.scoped.unit.findFirst({ where: { tenantId: scope.tenantId, id: unitId, active: true }, select: { id: true } });
    if (!unit) throw new BadRequestException('A unidade informada é inválida.');
    const source = await this.agendaSource(scope.tenantId, unitId);
    if (source === 'UNO') return { unitId, sourceOfTruth: source, writable: false, available: false, reasonCode: 'UNO_NOT_SYNCHRONIZED', reason: 'A disponibilidade da agenda Uno não está sincronizada nesta tela. Encaminhe a solicitação à recepção.' };
    if (startsAt.getTime() <= Date.now()) {
      return { unitId, sourceOfTruth: source, writable: true, startsAt, available: false, reasonCode: 'PAST_TIME', reason: 'Escolha um horário futuro para criar ou reagendar o atendimento.' };
    }
    let duration = Number(input.durationMinutes ?? 30);
    if (input.procedureId) {
      const procedure = await this.prisma.scoped.procedure.findFirst({ where: { tenantId: scope.tenantId, id: input.procedureId, active: true, OR: [{ unitId }, { unitId: null }] }, select: { appointmentDurationMinutes: true } });
      if (!procedure) throw new BadRequestException('O procedimento não está disponível para esta unidade.');
      duration = procedure.appointmentDurationMinutes;
    }
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440) throw new BadRequestException('A duração deve ficar entre 5 e 1.440 minutos.');
    const endsAt = new Date(startsAt.getTime() + duration * 60000);
    const evaluated = await this.prisma.unscoped.$transaction((tx) => this.schedulingRules.evaluate(tx, { tenantId: scope.tenantId, unitId, startsAt, endsAt, resourceIds: input.resourceIds ?? [], procedureId: input.procedureId, excludeAppointmentId: input.excludeAppointmentId, allowOutsideHours: input.allowOutsideHours === true }));
    return { unitId, sourceOfTruth: source, writable: true, startsAt, endsAt, durationMinutes: duration, available: evaluated.available, outsideHours: evaluated.outsideHours, reasonCode: evaluated.reason, reason: evaluated.reason ? this.reasonText(evaluated.reason) : null, resources: evaluated.resources };
  }
  async create(input: Record<string, unknown>) {
    const s = this.scope();
    const unitId = String(input.unitId || '');
    const patientId = String(input.patientId || '');
    const startsAt = new Date(String(input.startsAt || ''));
    const requestedEnd = input.endsAt ? new Date(String(input.endsAt)) : null;
    if (!unitId || !patientId || Number.isNaN(startsAt.getTime()) || (requestedEnd && Number.isNaN(requestedEnd.getTime()))) throw new BadRequestException('Informe unidade, paciente e horário inicial válidos.');
    if (startsAt.getTime() <= Date.now()) throw new BadRequestException('Escolha um horário futuro para criar o agendamento.');
    const allowed = await this.units();
    if (allowed && !allowed.includes(unitId)) throw new ForbiddenException('A unidade está fora do seu escopo.');
    const unit = await this.prisma.scoped.unit.findFirst({ where: { id: unitId, active: true } });
    const patient = await this.prisma.scoped.patient.findFirst({ where: { id: patientId, deletedAt: null } });
    if (!unit || !patient) throw new BadRequestException('A unidade ou o paciente não pertencem a esta clínica.');
    if (patient.unitId && patient.unitId !== unitId) throw new BadRequestException('O paciente pertence a outra unidade.');
    if (await this.agendaSource(s.tenantId, unitId) === 'UNO') throw new BadRequestException('Esta unidade usa a agenda Uno; o agendamento local está indisponível até a homologação.');
    const procedureId = input.procedureId ? String(input.procedureId) : null;
    const procedure = procedureId ? await this.prisma.scoped.procedure.findFirst({ where: { id: procedureId, active: true, OR: [{ unitId }, { unitId: null }] }, select: { id: true, appointmentDurationMinutes: true } }) : null;
    if (procedureId && !procedure) throw new BadRequestException('O procedimento é inválido para esta unidade.');
    const duration = procedure?.appointmentDurationMinutes ?? (requestedEnd ? Math.round((requestedEnd.getTime() - startsAt.getTime()) / 60000) : Number(input.durationMinutes ?? 30));
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440 || (requestedEnd && requestedEnd <= startsAt)) throw new BadRequestException('A duração do agendamento é inválida.');
    const endsAt = new Date(startsAt.getTime() + duration * 60000);
    const resourceIds = this.parseResourceIds(input.resourceIds);
    const allowOutsideHours = input.outsideHoursOverride === true;
    const created = await this.prisma.unscoped.$transaction(async (tx) => {
      await this.schedulingRules.lockUnit(tx, s.tenantId, unitId);
      if (startsAt.getTime() <= Date.now()) throw new BadRequestException('O horário escolhido já passou. Escolha um horário futuro.');
      const evaluated = await this.schedulingRules.evaluate(tx, { tenantId: s.tenantId, unitId, startsAt, endsAt, resourceIds, procedureId, allowOutsideHours });
      if (!evaluated.available) throw new BadRequestException(this.reasonText(evaluated.reason ?? 'UNIT_CONFLICT'));
      if (allowOutsideHours && !evaluated.outsideHours) throw new BadRequestException('A exceção de expediente não é necessária para este horário. Consulte a disponibilidade novamente.');
      const row = await tx.appointment.create({ data: { tenantId: s.tenantId, unitId, patientId, procedureId, startsAt, endsAt, createdById: s.userId, notes: typeof input.notes === 'string' ? input.notes.slice(0, 1000) : null } });
      if (resourceIds.length) await tx.appointmentResource.createMany({ data: resourceIds.map((resourceId) => ({ tenantId: s.tenantId, unitId, appointmentId: row.id, resourceId })) });
      await tx.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'APPOINTMENT_CREATED', entityType: 'Appointment', entityId: row.id, metadata: { unitId, patientId, procedureId, resourceIds, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), outsideHoursOverride: evaluated.outsideHours } } });
      return row;
    });
    await this.automations.appointmentChanged(created.id);
    return this.get(created.id);
  }
  async changeStatus(id: string, value: string) {
    const scope = this.scope();
    if (!Object.values(AppointmentStatus).includes(value as AppointmentStatus))
      throw new BadRequestException('Status inválido.');
    const allowed = await this.units();
    const found = await this.prisma.scoped.appointment.findFirst({
      where: { id, ...(allowed ? { unitId: { in: allowed } } : {}) },
    });
    if (!found) throw new NotFoundException('Agendamento não encontrado.');
    if (found.source !== 'NATIVE' || await this.agendaSource(found.tenantId, found.unitId) === 'UNO')
      throw new BadRequestException('Local changes are disabled for Uno-sourced appointments until homologation.');
    const transitions: Record<string, AppointmentStatus[]> = {
      PENDING: ['CONFIRMED', 'NO_SHOW', 'CANCELLED'],
      CONFIRMED: ['COMPLETED', 'NO_SHOW', 'CANCELLED'],
      COMPLETED: [],
      NO_SHOW: [],
      CANCELLED: [],
    };
    if (!transitions[found.status].includes(value as AppointmentStatus)) {
      throw new BadRequestException(
        `Transição inválida: ${found.status} → ${value}.`,
      );
    }
    const completionCheckAt = new Date();
    if (value === 'COMPLETED' && found.startsAt > completionCheckAt) {
      throw new BadRequestException('Não é possível concluir um atendimento antes do horário agendado.');
    }
    if (value === 'NO_SHOW' && found.endsAt > completionCheckAt) {
      throw new BadRequestException('Só é possível registrar falta depois do horário do atendimento.');
    }
    await this.prisma.unscoped.$transaction(async (tx) => {
      const updated = await tx.appointment.updateMany({
        where: {
          tenantId: found.tenantId,
          unitId: found.unitId,
          id,
          status: found.status,
          ...(value === 'COMPLETED' ? { startsAt: { lte: completionCheckAt } } : {}),
        },
        data: { status: value as AppointmentStatus, ...(value === 'COMPLETED' ? { completedAt: new Date() } : {}) },
      });
      if (!updated.count)
        throw new BadRequestException(
          'O agendamento foi alterado por outra operação. Atualize e tente novamente.',
        );
      await tx.auditEvent.create({
        data: {
          tenantId: found.tenantId,
          actorUserId: scope.userId,
          action: 'APPOINTMENT_STATUS_CHANGED',
          entityType: 'Appointment',
          entityId: id,
          metadata: { from: found.status, to: value },
        },
      });
      if (value === 'CANCELLED') {
        const cancelledNps = await tx.npsSurvey.updateMany({ where: { tenantId: scope.tenantId, appointmentId: id, status: 'PLANNED' }, data: { status: 'CANCELLED' } });
        if (cancelledNps.count) await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'NPS_SURVEYS_CANCELLED_WITH_APPOINTMENT', entityType: 'Appointment', entityId: id, metadata: { count: cancelledNps.count, reason: 'APPOINTMENT_CANCELLED' } } });
      }
      if (value === 'COMPLETED') {
        await this.referrals.recordNativeAppointmentCompletion(tx, id, scope.userId);
        await this.reports.planNpsForCompletedAppointment(tx, scope.tenantId, id);
      }
    });
    await this.automations.appointmentChanged(id);
    return this.get(id);
  }

  async reschedule(id: string, input: Record<string, unknown>) {
    const scope = this.scope();
    const allowed = await this.units();
    const current = await this.prisma.scoped.appointment.findFirst({ where: { id, ...(allowed ? { unitId: { in: allowed } } : {}) }, include: { resources: { select: { resourceId: true } } } });
    if (!current) throw new NotFoundException('Agendamento não encontrado.');
    if (current.source !== 'NATIVE' || await this.agendaSource(current.tenantId, current.unitId) === 'UNO') throw new BadRequestException('Este agendamento é mantido pela Uno; reagendamento externo depende de homologação.');
    if (!['PENDING', 'CONFIRMED'].includes(current.status)) throw new BadRequestException('Somente agendamentos pendentes ou confirmados podem ser reagendados.');
    const startsAt = new Date(String(input.startsAt ?? ''));
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('O novo horário inicial é inválido.');
    if (startsAt.getTime() <= Date.now()) throw new BadRequestException('Escolha um horário futuro para reagendar o atendimento.');
    const procedure = current.procedureId ? await this.prisma.scoped.procedure.findFirst({ where: { tenantId: scope.tenantId, id: current.procedureId, active: true, OR: [{ unitId: current.unitId }, { unitId: null }] }, select: { appointmentDurationMinutes: true } }) : null;
    if (current.procedureId && !procedure) throw new BadRequestException('O procedimento não está mais disponível para esta unidade.');
    const duration = procedure?.appointmentDurationMinutes ?? Number(input.durationMinutes ?? Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60000));
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440) throw new BadRequestException('A duração do agendamento é inválida.');
    const endsAt = new Date(startsAt.getTime() + duration * 60000);
    const resourceIds = input.resourceIds === undefined ? current.resources.map((item) => item.resourceId) : this.parseResourceIds(input.resourceIds);
    const allowOutsideHours = input.outsideHoursOverride === true;
    await this.prisma.unscoped.$transaction(async (tx) => {
      await this.schedulingRules.lockUnit(tx, scope.tenantId, current.unitId);
      if (startsAt.getTime() <= Date.now()) throw new BadRequestException('O novo horário já passou. Escolha um horário futuro.');
      const evaluated = await this.schedulingRules.evaluate(tx, { tenantId: scope.tenantId, unitId: current.unitId, startsAt, endsAt, resourceIds, procedureId: current.procedureId, excludeAppointmentId: id, allowOutsideHours });
      if (!evaluated.available) throw new BadRequestException(this.reasonText(evaluated.reason ?? 'RESOURCE_CONFLICT'));
      if (allowOutsideHours && !evaluated.outsideHours) throw new BadRequestException('A exceção de expediente não é necessária para este horário. Consulte a disponibilidade novamente.');
      const updated = await tx.appointment.updateMany({ where: { tenantId: scope.tenantId, unitId: current.unitId, id, startsAt: current.startsAt, endsAt: current.endsAt, status: current.status }, data: { startsAt, endsAt } });
      if (!updated.count) throw new BadRequestException('O agendamento foi alterado por outra operação. Atualize e tente novamente.');
      await tx.appointmentResource.deleteMany({ where: { tenantId: scope.tenantId, unitId: current.unitId, appointmentId: id } });
      if (resourceIds.length) await tx.appointmentResource.createMany({ data: resourceIds.map((resourceId) => ({ tenantId: scope.tenantId, unitId: current.unitId, appointmentId: id, resourceId })) });
        const obsoleteNps = await tx.npsSurvey.updateMany({ where: { tenantId: scope.tenantId, appointmentId: id, status: 'PLANNED' }, data: { status: 'CANCELLED' } });
        if (obsoleteNps.count) await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'NPS_SURVEYS_CANCELLED_WITH_APPOINTMENT', entityType: 'Appointment', entityId: id, metadata: { count: obsoleteNps.count, reason: 'APPOINTMENT_RESCHEDULED' } } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'APPOINTMENT_RESCHEDULED', entityType: 'Appointment', entityId: id, metadata: { from: current.startsAt.toISOString(), to: startsAt.toISOString(), resourceIds, outsideHoursOverride: evaluated.outsideHours } } });
    });
    await this.automations.appointmentChanged(id);
    return this.get(id);
  }
  private parseResourceIds(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new BadRequestException('Lista de recursos inválida.');
    const ids = value.map((item) => (item as string).trim());
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Recurso duplicado no agendamento.');
    return ids;
  }

  private reasonText(reason: string) {
    const messages: Record<string, string> = {
      UNIT_CONFLICT: 'Já existe um agendamento ocupando esse horário na unidade.',
      RESOURCE_CONFLICT: 'Um profissional, sala ou recurso selecionado já está reservado nesse horário.',
      RESOURCE_START_INTERVAL: 'O início não segue o intervalo configurado para um dos recursos selecionados. Escolha outro horário.',
      BLOCKED: 'O horário está bloqueado para a unidade ou para um recurso selecionado.',
      CLOSED_DATE: 'A unidade está fechada nesta data.',
      OUTSIDE_HOURS: 'O horário está fora do expediente configurado para a unidade.',
      CROSS_DAY: 'O atendimento precisa começar e terminar no mesmo dia de expediente.',
    };
    return messages[reason] ?? 'O horário não está disponível.';
  }
  private async withOutsideHoursFlags<T extends { id: string }>(tenantId: string, appointments: T[]) {
    if (!appointments.length) return appointments.map((appointment) => ({ ...appointment, outsideHoursOverride: false }));
    const events = await this.prisma.scoped.auditEvent.findMany({
      where: { tenantId, entityType: 'Appointment', entityId: { in: appointments.map((appointment) => appointment.id) }, action: { in: ['APPOINTMENT_CREATED', 'APPOINTMENT_RESCHEDULED'] } },
      select: { entityId: true, action: true, metadata: true, occurredAt: true }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    const latest = new Map<string, boolean>();
    for (const event of events) if (event.entityId && !latest.has(event.entityId)) latest.set(event.entityId, (event.metadata as Record<string, unknown> | null)?.outsideHoursOverride === true);
    return appointments.map((appointment) => ({ ...appointment, outsideHoursOverride: latest.get(appointment.id) ?? false }));
  }
  private async agendaSource(tenantId: string, unitId: string): Promise<'NATIVE' | 'UNO'> {
    const config = await this.prisma.scoped.unoConnection.findUnique({ where: { tenantId_unitId: { tenantId, unitId } }, select: { sourceOfTruth: true } });
    return config?.sourceOfTruth === 'UNO' ? 'UNO' : 'NATIVE';
  }
}
