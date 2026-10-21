import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, TaskPriority } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DelayedError, Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { RedisCoordinatorService } from '../queue/redis-coordinator.service.js';
import { resolvePlanLimits } from '../usage/plan-limits.js';
import { UsageService } from '../usage/usage.service.js';
import { assertReadableMessageText } from '../common/message-text-integrity.js';

type SharedAutomationConfig = {
  unitId: string; procedureId?: string | null; advanceMinutes: number; allowedStartHour: number; allowedEndHour: number;
  provider: 'META_CLOUD' | 'EVOLUTION_BAILEYS'; connectionId?: string | null; responsibleUserId: string;
};
type ConfirmationConfig = SharedAutomationConfig & {
  body: string;
  confirmKeywords: string[]; rescheduleKeywords: string[]; humanKeywords: string[]; noResponseAction: 'NONE' | 'CREATE_TASK';
};
type SatisfactionConfig = SharedAutomationConfig & {
  opening: string; question: string; responseWindowHours: number; version: number;
  thankYou: Record<'EXCELLENT' | 'GOOD' | 'REGULAR' | 'POOR' | 'VERY_POOR', string>;
  regularAction: 'NONE' | 'CREATE_TASK'; noResponseAction: 'NONE' | 'CREATE_TASK';
};
type ProcedureReturnConfig = SharedAutomationConfig & {
  procedureId: string;
  body: string;
  responseWindowHours: number;
  maxContactsPerPatient: number;
  allowedDaysOfWeek: number[];
  interestKeywords: string[];
  rescheduleKeywords: string[];
  noContactKeywords: string[];
  noResponseAction: 'NONE' | 'CREATE_TASK';
};
type TagFlowStep = { id: string; delayMinutes: number; body: string };
type TagFlowConfig = SharedAutomationConfig & { targetTagId: string | null; steps: TagFlowStep[] };
type AppointmentMessageConfig = SharedAutomationConfig & { body: string };
type AutomationConfig = ConfirmationConfig | SatisfactionConfig | ProcedureReturnConfig | TagFlowConfig | AppointmentMessageConfig;
const AUTOMATION_TRIGGERS = ['APPOINTMENT_CONFIRMATION', 'APPOINTMENT_CONFIRMATION_FOLLOW_UP', 'APPOINTMENT_NO_SHOW', 'POST_CARE_SATISFACTION', 'PROCEDURE_RETURN', 'POST_CARE_TAG_FLOW'];
type ExecutionJob = { executionId: string; kind?: 'SEND' | 'NO_RESPONSE' };
const RETRY_LIMIT = 8;

@Injectable()
@Processor('automation-executions', { concurrency: 8 })
export class AutomationsService extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationsService.name);
  private timer?: NodeJS.Timeout;
  private nextScheduleRecoveryAt = 0;
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext, private readonly redis: RedisCoordinatorService, private readonly usage: UsageService, @InjectQueue('automation-executions') private readonly queue: Queue<ExecutionJob>) { super(); }

  private scope() { const scope = this.context.current(); if (!scope || scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Somente administrador pode configurar automações.'); return scope; }

  async listRules() {
    const scope = this.scope();
    const rules = await this.prisma.scoped.automation.findMany({ where: { tenantId: scope.tenantId }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] });
    return Promise.all(rules.map(async (rule) => {
      const [last, next] = await Promise.all([
        this.prisma.scoped.automationExecution.findFirst({ where: { tenantId: scope.tenantId, automationId: rule.id, status: { not: 'PENDING' } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], select: { status: true, executedAt: true, scheduledAt: true } }),
        this.prisma.scoped.automationExecution.findFirst({ where: { tenantId: scope.tenantId, automationId: rule.id, status: 'PENDING' }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], select: { scheduledAt: true } }),
      ]);
      const [total, pending, simulated, suppressed, failed, surveyResponses, taskCount] = await Promise.all([
        this.prisma.scoped.automationExecution.count({ where: { tenantId: scope.tenantId, automationId: rule.id } }),
        this.prisma.scoped.automationExecution.count({ where: { tenantId: scope.tenantId, automationId: rule.id, status: 'PENDING' } }),
        this.prisma.scoped.outboxMessage.count({ where: { tenantId: scope.tenantId, id: { in: await this.executionOutboxIds(scope.tenantId, rule.id) }, status: 'SIMULATED' } }),
        this.prisma.scoped.automationExecution.count({ where: { tenantId: scope.tenantId, automationId: rule.id, status: 'SUPPRESSED' } }),
        this.prisma.scoped.automationExecution.count({ where: { tenantId: scope.tenantId, automationId: rule.id, status: 'FAILED' } }),
        this.prisma.scoped.satisfactionSurvey.count({ where: { tenantId: scope.tenantId, automationId: rule.id, state: 'RESPONDED' } }),
        this.prisma.scoped.task.count({ where: { tenantId: scope.tenantId, automationId: rule.id } }),
      ]);
      return { ...rule, lastExecution: last, nextExecutionAt: next?.scheduledAt ?? null, metrics: { total, pending, simulated, suppressed, failed, surveyResponses, taskCount } };
    }));
  }

  async createRule(input: Record<string, unknown>) {
    const scope = this.scope();
    const name = this.text(input.name, 'Nome', 2, 120);
    if (!AUTOMATION_TRIGGERS.includes(String(input.trigger))) throw new BadRequestException('Gatilho de automação inválido.');
    const trigger = String(input.trigger);
    const config = this.config(input.configuration, trigger);
    await this.assertRuleReferences(scope.tenantId, config);
    const rule = await this.prisma.scoped.automation.create({ data: { tenantId: scope.tenantId, name, trigger, status: 'DRAFT', configuration: config as unknown as Prisma.InputJsonValue, createdById: scope.userId } });
    await this.prisma.scoped.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'AUTOMATION_CREATED', entityType: 'Automation', entityId: rule.id, metadata: { trigger: rule.trigger, unitId: config.unitId } } });
    return rule;
  }

  async updateRule(id: string, input: Record<string, unknown>) {
    const scope = this.scope();
    const current = await this.prisma.scoped.automation.findFirst({ where: { tenantId: scope.tenantId, id, trigger: { in: AUTOMATION_TRIGGERS } } });
    if (!current) throw new NotFoundException('Regra não encontrada.');
    const name = input.name === undefined ? current.name : this.text(input.name, 'Nome', 2, 120);
    const config = input.configuration === undefined ? current.configuration as AutomationConfig : this.config(input.configuration, current.trigger);
    if (current.trigger === 'POST_CARE_SATISFACTION' && input.configuration !== undefined) {
      const previous = current.configuration as SatisfactionConfig;
      const next = config as SatisfactionConfig;
      const contentChanged = previous.opening !== next.opening || previous.question !== next.question || JSON.stringify(previous.thankYou) !== JSON.stringify(next.thankYou);
      if (contentChanged && next.version <= previous.version) throw new BadRequestException('A versão da pesquisa deve aumentar quando abertura, pergunta ou agradecimentos forem alterados.');
    }
    await this.assertRuleReferences(scope.tenantId, config);
    const updated = await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Automation" WHERE "tenantId" = ${scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const row = await tx.automation.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data: { name, configuration: config as unknown as Prisma.InputJsonValue, status: 'DRAFT' } });
      await this.cancelExecutionsTx(tx, scope.tenantId, id, 'RULE_EDITED');
      return row;
    });
    await this.prisma.scoped.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'AUTOMATION_UPDATED', entityType: 'Automation', entityId: id, metadata: { status: 'DRAFT' } } });
    return updated;
  }

  async setRuleStatus(id: string, status: string) {
    const scope = this.scope();
    if (!['ACTIVE', 'PAUSED', 'DRAFT'].includes(status)) throw new BadRequestException('Status de regra inválido.');
    const rule = await this.prisma.scoped.automation.findFirst({ where: { tenantId: scope.tenantId, id, trigger: { in: AUTOMATION_TRIGGERS } } });
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    if (status === 'ACTIVE') {
      const config = rule.configuration as AutomationConfig;
      await this.assertRuleReferences(scope.tenantId, config);
      if (rule.trigger === 'APPOINTMENT_CONFIRMATION_FOLLOW_UP') {
        const confirmations = await this.prisma.scoped.automation.findMany({ where: { tenantId: scope.tenantId, trigger: 'APPOINTMENT_CONFIRMATION', status: 'ACTIVE' }, select: { configuration: true } });
        const hasMatchingConfirmation = confirmations.some((item) => {
          const confirmation = item.configuration as SharedAutomationConfig;
          return confirmation.unitId === config.unitId && (!confirmation.procedureId || confirmation.procedureId === config.procedureId);
        });
        if (!hasMatchingConfirmation) throw new BadRequestException('Ative primeiro uma regra de confirmação para a mesma filial e procedimento.');
      }
    }
    const updated = await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Automation" WHERE "tenantId" = ${scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const current = await tx.automation.findUnique({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, select: { status: true } });
      if (status === 'ACTIVE' && current?.status !== 'ACTIVE') await this.usage.assertCapacityWithinTransaction(tx, 'activeAutomations');
      const row = await tx.automation.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data: { status: status as 'ACTIVE' | 'PAUSED' | 'DRAFT' } });
      if (status !== 'ACTIVE') await this.cancelExecutionsTx(tx, scope.tenantId, id, 'RULE_PAUSED');
      return row;
    });
    await this.prisma.scoped.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: `AUTOMATION_${status}`, entityType: 'Automation', entityId: id, metadata: {} } });
    if (status === 'ACTIVE') await this.reconcileAppointmentSchedules(scope.tenantId);
    return updated;
  }

  async listExecutions(ruleId: string) {
    const scope = this.scope();
    const rule = await this.prisma.scoped.automation.findFirst({ where: { tenantId: scope.tenantId, id: ruleId, trigger: { in: AUTOMATION_TRIGGERS } }, select: { id: true } });
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    const rows = await this.prisma.scoped.automationExecution.findMany({ where: { tenantId: scope.tenantId, automationId: ruleId }, include: { appointment: { select: { id: true, startsAt: true, status: true, source: true } }, patient: { select: { id: true, fullName: true } } }, orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }], take: 200 });
    const ids = rows.map((row) => row.outboxMessageId).filter((id): id is string => Boolean(id));
    const outboxes = ids.length ? await this.prisma.scoped.outboxMessage.findMany({ where: { tenantId: scope.tenantId, id: { in: ids } }, select: { id: true, status: true, suppressionReason: true, lastError: true } }) : [];
    const outboxMap = new Map(outboxes.map((row) => [row.id, row]));
    const surveys = rows.length ? await this.prisma.scoped.satisfactionSurvey.findMany({ where: { tenantId: scope.tenantId, executionId: { in: rows.map((row) => row.id) } }, select: { id: true, executionId: true, version: true, state: true, classification: true, responseSource: true, respondedAt: true, expiresAt: true } }) : [];
    const surveyMap = new Map(surveys.map((row) => [row.executionId, row]));
    return rows.map((row) => ({ ...row, outbox: row.outboxMessageId ? outboxMap.get(row.outboxMessageId) ?? null : null, survey: surveyMap.get(row.id) ?? null }));
  }

  async satisfactionResults(ruleId: string) {
    const scope = this.scope();
    const rule = await this.prisma.scoped.automation.findFirst({ where: { tenantId: scope.tenantId, id: ruleId, trigger: 'POST_CARE_SATISFACTION' }, select: { id: true } });
    if (!rule) throw new NotFoundException('Regra de pesquisa não encontrada.');
    const counts = await this.prisma.scoped.satisfactionSurvey.groupBy({ by: ['classification'], where: { tenantId: scope.tenantId, automationId: ruleId, state: 'RESPONDED' }, _count: { _all: true } });
    const received = Object.fromEntries(['EXCELLENT', 'GOOD', 'REGULAR', 'POOR', 'VERY_POOR'].map((value) => [value, counts.find((item) => item.classification === value)?._count._all ?? 0]));
    const [total, pending, executionOutboxIds, surveyRows, executionSuppressed, surveySuppressed, executionFailed, surveyFailed, expired] = await Promise.all([
      this.prisma.scoped.automationExecution.count({ where: { tenantId: scope.tenantId, automationId: ruleId } }),
      this.prisma.scoped.automationExecution.count({ where: { tenantId: scope.tenantId, automationId: ruleId, status: 'PENDING' } }),
      this.executionOutboxIds(scope.tenantId, ruleId),
      this.prisma.scoped.satisfactionSurvey.findMany({ where: { tenantId: scope.tenantId, automationId: ruleId, state: 'OUTBOXED' }, select: { outboxMessageId: true } }),
      this.prisma.scoped.automationExecution.count({ where: { tenantId: scope.tenantId, automationId: ruleId, status: 'SUPPRESSED' } }),
      this.prisma.scoped.satisfactionSurvey.count({ where: { tenantId: scope.tenantId, automationId: ruleId, state: 'SUPPRESSED' } }),
      this.prisma.scoped.automationExecution.count({ where: { tenantId: scope.tenantId, automationId: ruleId, status: 'FAILED' } }),
      this.prisma.scoped.satisfactionSurvey.count({ where: { tenantId: scope.tenantId, automationId: ruleId, state: 'FAILED' } }),
      this.prisma.scoped.satisfactionSurvey.count({ where: { tenantId: scope.tenantId, automationId: ruleId, state: 'EXPIRED' } }),
    ]);
    const outboxIds = [...new Set([...executionOutboxIds, ...surveyRows.map((row) => row.outboxMessageId).filter((id): id is string => Boolean(id))])];
    const simulated = outboxIds.length ? await this.prisma.scoped.outboxMessage.count({ where: { tenantId: scope.tenantId, id: { in: outboxIds }, purpose: 'SATISFACTION_SURVEY', status: 'SIMULATED' } }) : 0;
    return { total, pending, simulated, suppressed: executionSuppressed + surveySuppressed, failed: executionFailed + surveyFailed, expired, received };
  }

  private async executionOutboxIds(tenantId: string, automationId: string) {
    return (await this.prisma.scoped.automationExecution.findMany({ where: { tenantId, automationId, outboxMessageId: { not: null } }, select: { outboxMessageId: true } })).map((row) => row.outboxMessageId!).filter(Boolean);
  }

  async appointmentChanged(appointmentId: string) {
    const appointment = await this.prisma.unscoped.appointment.findUnique({ where: { id: appointmentId }, include: { patient: { select: { active: true, deletedAt: true } } } });
    if (!appointment) return;
    await this.cancelAppointmentExecutions(appointment, 'APPOINTMENT_CHANGED');
    await this.ensureSchedules(appointment);
    await this.reconcileDueExecutions(appointment.tenantId);
  }

  private async ensureSchedules(appointment: { id: string; tenantId: string; unitId: string; patientId: string; procedureId: string | null; startsAt: Date; updatedAt: Date; completedAt: Date | null; status: string; source: string; patient: { active: boolean; deletedAt: Date | null } }, activeRules?: Array<{ id: string; tenantId: string; trigger?: string; configuration: Prisma.JsonValue; updatedAt?: Date }>) {
    if (!['PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(appointment.status) || !appointment.patient.active || appointment.patient.deletedAt) return;
    const rules = activeRules ?? await this.prisma.unscoped.automation.findMany({ where: { tenantId: appointment.tenantId, trigger: { in: AUTOMATION_TRIGGERS }, status: 'ACTIVE' } });
    for (const rule of rules) {
      const config = rule.configuration as AutomationConfig;
      if (config.unitId !== appointment.unitId || (config.procedureId && config.procedureId !== appointment.procedureId)) continue;
      const isSurvey = rule.trigger === 'POST_CARE_SATISFACTION';
      const isReturn = rule.trigger === 'PROCEDURE_RETURN';
      const isTagFlow = rule.trigger === 'POST_CARE_TAG_FLOW';
      const isNoShow = rule.trigger === 'APPOINTMENT_NO_SHOW';
      const isConfirmationFollowUp = rule.trigger === 'APPOINTMENT_CONFIRMATION_FOLLOW_UP';
      if (!isNoShow && !isConfirmationFollowUp && !['PENDING', 'CONFIRMED', 'COMPLETED'].includes(appointment.status)) continue;
      if (isNoShow && (appointment.status !== 'NO_SHOW' || appointment.source !== 'NATIVE' || (rule.updatedAt && appointment.updatedAt < rule.updatedAt))) continue;
      if (isConfirmationFollowUp && (appointment.status !== 'PENDING' || appointment.source !== 'NATIVE')) continue;
      if (isTagFlow && (appointment.status !== 'COMPLETED' || !appointment.completedAt || appointment.source !== 'NATIVE' || (rule.updatedAt && appointment.completedAt < rule.updatedAt))) continue;
      if (isTagFlow && (config as TagFlowConfig).targetTagId && !(await this.prisma.unscoped.patientTag.findFirst({ where: { tenantId: appointment.tenantId, patientId: appointment.patientId, tagId: (config as TagFlowConfig).targetTagId!, tag: { tenantId: appointment.tenantId } }, select: { tagId: true } }))) continue;
      if (isSurvey && (appointment.completedAt ?? appointment.updatedAt) < new Date(Date.now() - 30 * 86400000)) continue;
      if (isReturn && (appointment.status !== 'COMPLETED' || !appointment.completedAt || appointment.source !== 'NATIVE' || !appointment.procedureId || appointment.procedureId !== config.procedureId)) continue;
      if (!isReturn && !isTagFlow && !isNoShow && isSurvey !== (appointment.status === 'COMPLETED')) continue;
      if (isReturn && appointment.status !== 'COMPLETED') continue;
      let scheduledAt: Date | null;
      if (isNoShow) {
        scheduledAt = this.allowedContactTimeAfter(new Date(appointment.updatedAt.getTime() + config.advanceMinutes * 60_000), config.allowedStartHour, config.allowedEndHour);
      } else if (isConfirmationFollowUp) {
        const hasConfirmationRule = rules.some((candidate) => candidate.tenantId === appointment.tenantId && candidate.trigger === 'APPOINTMENT_CONFIRMATION' && (candidate.configuration as AutomationConfig).unitId === appointment.unitId && (!(candidate.configuration as AutomationConfig).procedureId || (candidate.configuration as AutomationConfig).procedureId === appointment.procedureId));
        if (!hasConfirmationRule) continue;
        scheduledAt = this.allowedContactTime(new Date(appointment.startsAt.getTime() - config.advanceMinutes * 60_000), appointment.startsAt, config.allowedStartHour, config.allowedEndHour);
      } else if (isReturn) {
        const procedure = await this.prisma.unscoped.procedure.findFirst({ where: { tenantId: appointment.tenantId, id: appointment.procedureId!, active: true, OR: [{ unitId: appointment.unitId }, { unitId: null }] }, select: { returnAfterDays: true, reminderAdvanceDays: true } });
        if (!procedure || procedure.returnAfterDays == null || procedure.reminderAdvanceDays == null || procedure.reminderAdvanceDays > procedure.returnAfterDays) {
          await this.prisma.unscoped.auditEvent.create({ data: { tenantId: appointment.tenantId, action: 'PROCEDURE_RETURN_MISSING_CONFIGURATION', entityType: 'Appointment', entityId: appointment.id, metadata: { procedureId: appointment.procedureId, automationId: rule.id } } });
          continue;
        }
        const delayDays = Math.max(0, procedure.returnAfterDays - procedure.reminderAdvanceDays);
        scheduledAt = this.allowedContactTimeAfter(new Date(appointment.completedAt!.getTime() + delayDays * 86400000), config.allowedStartHour, config.allowedEndHour, (config as ProcedureReturnConfig).allowedDaysOfWeek);
      } else if (isTagFlow) {
        const flow = config as TagFlowConfig;
        for (const step of flow.steps) {
          const stepAt = this.allowedContactTimeAfter(new Date(appointment.completedAt!.getTime() + step.delayMinutes * 60_000), flow.allowedStartHour, flow.allowedEndHour);
          if (!stepAt) continue;
          const idempotencyKey = `tag-post-care:${rule.id}:${appointment.id}:${step.id}`;
          await this.prisma.unscoped.automationExecution.createMany({ data: [{ tenantId: appointment.tenantId, unitId: appointment.unitId, automationId: rule.id, appointmentId: appointment.id, patientId: appointment.patientId, idempotencyKey, stepKey: step.id, status: 'PENDING', scheduledAt: stepAt }], skipDuplicates: true });
          await this.prisma.unscoped.automationExecution.updateMany({ where: { tenantId: appointment.tenantId, idempotencyKey, status: 'CANCELLED', outboxMessageId: null }, data: { status: 'PENDING', scheduledAt: stepAt, lastError: null, executedAt: null } });
        }
        continue;
      } else scheduledAt = isSurvey
        ? this.allowedContactTimeAfter(new Date((appointment.completedAt ?? appointment.updatedAt).getTime() + config.advanceMinutes * 60_000), config.allowedStartHour, config.allowedEndHour)
        : this.allowedContactTime(new Date(appointment.startsAt.getTime() - config.advanceMinutes * 60_000), appointment.startsAt, config.allowedStartHour, config.allowedEndHour);
      if (!scheduledAt) continue;
      const keyPrefix = isNoShow ? 'appointment-no-show' : isConfirmationFollowUp ? 'appointment-confirmation-follow-up' : isReturn ? 'procedure-return' : isSurvey ? 'satisfaction-survey' : 'appointment-confirmation';
      const idempotencyKey = `${keyPrefix}:${rule.id}:${appointment.id}:${isNoShow ? appointment.updatedAt.toISOString() : appointment.startsAt.toISOString()}`;
      await this.prisma.unscoped.automationExecution.createMany({ data: [{ tenantId: appointment.tenantId, unitId: appointment.unitId, automationId: rule.id, appointmentId: appointment.id, patientId: appointment.patientId, idempotencyKey, status: 'PENDING', scheduledAt }], skipDuplicates: true });
      await this.prisma.unscoped.automationExecution.updateMany({ where: { tenantId: appointment.tenantId, idempotencyKey, status: 'CANCELLED', outboxMessageId: null }, data: { status: 'PENDING', scheduledAt, lastError: null, executedAt: null } });
    }
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.reconcile().catch((error: unknown) => this.logger.error('Automation recovery failed', error)), 5000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async reconcile() {
    if (Date.now() >= this.nextScheduleRecoveryAt) {
      await this.reconcileAppointmentSchedules();
      this.nextScheduleRecoveryAt = Date.now() + 60_000;
    }
    await this.reconcileExpiredSurveys();
    return this.reconcileDueExecutions();
  }

  private async reconcileExpiredSurveys() {
    const rows = await this.prisma.unscoped.satisfactionSurvey.findMany({ where: { state: 'OUTBOXED', expiresAt: { lte: new Date() } }, include: { automation: { select: { configuration: true, createdById: true } } }, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], take: 250 });
    for (const survey of rows) await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SatisfactionSurvey" WHERE "tenantId" = ${survey.tenantId}::uuid AND id = ${survey.id}::uuid FOR UPDATE`;
      await this.expireSurvey(tx, survey);
    });
    return rows.length;
  }

  async reconcileAppointmentSchedules(tenantId?: string) {
    const rules = await this.prisma.unscoped.automation.findMany({ where: { ...(tenantId ? { tenantId } : {}), trigger: { in: AUTOMATION_TRIGGERS }, status: 'ACTIVE' } });
    if (!rules.length) return;
    const now = new Date();
    const returnProcedureIds = [...new Set(rules.filter((rule) => rule.trigger === 'PROCEDURE_RETURN').map((rule) => (rule.configuration as ProcedureReturnConfig).procedureId).filter((id): id is string => typeof id === 'string'))];
    const returnProcedures = returnProcedureIds.length
      ? await this.prisma.unscoped.procedure.findMany({ where: { ...(tenantId ? { tenantId } : {}), id: { in: returnProcedureIds }, active: true }, select: { returnAfterDays: true } })
      : [];
    const maxReturnDays = Math.max(30, ...returnProcedures.map((procedure) => procedure.returnAfterDays ?? 0));
    // Return reminders may be shifted by at most eight days to reach an allowed weekday/time.
    // Keep the survey fallback window at 30 days, but avoid rescanning a fixed ten-year history.
    const completedCutoff = new Date(now.getTime() - (maxReturnDays + 8) * 86400000);
    const surveyCutoff = new Date(now.getTime() - 30 * 86400000);
    const where: Prisma.AppointmentWhereInput = {
      ...(tenantId ? { tenantId } : {}),
      OR: [
        { status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gte: now, lte: new Date(now.getTime() + 30 * 86400000) } },
        { status: 'NO_SHOW', updatedAt: { gte: new Date(now.getTime() - 30 * 86400000) } },
        { status: 'COMPLETED', completedAt: { gte: completedCutoff } },
        { status: 'COMPLETED', completedAt: null, updatedAt: { gte: surveyCutoff } },
      ],
      patient: { active: true, deletedAt: null },
    };
    let cursor: string | undefined;
    while (true) {
      const appointments = await this.prisma.unscoped.appointment.findMany({ where, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: 500, include: { patient: { select: { active: true, deletedAt: true } } } });
      if (!appointments.length) break;
      for (const appointment of appointments) await this.ensureSchedules(appointment, rules.filter((rule) => rule.tenantId === appointment.tenantId));
      cursor = appointments[appointments.length - 1]!.id;
      if (appointments.length < 500) break;
    }
  }

  async reconcileDueExecutions(tenantId?: string) {
    const now = new Date();
    const rows = await this.prisma.unscoped.automationExecution.findMany({ where: { ...(tenantId ? { tenantId } : {}), status: 'PENDING', scheduledAt: { lte: new Date(now.getTime() + 60_000) } }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: 250 });
    let queued = 0;
    for (const row of rows) {
      const jobId = `automation-${row.id}`;
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (['waiting', 'active', 'delayed', 'waiting-children', 'prioritized'].includes(state)) continue;
        await existing.remove().catch(() => undefined);
      }
      try {
        await this.queue.add('execute-confirmation', { executionId: row.id }, { jobId, delay: Math.max(0, row.scheduledAt.getTime() - Date.now()), attempts: RETRY_LIMIT, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: false, removeOnFail: false });
        queued++;
      } catch (error) { this.logger.warn(`Could not enqueue durable automation ${row.id}: ${error instanceof Error ? error.message : 'unknown error'}`); }
    }
    const dueNoResponses = await this.prisma.unscoped.automationExecution.findMany({ where: { ...(tenantId ? { tenantId } : {}), status: 'OUTBOXED', outboxMessageId: { not: null }, OR: [{ appointment: { startsAt: { lte: now }, status: 'PENDING' }, automation: { trigger: 'APPOINTMENT_CONFIRMATION' } }, { responseDeadlineAt: { lte: now }, automation: { trigger: 'PROCEDURE_RETURN' } }] }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: 250, select: { id: true, tenantId: true, outboxMessageId: true } });
    for (const row of dueNoResponses) {
      const outbox = await this.prisma.unscoped.outboxMessage.findFirst({ where: { tenantId: row.tenantId, id: row.outboxMessageId!, status: { in: ['SIMULATED', 'SENT'] } }, select: { id: true } });
      if (!outbox) continue;
      const jobId = `automation-no-response-${row.id}`;
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (['waiting', 'active', 'delayed', 'waiting-children', 'prioritized'].includes(state)) continue;
        await existing.remove().catch(() => undefined);
      }
      try { await this.queue.add('handle-no-response', { executionId: row.id, kind: 'NO_RESPONSE' }, { jobId, attempts: RETRY_LIMIT, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: false, removeOnFail: false }); }
      catch (error) { this.logger.warn(`Could not enqueue no-response automation ${row.id}: ${error instanceof Error ? error.message : 'unknown error'}`); }
    }
    return queued;
  }

  async process(job: Job<ExecutionJob>, token?: string) {
    const row = await this.prisma.unscoped.automationExecution.findUnique({ where: { id: job.data.executionId } });
    if (!row || row.status !== (job.data.kind === 'NO_RESPONSE' ? 'OUTBOXED' : 'PENDING')) return;
    const lease = `${row.id}:${Date.now()}`;
    const slot = await this.redis.acquireTenantSlot(row.tenantId, lease);
    if (!slot) { await job.moveToDelayed(Date.now() + 300, token); throw new DelayedError(); }
    try { if (job.data.kind === 'NO_RESPONSE') await this.executeNoResponse(row.id); else await this.execute(row.id); }
    catch (error) {
      const attempts = Math.max(row.attempts + 1, job.attemptsMade + 1);
      const terminal = attempts >= RETRY_LIMIT;
      const currentStatus = job.data.kind === 'NO_RESPONSE' ? 'OUTBOXED' : 'PENDING';
      await this.prisma.unscoped.automationExecution.updateMany({ where: { id: row.id, status: { in: ['PENDING', 'PROCESSING', 'OUTBOXED'] } }, data: { status: terminal ? 'FAILED' : currentStatus, attempts, lastError: error instanceof Error ? error.message.slice(0, 500) : 'Automation failed.' } });
      if (terminal) await this.prisma.unscoped.auditEvent.create({ data: { tenantId: row.tenantId, action: 'AUTOMATION_EXECUTION_FAILED', entityType: 'AutomationExecution', entityId: row.id, metadata: { attempts, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' } } });
      throw error;
    } finally { await this.redis.releaseTenantSlot(row.tenantId, slot, lease); }
  }

  async handlePatientReply(tx: Prisma.TransactionClient, tenantId: string, unitId: string, patientId: string, body: string, providerMessageId: string, responseSource = 'UNKNOWN', selectionId?: string) {
    const normalized = this.normalize(body);
    const surveyResult = await this.handleSatisfactionReply(tx, tenantId, unitId, patientId, normalized, providerMessageId, responseSource, selectionId);
    if (surveyResult !== 'UNRECOGNIZED') return surveyResult;
    const returnResult = await this.handleProcedureReturnReply(tx, tenantId, unitId, patientId, normalized, providerMessageId, responseSource);
    if (returnResult !== 'UNRECOGNIZED') return returnResult;
    const rows = await tx.automationExecution.findMany({ where: { tenantId, unitId, patientId, status: 'OUTBOXED', outboxMessageId: { not: null }, automation: { trigger: 'APPOINTMENT_CONFIRMATION' } }, include: { automation: true, appointment: true }, orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }], take: 20 });
    const outboxIds = rows.map((row) => row.outboxMessageId!).filter(Boolean);
    const ready = new Set((await tx.outboxMessage.findMany({ where: { tenantId, id: { in: outboxIds }, status: { in: ['SIMULATED', 'SENT'] } }, select: { id: true } })).map((row) => row.id));
    const matched = rows.flatMap((row) => {
      if (!row.outboxMessageId || !ready.has(row.outboxMessageId)) return [];
      const config = row.automation.configuration as ConfirmationConfig;
      const action = config.confirmKeywords.includes(normalized) ? 'CONFIRM'
        : config.rescheduleKeywords.includes(normalized) ? 'RESCHEDULE'
          : config.humanKeywords.includes(normalized) ? 'HUMAN' : null;
      return action && !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(row.appointment.status) ? [{ row, config, action }] : [];
    });
    const repliedAppointmentIds = rows.filter((row) => row.outboxMessageId && ready.has(row.outboxMessageId)).map((row) => row.appointmentId);
    const cancelUnansweredFollowUps = async (action = 'OTHER') => {
      if (!repliedAppointmentIds.length) return;
      await tx.automationExecution.updateMany({ where: { tenantId, appointmentId: { in: repliedAppointmentIds }, automation: { trigger: 'APPOINTMENT_CONFIRMATION_FOLLOW_UP' }, status: 'PENDING' }, data: { status: 'CANCELLED', responseAction: action, lastError: 'Patient replied before the reminder.' } });
      await tx.automationExecution.updateMany({ where: { tenantId, appointmentId: { in: repliedAppointmentIds }, automation: { trigger: 'APPOINTMENT_CONFIRMATION_FOLLOW_UP' }, status: 'OUTBOXED' }, data: { status: 'RESPONDED', responseAction: action } });
    };
    // A bare keyword is only enough when it identifies one pending appointment.
    if (matched.length !== 1) {
      if (repliedAppointmentIds.length) {
        await tx.automationExecution.updateMany({ where: { tenantId, id: { in: rows.filter((row) => row.outboxMessageId && ready.has(row.outboxMessageId)).map((row) => row.id) }, status: 'OUTBOXED' }, data: { status: 'RESPONDED', responseAction: 'OTHER' } });
        await cancelUnansweredFollowUps();
      }
      return 'UNRECOGNIZED';
    }
    const { row, config, action } = matched[0]!;
    {
      if (action === 'CONFIRM' && row.appointment.source === 'NATIVE' && row.appointment.status === 'PENDING') {
        const changed = await tx.appointment.updateMany({ where: { tenantId, unitId, id: row.appointmentId, status: 'PENDING', source: 'NATIVE' }, data: { status: 'CONFIRMED' } });
        if (changed.count) await tx.auditEvent.create({ data: { tenantId, action: 'APPOINTMENT_CONFIRMED_BY_EXPLICIT_REPLY', entityType: 'Appointment', entityId: row.appointmentId, metadata: { executionId: row.id, providerMessageId } } });
      } else if (action !== 'CONFIRM' || row.appointment.source === 'UNO') {
        await this.createExceptionTask(tx, row.tenantId, row.unitId, row.patientId, row.automation.createdById ?? config.responsibleUserId, row.appointmentId, row.automationId, action, providerMessageId);
      }
      await tx.automationExecution.update({ where: { tenantId_id: { tenantId, id: row.id } }, data: { status: action === 'CONFIRM' && row.appointment.source === 'UNO' ? 'RESPONSE_REQUIRES_MANUAL_UNO_ACTION' : 'RESPONDED', responseAction: action, lastError: action === 'CONFIRM' && row.appointment.source === 'UNO' ? 'Uno write remains disabled; human action required.' : null } });
      await cancelUnansweredFollowUps(action);
      return action;
    }
  }

  private async handleProcedureReturnReply(tx: Prisma.TransactionClient, tenantId: string, unitId: string, patientId: string, normalized: string, providerMessageId: string, responseSource: string) {
    const rows = await tx.automationExecution.findMany({ where: { tenantId, unitId, patientId, status: 'OUTBOXED', automation: { trigger: 'PROCEDURE_RETURN' } }, include: { automation: true, appointment: true, patient: true }, orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }], take: 20 });
    const readyIds = new Set((await tx.outboxMessage.findMany({ where: { tenantId, id: { in: rows.map((row) => row.outboxMessageId).filter((id): id is string => Boolean(id)) }, status: { in: ['SIMULATED', 'SENT'] } }, select: { id: true } })).map((row) => row.id));
    const matched = rows.flatMap((row) => {
      if (!row.outboxMessageId || !readyIds.has(row.outboxMessageId) || (row.responseDeadlineAt && row.responseDeadlineAt <= new Date())) return [];
      const config = row.automation.configuration as ProcedureReturnConfig;
      const action = config.noContactKeywords.includes(normalized) ? 'NO_CONTACT'
        : config.rescheduleKeywords.includes(normalized) ? 'RESCHEDULE_REQUESTED'
          : config.interestKeywords.includes(normalized) ? 'INTERESTED' : null;
      return action ? [{ row, config, action }] : [];
    });
    if (matched.length !== 1) return 'UNRECOGNIZED';
    const { row, config, action } = matched[0]!;
    await tx.$queryRaw`SELECT id FROM "AutomationExecution" WHERE id = ${row.id}::uuid FOR UPDATE`;
    const changed = await tx.automationExecution.updateMany({ where: { tenantId, id: row.id, status: 'OUTBOXED' }, data: { status: action === 'NO_CONTACT' ? 'REVOKED' : 'RESPONDED', responseAction: action, responseDeadlineAt: new Date() } });
    if (!changed.count) return 'UNRECOGNIZED';
    if (action === 'NO_CONTACT') {
      const evidence = `Opt-out de retorno recebido por ${responseSource}; mensagem ${providerMessageId}`;
      await tx.consentEvent.create({ data: { tenantId, patientId, actorUserId: null, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence, evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: providerMessageId } });
      await tx.consentPreference.upsert({ where: { tenantId_patientId_channel_purpose: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN' } }, create: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence, evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: providerMessageId }, update: { status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence, evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: providerMessageId, lastChangedAt: new Date() } });
      await tx.automationExecution.updateMany({ where: { tenantId, patientId, status: 'PENDING', automation: { trigger: 'PROCEDURE_RETURN' } }, data: { status: 'SUPPRESSED', lastError: 'Patient revoked procedure-return contact.' } });
      await tx.outboxMessage.updateMany({ where: { tenantId, patientId, purpose: 'PROCEDURE_RETURN', status: { in: ['PENDING', 'RETRY', 'PROCESSING'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'OPT_OUT_INBOUND' } });
    } else {
      const task = await tx.task.create({ data: { tenantId, unitId, patientId, appointmentId: row.appointmentId, procedureId: config.procedureId, automationId: row.automationId, title: action === 'RESCHEDULE_REQUESTED' ? 'Solicitação de retorno/agendamento' : 'Paciente interessado em retorno', description: `Solicitação registrada pela resposta ${providerMessageId} (${responseSource}). Confirmar disponibilidade e atender manualmente; nenhuma reserva foi criada.`, assignedToId: config.responsibleUserId, createdById: row.automation.createdById ?? config.responsibleUserId, priority: action === 'RESCHEDULE_REQUESTED' ? TaskPriority.HIGH : TaskPriority.NORMAL } });
      await tx.taskHistory.create({ data: { tenantId, taskId: task.id, actorUserId: row.automation.createdById ?? config.responsibleUserId, action: action, after: { appointmentId: row.appointmentId, procedureId: config.procedureId, providerMessageId, responseSource } } });
    }
    await tx.auditEvent.create({ data: { tenantId, actorUserId: row.automation.createdById ?? undefined, action: `PROCEDURE_RETURN_${action}`, entityType: 'AutomationExecution', entityId: row.id, metadata: { unitId, patientId, appointmentId: row.appointmentId, procedureId: config.procedureId, providerMessageId, responseSource } } });
    return action;
  }

  private async handleSatisfactionReply(tx: Prisma.TransactionClient, tenantId: string, unitId: string, patientId: string, normalized: string, providerMessageId: string, responseSource: string, selectionId?: string) {
    const labels: Record<string, 'EXCELLENT' | 'GOOD' | 'REGULAR' | 'POOR' | 'VERY_POOR'> = { 'OTIMO': 'EXCELLENT', 'BOM': 'GOOD', 'REGULAR': 'REGULAR', 'RUIM': 'POOR', 'PESSIMO': 'VERY_POOR' };
    const open = await tx.satisfactionSurvey.findMany({ where: { tenantId, unitId, patientId, state: 'OUTBOXED' }, include: { automation: true, appointment: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10 });
    const eligible = [] as Array<{ survey: typeof open[number]; classification: keyof typeof thankKey }>; // classification remains a closed five-value set.
    const thankKey = { EXCELLENT: 1, GOOD: 1, REGULAR: 1, POOR: 1, VERY_POOR: 1 };
    for (const survey of open) {
      if (survey.expiresAt <= new Date()) { await this.expireSurvey(tx, survey); continue; }
      if (!survey.outboxMessageId) continue;
      const outbox = await tx.outboxMessage.findFirst({ where: { tenantId, id: survey.outboxMessageId, status: { in: ['SIMULATED', 'SENT'] } }, select: { id: true } });
      if (!outbox) continue;
      const selected = selectionId?.match(new RegExp(`^(?:survey|satisfaction):${survey.id}:(EXCELLENT|GOOD|REGULAR|POOR|VERY_POOR)$`, 'i'))?.[1]?.toUpperCase();
      const classification = selected ? selected as keyof typeof thankKey : labels[normalized];
      if (classification) eligible.push({ survey, classification });
    }
    // Text labels are accepted only when there is exactly one open survey; button IDs are survey-specific.
    const selectedSurveyId = selectionId?.match(/^(?:survey|satisfaction):([0-9a-f-]{36}):/i)?.[1];
    const matched = eligible.filter(({ survey }) => selectedSurveyId ? survey.id === selectedSurveyId : true);
    if (matched.length !== 1) return 'UNRECOGNIZED';
    const { survey, classification } = matched[0]!;
    await tx.$queryRaw`SELECT id FROM "SatisfactionSurvey" WHERE "tenantId" = ${tenantId}::uuid AND id = ${survey.id}::uuid FOR UPDATE`;
    const changed = await tx.satisfactionSurvey.updateMany({ where: { tenantId, id: survey.id, state: 'OUTBOXED', expiresAt: { gt: new Date() } }, data: { state: 'RESPONDED', classification, responseSource: responseSource.slice(0, 40), responseMessageId: providerMessageId, respondedAt: new Date() } });
    if (!changed.count) return 'UNRECOGNIZED';
    await tx.satisfactionSurveyEvent.create({ data: { tenantId, surveyId: survey.id, event: 'RESPONDED', metadata: { classification, responseSource, providerMessageId } } });
    const config = survey.automation.configuration as SatisfactionConfig;
    const requiresFollowup = classification === 'POOR' || classification === 'VERY_POOR' || (classification === 'REGULAR' && config.regularAction === 'CREATE_TASK');
    if (requiresFollowup) {
      const title = classification === 'POOR' || classification === 'VERY_POOR' ? 'Acompanhar avaliação de satisfação' : 'Acompanhar avaliação regular';
      const task = await tx.task.create({ data: { tenantId, unitId, patientId, appointmentId: survey.appointmentId, automationId: survey.automationId, title, description: `Pesquisa privada de satisfação ${survey.id}; classificação ${classification}; agendamento ${survey.appointmentId}. Encaminhar para atendimento humano. Não oferecer aconselhamento clínico automatizado.`, assignedToId: config.responsibleUserId, createdById: survey.automation.createdById ?? config.responsibleUserId, priority: classification === 'POOR' || classification === 'VERY_POOR' ? 'URGENT' : 'NORMAL' } });
      await tx.taskHistory.create({ data: { tenantId, taskId: task.id, actorUserId: survey.automation.createdById ?? config.responsibleUserId, action: 'SATISFACTION_FOLLOWUP_CREATED', after: { surveyId: survey.id, appointmentId: survey.appointmentId, classification } } });
      await tx.satisfactionSurveyEvent.create({ data: { tenantId, surveyId: survey.id, event: 'FOLLOWUP_TASK_CREATED', metadata: { taskId: task.id, classification } } });
    }
    await this.createSurveyThankYou(tx, survey, config.thankYou[classification]);
    await tx.auditEvent.create({ data: { tenantId, actorUserId: survey.automation.createdById ?? undefined, action: 'SATISFACTION_RESPONSE_RECORDED', entityType: 'SatisfactionSurvey', entityId: survey.id, metadata: { unitId, appointmentId: survey.appointmentId, classification, source: responseSource } } });
    return classification;
  }

  private async createSurveyThankYou(tx: Prisma.TransactionClient, survey: { tenantId: string; patientId: string; unitId: string; provider: string; id: string; automationId: string; automation: { configuration: Prisma.JsonValue } }, body: string) {
    const config = survey.automation.configuration as SatisfactionConfig;
    const key = `satisfaction-survey:${survey.id}:thank-you`;
    if (await tx.outboxMessage.findFirst({ where: { tenantId: survey.tenantId, idempotencyKey: key }, select: { id: true } })) return;
    const preference = await tx.consentPreference.findUnique({ where: { tenantId_patientId_channel_purpose: { tenantId: survey.tenantId, patientId: survey.patientId, channel: 'WHATSAPP', purpose: 'SATISFACTION_SURVEY' } }, select: { status: true } });
    const connection = config.provider === 'META_CLOUD'
      ? await tx.metaConnection.findFirst({ where: { tenantId: survey.tenantId, unitId: survey.unitId, enabled: true, status: 'CONNECTED', ...(config.connectionId ? { id: config.connectionId } : {}) }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } })
      : await tx.evolutionConnection.findFirst({ where: { tenantId: survey.tenantId, unitId: survey.unitId, mode: 'EVOLUTION_BAILEYS', enabled: true, status: 'CONNECTED', ...(config.connectionId ? { id: config.connectionId } : {}) }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } });
    const subscription = await tx.subscription.findUnique({ where: { tenantId: survey.tenantId }, include: { plan: true } });
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${survey.tenantId}::uuid FOR SHARE`;
    const tenant = await tx.tenant.findUnique({ where: { id: survey.tenantId }, select: { status: true } });
    const usage = subscription ? await tx.usageEntry.aggregate({ where: { tenantId: survey.tenantId, metric: 'messages', cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt }, _sum: { quantity: true } }) : null;
    const limits = subscription ? resolvePlanLimits(subscription.plan, subscription.limitOverrides) : null;
    const allowed = tenant?.status !== 'SUSPENDED' && preference?.status === 'GRANTED' && connection && subscription && limits && subscription.plan.enabled && ['TRIAL', 'ACTIVE'].includes(subscription.status) && subscription.cycleStartsAt <= new Date() && subscription.cycleEndsAt > new Date() && (usage?._sum.quantity ?? 0) + 1 <= limits.messageLimitPerCycle;
    const outbox = await tx.outboxMessage.create({ data: { tenantId: survey.tenantId, patientId: survey.patientId, purpose: 'SATISFACTION_SURVEY', channel: 'WHATSAPP', provider: config.provider, connectionId: connection?.id, body, idempotencyKey: key, status: allowed ? 'PENDING' : 'SUPPRESSED', suppressionReason: allowed ? null : 'CONSENT_CONNECTION_OR_QUOTA_RECHECK_FAILED', lastError: allowed ? null : 'Agradecimento suprimido após revalidação de consentimento, conexão e cota.' } });
    if (allowed && subscription) await tx.usageEntry.create({ data: { tenantId: survey.tenantId, subscriptionId: subscription.id, metric: 'messages', quantity: 1, idempotencyKey: `outbox:${outbox.id}:messages`, cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt } });
    await tx.satisfactionSurveyEvent.create({ data: { tenantId: survey.tenantId, surveyId: survey.id, event: allowed ? 'THANK_YOU_QUEUED_DRY_RUN' : 'THANK_YOU_SUPPRESSED', metadata: { outboxMessageId: outbox.id } } });
  }

  private async expireSurvey(tx: Prisma.TransactionClient, survey: { tenantId: string; id: string; state: string; unitId: string; patientId: string; appointmentId: string; automationId: string; automation: { configuration: Prisma.JsonValue; createdById: string | null } }) {
    const changed = await tx.satisfactionSurvey.updateMany({ where: { tenantId: survey.tenantId, id: survey.id, state: 'OUTBOXED', expiresAt: { lte: new Date() } }, data: { state: 'EXPIRED' } });
    if (!changed.count) return;
    await tx.satisfactionSurveyEvent.create({ data: { tenantId: survey.tenantId, surveyId: survey.id, event: 'EXPIRED', metadata: { hasResponse: false } } });
    const config = survey.automation.configuration as SatisfactionConfig;
    if (config.noResponseAction === 'CREATE_TASK') {
      const task = await tx.task.create({ data: { tenantId: survey.tenantId, unitId: survey.unitId, patientId: survey.patientId, appointmentId: survey.appointmentId, automationId: survey.automationId, title: 'Pesquisa de satisfação sem resposta', description: `Pesquisa ${survey.id} expirada sem classificação. Agendamento ${survey.appointmentId}.`, assignedToId: config.responsibleUserId, createdById: survey.automation.createdById ?? config.responsibleUserId, priority: 'NORMAL' } });
      await tx.taskHistory.create({ data: { tenantId: survey.tenantId, taskId: task.id, actorUserId: survey.automation.createdById ?? config.responsibleUserId, action: 'SATISFACTION_NO_RESPONSE_TASK_CREATED', after: { surveyId: survey.id, appointmentId: survey.appointmentId } } });
      await tx.satisfactionSurveyEvent.create({ data: { tenantId: survey.tenantId, surveyId: survey.id, event: 'NO_RESPONSE_TASK_CREATED', metadata: { taskId: task.id } } });
    }
  }

  private async execute(id: string) {
    await this.prisma.unscoped.$transaction(async (tx) => {
      const identity = await tx.automationExecution.findUnique({ where: { id }, select: { tenantId: true, automationId: true } });
      if (!identity) return;
      await tx.$queryRaw`SELECT id FROM "Automation" WHERE "tenantId" = ${identity.tenantId}::uuid AND id = ${identity.automationId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "AutomationExecution" WHERE id = ${id}::uuid FOR UPDATE`;
      const execution = await tx.automationExecution.findUnique({ where: { id }, include: { automation: true, appointment: true, patient: true } });
      if (!execution || execution.status !== 'PENDING') return;
      const isSurvey = execution.automation.trigger === 'POST_CARE_SATISFACTION';
      const isReturn = execution.automation.trigger === 'PROCEDURE_RETURN';
      const isTagFlow = execution.automation.trigger === 'POST_CARE_TAG_FLOW';
      const isNoShow = execution.automation.trigger === 'APPOINTMENT_NO_SHOW';
      const isConfirmationFollowUp = execution.automation.trigger === 'APPOINTMENT_CONFIRMATION_FOLLOW_UP';
      const config = execution.automation.configuration as AutomationConfig;
      const fail = async (status: string, reason: string) => tx.automationExecution.update({ where: { tenantId_id: { tenantId: execution.tenantId, id } }, data: { status, executedAt: new Date(), lastError: reason } });
      const keyPrefix = isNoShow ? 'appointment-no-show' : isConfirmationFollowUp ? 'appointment-confirmation-follow-up' : isTagFlow ? 'tag-post-care' : isReturn ? 'procedure-return' : isSurvey ? 'satisfaction-survey' : 'appointment-confirmation';
      const keyDate = isNoShow ? execution.appointment.updatedAt.toISOString() : execution.appointment.startsAt.toISOString();
      const expectedIdempotencyKey = isTagFlow ? `tag-post-care:${execution.automationId}:${execution.appointmentId}:${execution.stepKey}` : `${keyPrefix}:${execution.automationId}:${execution.appointmentId}:${keyDate}`;
      if (execution.idempotencyKey !== expectedIdempotencyKey) return fail('CANCELLED', 'Appointment time changed; stale confirmation was cancelled.');
      if (execution.automation.status !== 'ACTIVE') return fail('CANCELLED', 'Automation is paused or inactive.');
      if (execution.scheduledAt > new Date()) return;
      if (isNoShow ? execution.appointment.status !== 'NO_SHOW' || execution.appointment.source !== 'NATIVE' : isConfirmationFollowUp ? execution.appointment.status !== 'PENDING' || execution.appointment.source !== 'NATIVE' || execution.appointment.startsAt <= new Date() : isReturn ? execution.appointment.status !== 'COMPLETED' || execution.appointment.source !== 'NATIVE' || execution.appointment.procedureId !== (config as ProcedureReturnConfig).procedureId : isSurvey || isTagFlow ? execution.appointment.status !== 'COMPLETED' : (!['PENDING', 'CONFIRMED'].includes(execution.appointment.status) || execution.appointment.startsAt <= new Date())) return fail('CANCELLED', 'Appointment is no longer eligible for this automation.');
      if (isNoShow) {
        const laterAppointment = await tx.appointment.findFirst({ where: { tenantId: execution.tenantId, patientId: execution.patientId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: execution.appointment.startsAt } }, select: { id: true } });
        if (laterAppointment) return fail('SUPPRESSED', 'Patient already has a new appointment.');
        const due = this.allowedContactTimeAfter(new Date(execution.appointment.updatedAt.getTime() + config.advanceMinutes * 60_000), config.allowedStartHour, config.allowedEndHour);
        if (!due || execution.scheduledAt.getTime() < due.getTime() - 60_000) return fail('CANCELLED', 'No-show follow-up schedule changed.');
      }
      let confirmationFollowUpAllowance: { outboxId: string; sentAt: Date } | undefined;
      if (isConfirmationFollowUp) {
          const confirmationCandidate = await tx.automationExecution.findFirst({ where: { tenantId: execution.tenantId, appointmentId: execution.appointmentId, status: 'OUTBOXED', automation: { trigger: 'APPOINTMENT_CONFIRMATION' }, outboxMessageId: { not: null } }, select: { id: true, outboxMessageId: true } });
          if (!confirmationCandidate?.outboxMessageId) return fail('SUPPRESSED', 'The appointment confirmation was not sent.');
          await tx.$queryRaw`SELECT id FROM "AutomationExecution" WHERE "tenantId" = ${execution.tenantId}::uuid AND id = ${confirmationCandidate.id}::uuid FOR UPDATE`;
          const confirmation = await tx.automationExecution.findFirst({ where: { tenantId: execution.tenantId, id: confirmationCandidate.id, status: 'OUTBOXED' }, select: { outboxMessageId: true } });
          const sentConfirmation = confirmation?.outboxMessageId ? await tx.outboxMessage.findFirst({ where: { tenantId: execution.tenantId, id: confirmation.outboxMessageId, status: { in: ['SIMULATED', 'SENT'] } }, select: { id: true, createdAt: true, sentAt: true } }) : null;
          if (!sentConfirmation) return fail('SUPPRESSED', 'The appointment confirmation was not sent.');
          const confirmationAt = sentConfirmation.sentAt ?? sentConfirmation.createdAt;
          const [patientReply, humanReply] = await Promise.all([
            tx.message.findFirst({ where: { tenantId: execution.tenantId, direction: 'INBOUND', createdAt: { gt: confirmationAt }, conversation: { tenantId: execution.tenantId, patientId: execution.patientId } }, select: { id: true } }),
            tx.message.findFirst({ where: { tenantId: execution.tenantId, direction: 'OUTBOUND', actor: 'HUMAN', createdAt: { gt: confirmationAt }, conversation: { tenantId: execution.tenantId, patientId: execution.patientId } }, select: { id: true } }),
          ]);
          if (patientReply || humanReply) return fail('SUPPRESSED', 'A patient or team member already replied to the confirmation.');
          confirmationFollowUpAllowance = { outboxId: sentConfirmation.id, sentAt: confirmationAt };
        const due = this.allowedContactTime(new Date(execution.appointment.startsAt.getTime() - config.advanceMinutes * 60_000), execution.appointment.startsAt, config.allowedStartHour, config.allowedEndHour);
        if (!due || Math.abs(due.getTime() - execution.scheduledAt.getTime()) > 60_000) return fail('CANCELLED', 'Confirmation reminder schedule changed.');
      }
      if (isTagFlow) {
        const flow = config as TagFlowConfig;
        const step = flow.steps.find((item) => item.id === execution.stepKey);
        if (!step || !execution.appointment.completedAt) return fail('CANCELLED', 'Etapa da sequência não existe mais.');
        if (flow.targetTagId && !(await tx.patientTag.findFirst({ where: { tenantId: execution.tenantId, patientId: execution.patientId, tagId: flow.targetTagId }, select: { tagId: true } }))) return fail('SUPPRESSED', 'O paciente não possui mais a etiqueta desta sequência.');
        const expectedAt = this.allowedContactTimeAfter(new Date(execution.appointment.completedAt.getTime() + step.delayMinutes * 60_000), flow.allowedStartHour, flow.allowedEndHour);
        if (!expectedAt || execution.scheduledAt.getTime() < expectedAt.getTime() - 60_000) return fail('CANCELLED', 'O agendamento da etapa mudou; a sequência será reconciliada.');
      }
      if (isReturn) {
        const returnConfig = config as ProcedureReturnConfig;
        const procedure = await tx.procedure.findFirst({ where: { tenantId: execution.tenantId, id: returnConfig.procedureId, active: true, OR: [{ unitId: execution.unitId }, { unitId: null }] }, select: { returnAfterDays: true, reminderAdvanceDays: true } });
        if (!procedure || procedure.returnAfterDays == null || procedure.reminderAdvanceDays == null || procedure.reminderAdvanceDays > procedure.returnAfterDays) return fail('SUPPRESSED', 'Procedure return days are missing or invalid.');
        const due = this.allowedContactTimeAfter(new Date((execution.appointment.completedAt ?? execution.appointment.updatedAt).getTime() + (procedure.returnAfterDays - procedure.reminderAdvanceDays) * 86400000), returnConfig.allowedStartHour, returnConfig.allowedEndHour, returnConfig.allowedDaysOfWeek);
        if (!due || Math.abs(due.getTime() - execution.scheduledAt.getTime()) > 60_000) return fail('CANCELLED', 'Procedure return schedule changed; stale execution was cancelled for reconciliation.');
      }
      if (!execution.patient.active || execution.patient.deletedAt) return fail('SUPPRESSED', 'Patient is archived or inactive.');
      await tx.$queryRaw`SELECT id FROM "Patient" WHERE "tenantId" = ${execution.tenantId}::uuid AND id = ${execution.patientId}::uuid FOR UPDATE`;
      const patientContactGate = await this.patientAutomationGate(tx, execution.tenantId, execution.patientId, new Date(), config.allowedStartHour, config.allowedEndHour, confirmationFollowUpAllowance);
      if (patientContactGate) {
        await tx.automationExecution.update({ where: { tenantId_id: { tenantId: execution.tenantId, id } }, data: { scheduledAt: patientContactGate.until, lastError: patientContactGate.reason } });
        return;
      }
      const purpose = isReturn ? 'PROCEDURE_RETURN' : isSurvey ? 'SATISFACTION_SURVEY' : isTagFlow ? 'POST_CARE' : 'APPOINTMENT_REMINDER';
      const preference = await tx.consentPreference.findUnique({ where: { tenantId_patientId_channel_purpose: { tenantId: execution.tenantId, patientId: execution.patientId, channel: 'WHATSAPP', purpose } }, select: { status: true } });
      if (preference?.status !== 'GRANTED') return fail('SUPPRESSED', `No active WhatsApp ${purpose.toLowerCase()} consent.`);
      const connection = config.provider === 'META_CLOUD'
        ? await tx.metaConnection.findFirst({ where: { tenantId: execution.tenantId, unitId: execution.unitId, enabled: true, status: 'CONNECTED', ...(config.connectionId ? { id: config.connectionId } : {}) }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } })
        : await tx.evolutionConnection.findFirst({ where: { tenantId: execution.tenantId, unitId: execution.unitId, mode: 'EVOLUTION_BAILEYS', enabled: true, status: 'CONNECTED', ...(config.connectionId ? { id: config.connectionId } : {}) }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } });
      if (!connection) return fail('SUPPRESSED', 'Configured provider connection is unavailable.');
      const subscription = await tx.subscription.findUnique({ where: { tenantId: execution.tenantId }, include: { plan: true } });
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${execution.tenantId}::uuid FOR SHARE`;
      const tenant = await tx.tenant.findUnique({ where: { id: execution.tenantId }, select: { status: true } });
      if (!tenant || tenant.status === 'SUSPENDED') return fail('SUPPRESSED', 'Tenant is suspended.');
      if (!subscription || !subscription.plan.enabled || !['TRIAL', 'ACTIVE'].includes(subscription.status) || subscription.cycleStartsAt > new Date() || subscription.cycleEndsAt <= new Date()) return fail('SUPPRESSED', 'Subscription is not active.');
      const usage = await tx.usageEntry.aggregate({ where: { tenantId: execution.tenantId, metric: 'messages', cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt }, _sum: { quantity: true } });
      if ((usage._sum.quantity ?? 0) + 1 > resolvePlanLimits(subscription.plan, subscription.limitOverrides).messageLimitPerCycle) return fail('SUPPRESSED', 'Message quota exhausted.');
      if (isReturn) {
        const returnConfig = config as ProcedureReturnConfig;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${execution.tenantId}:${execution.patientId}:${returnConfig.procedureId}:procedure-return-limit`}, 0))`;
        const completedAt = execution.appointment.completedAt ?? execution.appointment.updatedAt;
        const laterAppointment = await tx.appointment.findFirst({ where: { tenantId: execution.tenantId, patientId: execution.patientId, procedureId: returnConfig.procedureId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: completedAt } }, select: { id: true } });
        if (laterAppointment) return fail('SUPPRESSED', 'A later appointment already exists.');
        const prior = await tx.automationExecution.count({ where: { tenantId: execution.tenantId, patientId: execution.patientId, automation: { trigger: 'PROCEDURE_RETURN' }, appointment: { procedureId: returnConfig.procedureId }, id: { not: execution.id }, status: { in: ['OUTBOXED', 'RESPONDED', 'NO_RESPONSE', 'NO_RESPONSE_TASK_CREATED'] } } });
        if (prior >= returnConfig.maxContactsPerPatient) return fail('SUPPRESSED', 'Patient return-contact limit reached.');
      }
      const text = isSurvey ? this.renderSurvey(config as SatisfactionConfig, execution.patient.fullName) : isTagFlow ? this.render((config as TagFlowConfig).steps.find((step) => step.id === execution.stepKey)!.body, execution.patient.fullName, execution.appointment.startsAt) : this.render((config as AppointmentMessageConfig).body, execution.patient.fullName, execution.appointment.startsAt);
      const outboxPurpose = isNoShow ? 'appointment-no-show' : isConfirmationFollowUp ? 'appointment-confirmation-follow-up' : isReturn ? 'procedure-return' : isSurvey ? 'satisfaction-survey' : isTagFlow ? 'tag-post-care' : 'confirmation';
      const outbox = await tx.outboxMessage.create({ data: { tenantId: execution.tenantId, patientId: execution.patientId, purpose, channel: 'WHATSAPP', provider: config.provider, connectionId: connection.id, body: text, idempotencyKey: `automation:${execution.id}:${outboxPurpose}`, scheduledAt: new Date() } });
      if (isSurvey) {
        const surveyConfig = config as SatisfactionConfig;
        const survey = await tx.satisfactionSurvey.create({ data: { tenantId: execution.tenantId, unitId: execution.unitId, automationId: execution.automationId, executionId: execution.id, appointmentId: execution.appointmentId, patientId: execution.patientId, procedureId: execution.appointment.procedureId, provider: config.provider, question: surveyConfig.question, version: surveyConfig.version, state: 'OUTBOXED', expiresAt: new Date(Date.now() + surveyConfig.responseWindowHours * 60 * 60_000), outboxMessageId: outbox.id } });
        await tx.satisfactionSurveyEvent.create({ data: { tenantId: execution.tenantId, surveyId: survey.id, event: 'OUTBOXED', metadata: { outboxMessageId: outbox.id, version: surveyConfig.version } } });
      }
      await tx.usageEntry.create({ data: { tenantId: execution.tenantId, subscriptionId: subscription.id, metric: 'messages', quantity: 1, idempotencyKey: `outbox:${outbox.id}:messages`, cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt } });
      await tx.automationExecution.update({ where: { tenantId_id: { tenantId: execution.tenantId, id } }, data: { status: 'OUTBOXED', executedAt: new Date(), responseDeadlineAt: isReturn ? new Date(Date.now() + (config as ProcedureReturnConfig).responseWindowHours * 3600000) : undefined, outboxMessageId: outbox.id, attempts: { increment: 1 }, lastError: null } });
      await tx.auditEvent.create({ data: { tenantId: execution.tenantId, actorUserId: execution.automation.createdById ?? undefined, action: 'AUTOMATION_EXECUTED', entityType: 'AutomationExecution', entityId: id, metadata: { unitId: execution.unitId, appointmentId: execution.appointmentId, outboxMessageId: outbox.id, provider: config.provider, result: 'QUEUED_FOR_DRY_RUN', trigger: execution.automation.trigger } } });
    });
  }

  private async executeNoResponse(id: string) {
    await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AutomationExecution" WHERE id = ${id}::uuid FOR UPDATE`;
      const execution = await tx.automationExecution.findUnique({ where: { id }, include: { automation: true, appointment: true, patient: true } });
      if (!execution || execution.status !== 'OUTBOXED') return;
      const config = execution.automation.configuration as AutomationConfig;
      const noResponseAction = 'noResponseAction' in config ? config.noResponseAction : 'NONE';
      const isReturn = execution.automation.trigger === 'PROCEDURE_RETURN';
      if (isReturn ? !execution.responseDeadlineAt || execution.responseDeadlineAt > new Date() : execution.appointment.startsAt > new Date() || execution.appointment.status !== 'PENDING') return;
      const outbox = execution.outboxMessageId ? await tx.outboxMessage.findFirst({ where: { tenantId: execution.tenantId, id: execution.outboxMessageId, status: { in: ['SIMULATED', 'SENT'] } }, select: { id: true } }) : null;
      if (!outbox) return;
      if (noResponseAction === 'CREATE_TASK') {
        if (isReturn) {
          const procedureConfig = config as ProcedureReturnConfig;
          const task = await tx.task.create({ data: { tenantId: execution.tenantId, unitId: execution.unitId, patientId: execution.patientId, appointmentId: execution.appointmentId, procedureId: procedureConfig.procedureId, automationId: execution.automationId, title: 'Retorno por procedimento sem resposta', description: `Execução ${execution.id} expirou sem resposta. Confirmar necessidade de contato humano.`, assignedToId: procedureConfig.responsibleUserId, createdById: execution.automation.createdById ?? procedureConfig.responsibleUserId } });
          await tx.taskHistory.create({ data: { tenantId: execution.tenantId, taskId: task.id, actorUserId: execution.automation.createdById ?? procedureConfig.responsibleUserId, action: 'PROCEDURE_RETURN_NO_RESPONSE_TASK_CREATED', after: { executionId: execution.id, procedureId: procedureConfig.procedureId } } });
        } else await this.createExceptionTask(tx, execution.tenantId, execution.unitId, execution.patientId, config.responsibleUserId, execution.appointmentId, execution.automationId, 'NO_RESPONSE', `execution:${execution.id}`);
      }
      await tx.automationExecution.update({ where: { tenantId_id: { tenantId: execution.tenantId, id } }, data: { status: noResponseAction === 'CREATE_TASK' ? 'NO_RESPONSE_TASK_CREATED' : 'NO_RESPONSE', responseAction: 'NO_RESPONSE', executedAt: new Date() } });
      await tx.auditEvent.create({ data: { tenantId: execution.tenantId, actorUserId: execution.automation.createdById ?? undefined, action: 'AUTOMATION_NO_RESPONSE', entityType: 'AutomationExecution', entityId: id, metadata: { unitId: execution.unitId, appointmentId: execution.appointmentId, action: noResponseAction } } });
    });
  }

  private async createExceptionTask(tx: Prisma.TransactionClient, tenantId: string, unitId: string, patientId: string, responsibleUserId: string, appointmentId: string, automationId: string, action: string, providerMessageId: string) {
    const title = action === 'RESCHEDULE' ? 'Solicitação de reagendamento' : action === 'NO_RESPONSE' ? 'Agendamento sem resposta de confirmação' : 'Paciente solicita atendimento humano';
    const description = action === 'NO_RESPONSE' ? `Nenhuma resposta à confirmação simulada/local. Agendamento ${appointmentId}. Execução ${providerMessageId}.` : `Resposta reconhecida pela automação de confirmação. Agendamento ${appointmentId}. Evento inbound ${providerMessageId}.`;
    const task = await tx.task.create({ data: { tenantId, unitId, patientId, appointmentId, automationId, title, description, assignedToId: responsibleUserId, createdById: responsibleUserId, priority: action === 'HUMAN' || action === 'NO_RESPONSE' ? TaskPriority.HIGH : TaskPriority.NORMAL } });
    await tx.taskHistory.create({ data: { tenantId, taskId: task.id, actorUserId: responsibleUserId, action: 'AUTOMATION_CREATED', after: { appointmentId, responseAction: action } } });
  }

  private async cancelAppointmentExecutions(appointment: { id: string; tenantId: string; startsAt: Date; updatedAt: Date; status: string }, reason: string) {
    const rows = await this.prisma.unscoped.automationExecution.findMany({ where: { tenantId: appointment.tenantId, appointmentId: appointment.id, status: { in: ['PENDING', 'PROCESSING', 'OUTBOXED'] } }, select: { id: true, outboxMessageId: true, idempotencyKey: true, stepKey: true, automationId: true, automation: { select: { trigger: true, status: true } } } });
    const stale = rows.filter((row) => {
      const isSurvey = row.automation.trigger === 'POST_CARE_SATISFACTION';
      const isReturn = row.automation.trigger === 'PROCEDURE_RETURN';
      const isTagFlow = row.automation.trigger === 'POST_CARE_TAG_FLOW';
       const isNoShow = row.automation.trigger === 'APPOINTMENT_NO_SHOW';
       const isConfirmationFollowUp = row.automation.trigger === 'APPOINTMENT_CONFIRMATION_FOLLOW_UP';
      const eligible = isReturn
        ? appointment.status === 'COMPLETED'
        : isTagFlow
        ? appointment.status === 'COMPLETED'
        : isSurvey
        ? appointment.status === 'COMPLETED'
         : isNoShow
         ? appointment.status === 'NO_SHOW'
         : isConfirmationFollowUp
         ? appointment.status === 'PENDING' && appointment.startsAt > new Date()
        : ['PENDING', 'CONFIRMED'].includes(appointment.status) && appointment.startsAt > new Date();
       const prefix = isNoShow ? 'appointment-no-show' : isConfirmationFollowUp ? 'appointment-confirmation-follow-up' : isReturn ? 'procedure-return' : isSurvey ? 'satisfaction-survey' : 'appointment-confirmation';
       const expectedKey = isTagFlow ? `tag-post-care:${row.automationId}:${appointment.id}:${row.stepKey}` : `${prefix}:${row.automationId}:${appointment.id}:${isNoShow ? appointment.updatedAt.toISOString() : appointment.startsAt.toISOString()}`;
      return row.automation.status !== 'ACTIVE' || !eligible || row.idempotencyKey !== expectedKey;
    });
    if (!stale.length) return;
    await this.prisma.unscoped.$transaction(async (tx) => {
      const ids = stale.map((row) => row.id);
      await tx.automationExecution.updateMany({ where: { tenantId: appointment.tenantId, id: { in: ids }, status: { in: ['PENDING', 'PROCESSING', 'OUTBOXED'] } }, data: { status: 'CANCELLED', lastError: reason } });
      const outboxIds = stale.map((row) => row.outboxMessageId).filter((value): value is string => Boolean(value));
      if (outboxIds.length) await tx.outboxMessage.updateMany({ where: { tenantId: appointment.tenantId, id: { in: outboxIds }, status: { in: ['PENDING', 'RETRY'] } }, data: { status: 'SUPPRESSED', suppressionReason: reason } });
      const surveys = await tx.satisfactionSurvey.findMany({ where: { tenantId: appointment.tenantId, executionId: { in: ids }, state: 'OUTBOXED' }, select: { id: true } });
      if (surveys.length) {
        await tx.satisfactionSurvey.updateMany({ where: { tenantId: appointment.tenantId, id: { in: surveys.map(({ id }) => id) }, state: 'OUTBOXED' }, data: { state: 'SUPPRESSED' } });
        await tx.satisfactionSurveyEvent.createMany({ data: surveys.map(({ id }) => ({ tenantId: appointment.tenantId, surveyId: id, event: reason, metadata: { reason } })) });
      }
    });
  }

  private async cancelExecutionsTx(tx: Prisma.TransactionClient, tenantId: string, ruleId: string, reason: string) {
    const rows = await tx.automationExecution.findMany({ where: { tenantId, automationId: ruleId, status: { in: ['PENDING', 'PROCESSING', 'OUTBOXED'] } }, select: { id: true, outboxMessageId: true } });
    if (!rows.length) return;
    const ids = rows.map((row) => row.id);
    await tx.automationExecution.updateMany({ where: { tenantId, id: { in: ids }, status: { in: ['PENDING', 'PROCESSING', 'OUTBOXED'] } }, data: { status: 'CANCELLED', lastError: reason } });
    const outboxIds = rows.map((row) => row.outboxMessageId).filter((value): value is string => Boolean(value));
    if (outboxIds.length) await tx.outboxMessage.updateMany({ where: { tenantId, id: { in: outboxIds }, status: { in: ['PENDING', 'RETRY', 'PROCESSING'] } }, data: { status: 'SUPPRESSED', suppressionReason: reason } });
    const surveys = await tx.satisfactionSurvey.findMany({ where: { tenantId, executionId: { in: ids }, state: 'OUTBOXED' }, select: { id: true } });
    if (surveys.length) {
      await tx.satisfactionSurvey.updateMany({ where: { tenantId, id: { in: surveys.map(({ id }) => id) }, state: 'OUTBOXED' }, data: { state: 'SUPPRESSED' } });
      await tx.satisfactionSurveyEvent.createMany({ data: surveys.map(({ id }) => ({ tenantId, surveyId: id, event: reason, metadata: { reason } })) });
    }
  }

  private async assertRuleReferences(tenantId: string, config: AutomationConfig) {
    if (!(await this.prisma.scoped.unit.findFirst({ where: { tenantId, id: config.unitId, active: true }, select: { id: true } }))) throw new BadRequestException('Unidade inválida.');
    if ('steps' in config && config.targetTagId && !(await this.prisma.scoped.patientTagDefinition.findFirst({ where: { tenantId, id: config.targetTagId }, select: { id: true } }))) throw new BadRequestException('A etiqueta selecionada não existe nesta clínica.');
    if (config.procedureId) {
      const procedure = await this.prisma.scoped.procedure.findFirst({ where: { tenantId, id: config.procedureId, active: true, OR: [{ unitId: config.unitId }, { unitId: null }] }, select: { id: true, returnAfterDays: true, reminderAdvanceDays: true } });
      if (!procedure) throw new BadRequestException('Procedimento não pertence à unidade.');
      if ('maxContactsPerPatient' in config && (procedure.returnAfterDays == null || procedure.reminderAdvanceDays == null || procedure.reminderAdvanceDays > procedure.returnAfterDays)) throw new BadRequestException('Configure dias de efeito e antecedência coerentes no procedimento.');
    }
    const assignee = await this.prisma.scoped.membership.findFirst({ where: { tenantId, userId: config.responsibleUserId, status: 'ACTIVE', OR: [{ role: 'TENANT_ADMIN' }, { unitScopes: { some: { unitId: config.unitId } } }] }, select: { id: true } });
    if (!assignee) throw new BadRequestException('Responsável não tem acesso ativo à unidade.');
    if (config.connectionId) {
      const connection = config.provider === 'META_CLOUD'
        ? await this.prisma.scoped.metaConnection.findFirst({ where: { tenantId, id: config.connectionId, unitId: config.unitId, enabled: true }, select: { id: true } })
        : await this.prisma.scoped.evolutionConnection.findFirst({ where: { tenantId, id: config.connectionId, unitId: config.unitId, mode: 'EVOLUTION_BAILEYS', enabled: true }, select: { id: true } });
      if (!connection) throw new BadRequestException('Conexão de mensageria inválida para a unidade/provedor.');
    }
  }

  private config(value: unknown, trigger: string): AutomationConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('configuration obrigatório.');
    const raw = value as Record<string, unknown>;
    const integer = (key: string, min: number, max: number, fallback?: number) => { const n = raw[key] === undefined ? fallback : raw[key]; if (!Number.isInteger(n) || Number(n) < min || Number(n) > max) throw new BadRequestException(`${key} fora do intervalo.`); return Number(n); };
    const list = (key: string, fallback: string[]) => { const values = Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter((item): item is string => typeof item === 'string').map((item) => this.normalize(item)).filter(Boolean) : fallback; return [...new Set(values)].slice(0, 20); };
    if (raw.provider !== 'META_CLOUD' && raw.provider !== 'EVOLUTION_BAILEYS') throw new BadRequestException('Provedor deve ser META_CLOUD ou EVOLUTION_BAILEYS.');
    if (typeof raw.unitId !== 'string' || !raw.unitId) throw new BadRequestException('unitId obrigatório.');
    const shared: SharedAutomationConfig = { unitId: raw.unitId, procedureId: typeof raw.procedureId === 'string' && raw.procedureId ? raw.procedureId : null, advanceMinutes: integer('advanceMinutes', 0, trigger === 'POST_CARE_SATISFACTION' ? 43200 : 10080), allowedStartHour: integer('allowedStartHour', 0, 23), allowedEndHour: integer('allowedEndHour', 1, 24), provider: raw.provider, connectionId: typeof raw.connectionId === 'string' && raw.connectionId ? raw.connectionId : null, responsibleUserId: this.text(raw.responsibleUserId, 'Responsável', 36, 36) };
    if (trigger === 'POST_CARE_TAG_FLOW') {
      if (shared.allowedEndHour <= shared.allowedStartHour) throw new BadRequestException('O horário final permitido deve ser posterior ao inicial.');
      if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 10) throw new BadRequestException('A sequência deve ter de 1 a 10 etapas.');
      const steps = raw.steps.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`Etapa ${index + 1} inválida.`);
        const step = value as Record<string, unknown>;
        const id = typeof step.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(step.id) ? step.id : randomUUID();
        const delayMinutes = step.delayMinutes;
        if (!Number.isInteger(delayMinutes) || Number(delayMinutes) < 0 || Number(delayMinutes) > 525600) throw new BadRequestException(`Atraso da etapa ${index + 1} inválido.`);
        return { id, delayMinutes: Number(delayMinutes), body: this.text(step.body, `Mensagem da etapa ${index + 1}`, 2, 4000) };
      });
      if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new BadRequestException('Cada etapa precisa ter um identificador único.');
      return { ...shared, targetTagId: typeof raw.targetTagId === 'string' && raw.targetTagId ? this.text(raw.targetTagId, 'Etiqueta', 36, 36) : null, steps };
    }
    if (trigger === 'PROCEDURE_RETURN') {
      if (!shared.procedureId) throw new BadRequestException('Selecione um procedimento para retorno.');
      const dayValues = Array.isArray(raw.allowedDaysOfWeek) ? raw.allowedDaysOfWeek : [1, 2, 3, 4, 5];
      const allowedDaysOfWeek = [...new Set(dayValues.map(Number))];
      if (!allowedDaysOfWeek.length || allowedDaysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new BadRequestException('Dias permitidos inválidos.');
      return { ...shared, procedureId: shared.procedureId, body: this.text(raw.body ?? 'Olá {{paciente.nome}}, se desejar organizar seu próximo retorno, nossa equipe pode ajudar.', 'Mensagem', 2, 4000), responseWindowHours: integer('responseWindowHours', 1, 720, 72), maxContactsPerPatient: integer('maxContactsPerPatient', 1, 12, 2), allowedDaysOfWeek, interestKeywords: list('interestKeywords', ['TENHO INTERESSE', 'QUERO RETORNAR']), rescheduleKeywords: list('rescheduleKeywords', ['AGENDAR', 'REAGENDAR']), noContactKeywords: list('noContactKeywords', ['NAO QUERO CONTATO', 'PARAR RETORNOS']), noResponseAction: raw.noResponseAction === 'CREATE_TASK' ? 'CREATE_TASK' : 'NONE' };
    }
    if (trigger === 'POST_CARE_SATISFACTION') {
      const thank = raw.thankYou && typeof raw.thankYou === 'object' && !Array.isArray(raw.thankYou) ? raw.thankYou as Record<string, unknown> : {};
      const thankYou = { EXCELLENT: this.text(thank.EXCELLENT ?? 'Muito obrigado por compartilhar sua experiência!', 'Agradecimento Ótimo', 2, 500), GOOD: this.text(thank.GOOD ?? 'Obrigado por avaliar sua experiência!', 'Agradecimento Bom', 2, 500), REGULAR: this.text(thank.REGULAR ?? 'Obrigado por contar como foi sua experiência.', 'Agradecimento Regular', 2, 500), POOR: this.text(thank.POOR ?? 'Obrigado por nos avisar. Nossa equipe vai acompanhar seu relato.', 'Agradecimento Ruim', 2, 500), VERY_POOR: this.text(thank.VERY_POOR ?? 'Obrigado por nos avisar. Nossa equipe vai acompanhar seu relato.', 'Agradecimento Péssimo', 2, 500) };
      return { ...shared, opening: this.text(raw.opening ?? 'Olá {{paciente.nome}}!', 'Abertura', 2, 500), question: this.text(raw.question ?? 'Como você classifica sua experiência?', 'Pergunta', 2, 1000), responseWindowHours: integer('responseWindowHours', 1, 720, 24), version: integer('version', 1, 1000, 1), thankYou, regularAction: raw.regularAction === 'CREATE_TASK' ? 'CREATE_TASK' : 'NONE', noResponseAction: raw.noResponseAction === 'CREATE_TASK' ? 'CREATE_TASK' : 'NONE' };
    }
    if (trigger === 'APPOINTMENT_NO_SHOW' || trigger === 'APPOINTMENT_CONFIRMATION_FOLLOW_UP') {
      return { ...shared, body: this.text(raw.body, 'Mensagem', 2, 4000) };
    }
    const body = this.text(raw.body, 'Mensagem', 2, 4000);
    const noResponseAction = raw.noResponseAction === 'CREATE_TASK' ? 'CREATE_TASK' : 'NONE';
    return { ...shared, body, confirmKeywords: list('confirmKeywords', ['CONFIRMAR']), rescheduleKeywords: list('rescheduleKeywords', ['REAGENDAR']), humanKeywords: list('humanKeywords', ['ATENDENTE', 'HUMANO']), noResponseAction };
  }

  private allowedContactTime(candidate: Date, appointmentAt: Date, startHour: number, endHour: number) {
    const limit = Math.min(24 * 60, Math.ceil((appointmentAt.getTime() - candidate.getTime()) / 60_000) + 1);
    for (let i = 0; i < limit && candidate < appointmentAt; i++, candidate.setTime(candidate.getTime() + 60_000)) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(candidate);
      const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
      if (hour >= startHour && hour < endHour) return new Date(candidate);
    }
    return null;
  }

  private allowedContactTimeAfter(candidate: Date, startHour: number, endHour: number, allowedDaysOfWeek?: number[]) {
    const maxMinutes = allowedDaysOfWeek?.length ? 8 * 24 * 60 : 24 * 60;
    for (let i = 0; i <= maxMinutes; i++, candidate.setTime(candidate.getTime() + 60_000)) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(candidate);
      const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
      const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(candidate);
      const day = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[dayLabel] ?? 0;
      if (hour >= startHour && hour < endHour && (!allowedDaysOfWeek?.length || allowedDaysOfWeek.includes(day))) return new Date(candidate);
    }
    return null;
  }

  private async patientAutomationGate(tx: Prisma.TransactionClient, tenantId: string, patientId: string, now: Date, startHour: number, endHour: number, confirmationFollowUpAllowance?: { outboxId: string; sentAt: Date }) {
    const { start, end } = this.saoPauloDay(now);
    const conversation = await tx.conversation.findFirst({
      where: { tenantId, patientId, OR: [{ status: { in: ['OPEN', 'WAITING_HUMAN'] } }, { lastMessageAt: { gte: new Date(now.getTime() - 30 * 60_000) } }] },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], select: { status: true, lastMessageAt: true },
    });
    if (conversation) {
      const quietAfterConfirmation = confirmationFollowUpAllowance
        && conversation.status === 'OPEN'
        && conversation.lastMessageAt.getTime() <= confirmationFollowUpAllowance.sentAt.getTime() + 10_000;
      if (!quietAfterConfirmation) {
        const candidate = new Date(Math.max(now.getTime() + 30 * 60_000, conversation.lastMessageAt.getTime() + 30 * 60_000));
        const until = this.allowedContactTimeAfter(candidate, startHour, endHour);
        if (until) return { until, reason: 'Adiada: conversa ativa ou atividade recente da equipe/paciente.' };
      }
    }
    const [alreadyContactedToday, humanMessageToday, sameDayConfirmation, otherAutomationMessagesToday] = await Promise.all([
      tx.outboxMessage.findFirst({ where: { tenantId, patientId, status: { in: ['SIMULATED', 'SENT'] }, sentAt: { gte: start, lt: end } }, select: { id: true } }),
      tx.message.findFirst({ where: { tenantId, direction: 'OUTBOUND', status: { in: ['QUEUED', 'SIMULATED', 'SENT', 'DELIVERED', 'READ'] }, createdAt: { gte: start, lt: end }, conversation: { tenantId, patientId } }, select: { id: true } }),
      confirmationFollowUpAllowance ? tx.outboxMessage.findFirst({ where: { tenantId, patientId, id: confirmationFollowUpAllowance.outboxId, status: { in: ['SIMULATED', 'SENT'] }, sentAt: { gte: start, lt: end } }, select: { id: true } }) : Promise.resolve(null),
      confirmationFollowUpAllowance ? tx.outboxMessage.count({ where: { tenantId, patientId, status: { in: ['SIMULATED', 'SENT'] }, sentAt: { gte: start, lt: end }, id: { not: confirmationFollowUpAllowance.outboxId } } }) : Promise.resolve(0),
    ]);
    if (alreadyContactedToday || humanMessageToday) {
      const onlyPreviousConfirmationToday = Boolean(confirmationFollowUpAllowance && sameDayConfirmation && !otherAutomationMessagesToday && !humanMessageToday);
      if (onlyPreviousConfirmationToday) return null;
      const until = this.allowedContactTimeAfter(new Date(end.getTime() + 9 * 60 * 60_000), startHour, endHour);
      if (until) return { until, reason: 'Adiada: outra mensagem automática já foi processada hoje.' };
    }
    return null;
  }

  private saoPauloDay(value: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '01';
    const start = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00-03:00`);
    return { start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
  }

  private renderSurvey(config: SatisfactionConfig, fullName: string) {
    const labels = ['Ótimo', 'Bom', 'Regular', 'Ruim', 'Péssimo'];
    return `${config.opening.replaceAll('{{paciente.nome}}', fullName)}\n\n${config.question}\n${labels.map((label, index) => `${index + 1}. ${label}`).join('\n')}`;
  }

  private render(body: string, fullName: string, startsAt: Date) {
    const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(startsAt).split(' ');
    return body.replaceAll('{{paciente.nome}}', fullName).replaceAll('{{agendamento.data}}', parts[0] ?? '').replaceAll('{{agendamento.hora}}', parts[1] ?? '');
  }
  private normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase(); }
  private text(value: unknown, label: string, min: number, max: number) { if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new BadRequestException(`${label} inválido.`); assertReadableMessageText(value, label.toLocaleLowerCase('pt-BR')); return value.trim(); }
}

