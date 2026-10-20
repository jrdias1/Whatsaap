import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskPriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';

type ReportQuery = { from?: string; to?: string; unitId?: string };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}

  private scope() {
    const scope = this.context.current();
    if (!scope || !['TENANT_ADMIN', 'UNIT_MANAGER'].includes(scope.role)) throw new ForbiddenException('Relatórios disponíveis para administradores e gerentes autorizados.');
    return scope;
  }

  private async filter(query: ReportQuery) {
    const scope = this.scope();
    const today = localToday();
    const from = query.from ?? addDays(today, -29);
    const to = query.to ?? today;
    if (!validDateOnly(from) || !validDateOnly(to)) throw new BadRequestException('Informe datas válidas no formato AAAA-MM-DD.');
    const start = localMidnight(from);
    const endExclusive = localMidnight(addDays(to, 1));
    const days = Math.round((endExclusive.getTime() - start.getTime()) / 86400000);
    if (start >= endExclusive || days > 366) throw new BadRequestException('O período deve ter no máximo 366 dias.');
    let allowed: string[] | null = null;
    if (scope.role === 'UNIT_MANAGER') allowed = (await this.prisma.scoped.unitMembership.findMany({ where: { tenantId: scope.tenantId, membershipId: scope.membershipId }, select: { unitId: true } })).map((x) => x.unitId);
    if (query.unitId) {
      const unit = await this.prisma.scoped.unit.findFirst({ where: { tenantId: scope.tenantId, id: query.unitId, active: true }, select: { id: true } });
      if (!unit || (allowed && !allowed.includes(query.unitId))) throw new ForbiddenException('Unidade fora do seu escopo.');
    }
    return { scope, from, to, start, endExclusive, unitId: query.unitId ?? null, allowedUnits: query.unitId ? [query.unitId] : allowed };
  }

  async overview(query: ReportQuery) {
    const f = await this.filter(query);
    const tenantId = f.scope.tenantId;
    const unitFilter = f.allowedUnits ? { unitId: { in: f.allowedUnits } } : {};
    const patientUnitFilter = f.allowedUnits ? { unitId: { in: f.allowedUnits } } : {};
    const inPeriod = { gte: f.start, lt: f.endExclusive };

    const [appointmentCreated, appointmentStatusRows, appointmentCompleted, appointmentTrend, procedures, resources, appointmentEvents, patientsActive, patientsNew, patientsArchived, patientsByUnit, patientsBySource, tagRows, conversationsCreated, conversationStates, tasksCreated, tasksDone, overdueTasks, messageStates, automationStates, outboxStates, automationTasks, referralRows, referralEvents, rewards, voucherUses, npsDistribution, npsTrendRows, followupPending, units, satisfactionRows] = await Promise.all([
      this.prisma.scoped.appointment.count({ where: { tenantId, ...unitFilter, createdAt: inPeriod } }),
      this.prisma.scoped.appointment.groupBy({ by: ['status'], where: { tenantId, ...unitFilter, startsAt: inPeriod }, _count: { _all: true } }),
      this.prisma.scoped.appointment.count({ where: { tenantId, ...unitFilter, completedAt: inPeriod, status: 'COMPLETED' } }),
      this.prisma.unscoped.$queryRaw<Array<{ day: string; count: bigint }>>`
        SELECT to_char(date_trunc('day', "startsAt" AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS day,
               count(*)::bigint AS count
          FROM "Appointment"
         WHERE "tenantId" = ${tenantId}::uuid
           AND "startsAt" >= ${f.start} AND "startsAt" < ${f.endExclusive}
           AND "status" <> 'CANCELLED'
           AND (${f.unitId}::uuid IS NULL OR "unitId" = ${f.unitId}::uuid)
           AND (${f.allowedUnits === null} OR "unitId" = ANY(string_to_array(${f.allowedUnits?.join(',') ?? ''}, ',')::uuid[]))
         GROUP BY 1 ORDER BY 1`,
      this.prisma.scoped.appointment.groupBy({ by: ['procedureId'], where: { tenantId, ...unitFilter, startsAt: inPeriod, status: { not: 'CANCELLED' }, procedureId: { not: null } }, _count: { _all: true } }),
      this.prisma.scoped.appointmentResource.groupBy({ by: ['resourceId'], where: { tenantId, ...unitFilter, appointment: { startsAt: inPeriod, status: { not: 'CANCELLED' } }, resource: { type: 'PROFESSIONAL' } }, _count: { _all: true } }),
      this.prisma.unscoped.$queryRaw<Array<{ action: string; to: string | null }>>`
        SELECT e.action, e.metadata->>'to' AS "to"
          FROM "AuditEvent" e LEFT JOIN "Appointment" a ON a."tenantId" = e."tenantId" AND a.id = e."entityId"::uuid
         WHERE e."tenantId" = ${tenantId}::uuid
           AND e.action IN ('APPOINTMENT_STATUS_CHANGED','APPOINTMENT_RESCHEDULED')
           AND e."occurredAt" >= ${f.start} AND e."occurredAt" < ${f.endExclusive}
           AND (${f.unitId}::uuid IS NULL OR a."unitId" = ${f.unitId}::uuid)
           AND (${f.allowedUnits === null} OR a."unitId" = ANY(string_to_array(${f.allowedUnits?.join(',') ?? ''}, ',')::uuid[]))`,
      this.prisma.scoped.patient.count({ where: { tenantId, active: true, deletedAt: null, ...patientUnitFilter } }),
      this.prisma.scoped.patient.count({ where: { tenantId, createdAt: inPeriod, ...patientUnitFilter } }),
      this.prisma.scoped.patient.count({ where: { tenantId, OR: [{ active: false }, { deletedAt: { not: null } }], updatedAt: inPeriod, ...patientUnitFilter } }),
      this.prisma.scoped.patient.groupBy({ by: ['unitId'], where: { tenantId, active: true, deletedAt: null, ...patientUnitFilter }, _count: { _all: true } }),
      this.prisma.scoped.patient.groupBy({ by: ['source'], where: { tenantId, createdAt: inPeriod, ...patientUnitFilter }, _count: { _all: true } }),
      this.prisma.scoped.patientTag.groupBy({ by: ['tagId'], where: { tenantId, patient: { ...patientUnitFilter } }, _count: { _all: true } }),
      this.prisma.scoped.conversation.count({ where: { tenantId, ...unitFilter, createdAt: inPeriod } }),
      this.prisma.scoped.conversation.groupBy({ by: ['status'], where: { tenantId, ...unitFilter }, _count: { _all: true } }),
      this.prisma.scoped.task.count({ where: { tenantId, ...unitFilter, createdAt: inPeriod } }),
      this.prisma.scoped.task.count({ where: { tenantId, ...unitFilter, status: 'DONE', completedAt: inPeriod } }),
      this.prisma.scoped.task.count({ where: { tenantId, ...unitFilter, status: { in: ['TODO', 'IN_PROGRESS'] }, dueAt: { lt: new Date() } } }),
      this.prisma.scoped.message.groupBy({ by: ['direction', 'actor', 'origin', 'status'], where: { tenantId, createdAt: inPeriod, conversation: unitFilter }, _count: { _all: true } }),
      this.prisma.scoped.automationExecution.groupBy({ by: ['status'], where: { tenantId, ...unitFilter, scheduledAt: inPeriod }, _count: { _all: true } }),
      f.allowedUnits === null ? this.prisma.scoped.outboxMessage.groupBy({ by: ['status'], where: { tenantId, createdAt: inPeriod }, _count: { _all: true } }) : Promise.resolve([] as Array<{ status: string; _count: { _all: number } }>),
      this.prisma.scoped.task.count({ where: { tenantId, ...unitFilter, automationId: { not: null }, createdAt: inPeriod } }),
      this.prisma.scoped.referral.groupBy({ by: ['status'], where: { tenantId, ...unitFilter, createdAt: inPeriod }, _count: { _all: true } }),
      this.prisma.scoped.referralEvent.groupBy({ by: ['event'], where: { tenantId, referral: { ...unitFilter }, createdAt: inPeriod }, _count: { _all: true } }),
      this.prisma.scoped.referralReward.groupBy({ by: ['status'], where: { tenantId, ...unitFilter, createdAt: inPeriod }, _count: { _all: true } }),
      this.prisma.scoped.referralRewardUse.count({ where: { tenantId, ...unitFilter, createdAt: inPeriod } }),
      this.prisma.scoped.npsSurvey.groupBy({ by: ['score'], where: { tenantId, ...unitFilter, status: 'RESPONDED', responseSource: 'STAFF_RECORDED', respondedAt: inPeriod, score: { not: null } }, _count: { _all: true } }),
      this.prisma.unscoped.$queryRaw<Array<{ day: string; responses: bigint; promoters: bigint; detractors: bigint }>>`
        SELECT to_char(date_trunc('day', "respondedAt" AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS day,
               count(*)::bigint AS responses,
               count(*) FILTER (WHERE score >= 9)::bigint AS promoters,
               count(*) FILTER (WHERE score <= 6)::bigint AS detractors
           FROM "NpsSurvey" WHERE "tenantId" = ${tenantId}::uuid AND status = 'RESPONDED' AND "responseSource" = 'STAFF_RECORDED' AND score BETWEEN 0 AND 10
           AND "respondedAt" >= ${f.start} AND "respondedAt" < ${f.endExclusive}
           AND (${f.unitId}::uuid IS NULL OR "unitId" = ${f.unitId}::uuid)
           AND (${f.allowedUnits === null} OR "unitId" = ANY(string_to_array(${f.allowedUnits?.join(',') ?? ''}, ',')::uuid[]))
         GROUP BY 1 ORDER BY 1`,
      this.prisma.scoped.task.count({ where: { tenantId, ...unitFilter, title: { startsWith: 'Follow-up NPS:' }, status: { in: ['TODO', 'IN_PROGRESS'] } } }),
      this.prisma.scoped.unit.findMany({ where: { tenantId, active: true, ...(f.allowedUnits ? { id: { in: f.allowedUnits } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.scoped.satisfactionSurvey.groupBy({ by: ['classification'], where: { tenantId, ...unitFilter, state: 'RESPONDED', respondedAt: inPeriod }, _count: { _all: true } }),
    ]);

    const countMap = (rows: Array<{ status: string; _count: { _all: number } }>) => Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
    const appointmentStatus = countMap(appointmentStatusRows as unknown as Array<{ status: string; _count: { _all: number } }>);
    const conversationStatus = countMap(conversationStates as unknown as Array<{ status: string; _count: { _all: number } }>);
    const automationStatus = countMap(automationStates as unknown as Array<{ status: string; _count: { _all: number } }>);
    const outboxStatus = countMap(outboxStates as unknown as Array<{ status: string; _count: { _all: number } }>);
    const eventCount = (action: string, to?: string) => appointmentEvents.filter((event) => event.action === action && (to === undefined || event.to === to)).length;
    const procedureIds = procedures.flatMap((x) => x.procedureId ? [x.procedureId] : []);
    const procedureRows = procedureIds.length ? await this.prisma.scoped.procedure.findMany({ where: { tenantId, id: { in: procedureIds } }, select: { id: true, name: true } }) : [];
    const professionalIds = resources.map((x) => x.resourceId);
    const professionalRows = professionalIds.length ? await this.prisma.scoped.unitResource.findMany({ where: { tenantId, id: { in: professionalIds } }, select: { id: true, name: true } }) : [];
    const unitNames = new Map(units.map((x) => [x.id, x.name]));
    const tagIds = tagRows.map((x) => x.tagId);
    const tags = tagIds.length ? await this.prisma.scoped.patientTagDefinition.findMany({ where: { tenantId, id: { in: tagIds } }, select: { id: true, name: true } }) : [];
    const scoreCounts = Object.fromEntries(Array.from({ length: 11 }, (_, score) => [score, npsDistribution.find((x) => x.score === score)?._count._all ?? 0]));
    const npsCount = npsDistribution.reduce((total, row) => total + row._count._all, 0);
    const promoters = npsDistribution.filter((x) => (x.score ?? -1) >= 9).reduce((total, row) => total + row._count._all, 0);
    const detractors = npsDistribution.filter((x) => (x.score ?? 11) <= 6).reduce((total, row) => total + row._count._all, 0);
    const nps = npsCount ? Math.round(((promoters - detractors) / npsCount) * 100) : null;
    const npsTrend = npsTrendRows.map((x) => ({ day: x.day, responses: Number(x.responses), nps: Math.round(((Number(x.promoters) - Number(x.detractors)) / Number(x.responses)) * 100) }));
    const humanResponseTime = await this.humanResponseMinutes(f);
    const rescheduled = eventCount('APPOINTMENT_RESCHEDULED');
    const referralsByEvent = Object.fromEntries(referralEvents.map((x) => [x.event, x._count._all]));
    const rewardsByStatus = countMap(rewards as unknown as Array<{ status: string; _count: { _all: number } }>);

    return {
      period: { from: f.from, to: f.to, timezone: 'America/Sao_Paulo' },
      selectedUnitId: f.unitId,
      units,
      appointments: {
        created: appointmentCreated, confirmed: eventCount('APPOINTMENT_STATUS_CHANGED', 'CONFIRMED'), completed: appointmentCompleted,
        cancelled: eventCount('APPOINTMENT_STATUS_CHANGED', 'CANCELLED'), noShow: eventCount('APPOINTMENT_STATUS_CHANGED', 'NO_SHOW'),
        rescheduled, createdDefinition: 'createdAt no período', scheduledStatusDefinition: 'status atual de agendamentos com startsAt no período',
        completedDefinition: 'completedAt no período; confirmações, cancelamentos, faltas e reagendamentos usam eventos auditados por occurredAt', currentStatusByAppointmentDate: appointmentStatus, trends: appointmentTrend.map((x) => ({ day: x.day, count: Number(x.count) })),
        byProcedure: procedures.map((x) => ({ procedureId: x.procedureId, name: procedureRows.find((p) => p.id === x.procedureId)?.name ?? 'Procedimento removido', count: x._count._all })),
        byProfessional: resources.map((x) => ({ name: professionalRows.find((r) => r.id === x.resourceId)?.name ?? 'Profissional removido', count: x._count._all })),
        eventCountsByDate: { confirmed: eventCount('APPOINTMENT_STATUS_CHANGED', 'CONFIRMED'), cancelled: eventCount('APPOINTMENT_STATUS_CHANGED', 'CANCELLED'), noShow: eventCount('APPOINTMENT_STATUS_CHANGED', 'NO_SHOW') },
      },
      patients: {
        active: patientsActive, newInPeriod: patientsNew, archivedUpdatedInPeriod: patientsArchived,
        archivedDefinition: 'cadastro atualmente inativo/arquivado com updatedAt no período; não há timestamp exclusivo de arquivamento',
        byPreferredUnit: patientsByUnit.map((x) => ({ unitId: x.unitId, unitName: x.unitId ? unitNames.get(x.unitId) ?? 'Unidade indisponível' : 'Sem unidade preferencial', count: x._count._all })),
        bySource: patientsBySource.map((x) => ({ source: x.source ?? 'Não informado', count: x._count._all })),
        byTag: tagRows.map((x) => ({ tag: tags.find((tag) => tag.id === x.tagId)?.name ?? 'Etiqueta removida', count: x._count._all })),
      },
      service: {
        conversationsCreated: conversationsCreated,
        conversationsWaitingHuman: conversationStatus.WAITING_HUMAN ?? 0,
        conversationsAssigned: await this.prisma.scoped.conversation.count({ where: { tenantId, ...unitFilter, assignedToId: { not: null }, status: { not: 'CLOSED' } } }),
        tasksCreated: tasksCreated, tasksCompleted: tasksDone, tasksOverdue: overdueTasks,
        humanResponseMinutes: humanResponseTime.value,
        humanResponseUnavailableReason: humanResponseTime.reason,
        messages: messageStates.map((x) => ({ direction: x.direction, actor: x.actor, origin: x.origin, status: x.status, count: x._count._all })),
      },
      automations: {
        executions: automationStatus, simulated: f.allowedUnits === null ? (outboxStatus.SIMULATED ?? 0) : null, suppressed: f.allowedUnits === null ? (outboxStatus.SUPPRESSED ?? 0) : null,
        failed: f.allowedUnits === null ? (automationStatus.FAILED ?? 0) + (outboxStatus.FAILED ?? 0) : automationStatus.FAILED ?? 0, tasksCreatedByAutomation: automationTasks,
        delivered: f.allowedUnits === null ? (outboxStatus.DELIVERED ?? 0) + (outboxStatus.READ ?? 0) : null,
        outboxStatus: f.allowedUnits === null ? outboxStatus : null,
        unitStatusUnavailableReason: f.allowedUnits === null ? null : 'OutboxMessage não possui unitId; patient.unitId é preferencial e não comprova a unidade do envio.',
        deliveryNote: 'SIMULATED é uma fila lógica, não uma entrega; SENT, DELIVERED e READ são estados distintos do provedor.',
      },
      referrals: {
        linksIssued: await this.prisma.scoped.referralParticipant.count({ where: { tenantId, ...unitFilter, createdAt: inPeriod } }),
        clicks: referralsByEvent.CLICKED ?? 0, leads: referralsByEvent.LEAD_REGISTERED ?? 0,
        qualified: referralsByEvent.QUALIFIED ?? 0, conversions: referralsByEvent.NATIVE_APPOINTMENT_CONVERTED ?? 0,
        referralStatus: countMap(referralRows as unknown as Array<{ status: string; _count: { _all: number } }>),
        rewards: rewardsByStatus, vouchersUsed: voucherUses,
        vouchersIssued: await this.prisma.scoped.referralReward.count({ where: { tenantId, ...unitFilter, issuedAt: inPeriod } }),
        expiredVouchers: await this.prisma.scoped.referralReward.count({ where: { tenantId, ...unitFilter, status: 'EXPIRED', expiresAt: inPeriod } }),
        conversionsAreNotRevenue: true,
      },
      satisfaction5: { responses: satisfactionRows.reduce((total, row) => total + row._count._all, 0), distribution: Object.fromEntries(satisfactionRows.map((row) => [row.classification ?? 'UNKNOWN', row._count._all])), npsEquivalent: false },
      nps: { responses: npsCount, nps, promoters, detractors, passives: npsDistribution.filter((x) => (x.score ?? -1) === 7 || (x.score ?? -1) === 8).reduce((total, row) => total + row._count._all, 0), distribution: scoreCounts, trend: npsTrend, followupsPending: followupPending, followupsCreated: await this.prisma.scoped.task.count({ where: { tenantId, ...unitFilter, title: { startsWith: 'Follow-up NPS:' }, createdAt: inPeriod } }), followupsCompleted: await this.prisma.scoped.task.count({ where: { tenantId, ...unitFilter, title: { startsWith: 'Follow-up NPS:' }, status: 'DONE', completedAt: inPeriod } }) },
    };
  }

  async exportCsv(query: ReportQuery) {
    const f = await this.filter(query);
    const data = await this.overview({ from: f.from, to: f.to, unitId: f.unitId ?? undefined });
    const flat: Array<[string, string | number | null]> = [
      ['period_from', f.from], ['period_to', f.to], ['timezone', 'America/Sao_Paulo'],
      ['appointments_created', data.appointments.created], ['appointments_confirmed_current', data.appointments.confirmed],
      ['appointments_completed_by_completed_at', data.appointments.completed], ['appointments_cancelled_current', data.appointments.cancelled],
      ['appointments_no_show_current', data.appointments.noShow], ['appointments_rescheduled_events', data.appointments.rescheduled],
      ['patients_active_current', data.patients.active], ['patients_new', data.patients.newInPeriod],
      ['conversations_created', data.service.conversationsCreated], ['conversations_waiting_human_current', data.service.conversationsWaitingHuman],
      ['tasks_created', data.service.tasksCreated], ['tasks_completed', data.service.tasksCompleted], ['tasks_overdue_current', data.service.tasksOverdue],
      ['outbox_simulated_not_delivered', data.automations.simulated], ['outbox_suppressed', data.automations.suppressed], ['automation_failed', data.automations.failed],
      ['referral_links_issued', data.referrals.linksIssued], ['referral_clicks', data.referrals.clicks], ['referral_leads', data.referrals.leads], ['referral_conversions', data.referrals.conversions],
      ['vouchers_issued', data.referrals.vouchersIssued], ['vouchers_used', data.referrals.vouchersUsed], ['vouchers_expired', data.referrals.expiredVouchers],
      ['nps_responses', data.nps.responses], ['nps_score', data.nps.nps], ['nps_promoters', data.nps.promoters], ['nps_detractors', data.nps.detractors], ['nps_followups_pending', data.nps.followupsPending], ['nps_followups_completed', data.nps.followupsCompleted],
      ...data.appointments.byProcedure.map((row) => [`appointments_by_procedure_${row.name}`, row.count] as [string, number]),
      ...data.appointments.byProfessional.map((row) => [`appointments_by_professional_${row.name}`, row.count] as [string, number]),
      ...data.patients.byPreferredUnit.map((row) => [`active_patients_by_unit_${row.unitName}`, row.count] as [string, number]),
      ...data.patients.bySource.map((row) => [`patients_by_source_${row.source}`, row.count] as [string, number]),
      ...data.patients.byTag.map((row) => [`patients_by_tag_${row.tag}`, row.count] as [string, number]),
      ...data.service.messages.map((row) => [`messages_${row.direction}_${row.actor}_${row.origin}_${row.status}`, row.count] as [string, number]),
      ...Object.entries(data.automations.executions).map(([status, count]) => [`automation_executions_${status}`, count] as [string, number]),
      ...Object.entries(data.referrals.referralStatus).map(([status, count]) => [`referrals_${status}`, count] as [string, number]),
      ...Object.entries(data.referrals.rewards).map(([status, count]) => [`rewards_${status}`, count] as [string, number]),
      ...Object.entries(data.satisfaction5.distribution).map(([classification, count]) => [`satisfaction5_${classification}`, count] as [string, number]),
      ...Object.entries(data.nps.distribution).map(([score, count]) => [`nps_score_${score}`, count] as [string, number]),
      ...data.appointments.trends.map((x) => [`appointments_on_${x.day}`, x.count] as [string, number]),
      ...data.nps.trend.flatMap((x) => [[`nps_responses_on_${x.day}`, x.responses] as [string, number], [`nps_score_on_${x.day}`, x.nps] as [string, number]]),
    ];
    if (flat.length > 1000) throw new BadRequestException('A exportação excede o limite de 1.000 linhas agregadas; reduza o período ou filtre uma unidade.');
    const csv = ['metric,value', ...flat.map(([key, value]) => `${csvCell(key)},${csvCell(value ?? '')}`)].join('\r\n');
    await this.prisma.scoped.auditEvent.create({ data: { tenantId: f.scope.tenantId, actorUserId: f.scope.userId, action: 'REPORT_EXPORTED', entityType: 'Report', metadata: { from: f.from, to: f.to, unitId: f.unitId, rows: flat.length, includesPatientIdentifiers: false } } });
    return `\uFEFF${csv}\r\n`;
  }

  async npsSettings() {
    const f = await this.filter({});
    return await this.prisma.scoped.npsSettings.findUnique({ where: { tenantId: f.scope.tenantId } }) ?? {
      enabled: false, unitId: null, eligibleProcedureIds: [], delayHours: 24,
      question: 'De 0 a 10, o quanto você recomendaria nossa clínica?', allowComment: true,
      repeatAfterDays: 0, windowStartMinute: 480, windowEndMinute: 1200,
      createFollowupBelow: null, followupDueHours: 24, responsibleUserId: null,
    };
  }

  async saveNpsSettings(input: Record<string, unknown>) {
    const f = await this.filter({ unitId: typeof input.unitId === 'string' && input.unitId ? input.unitId : undefined });
    const number = (key: string, min: number, max: number, fallback: number) => { const v = input[key] === undefined ? fallback : Number(input[key]); if (!Number.isInteger(v) || v < min || v > max) throw new BadRequestException(`${key} fora do intervalo.`); return v; };
    const enabled = input.enabled === true;
    const procedureIds = Array.isArray(input.eligibleProcedureIds) ? [...new Set(input.eligibleProcedureIds.filter((x): x is string => typeof x === 'string'))].slice(0, 100) : [];
    const unitId = typeof input.unitId === 'string' && input.unitId ? input.unitId : null;
    if (unitId) await this.filter({ unitId });
    if (procedureIds.length) {
      const count = await this.prisma.scoped.procedure.count({ where: { tenantId: f.scope.tenantId, id: { in: procedureIds }, active: true, ...(unitId ? { OR: [{ unitId }, { unitId: null }] } : {}) } });
      if (count !== procedureIds.length) throw new BadRequestException('Procedimento elegível inválido para o escopo selecionado.');
    }
    const question = typeof input.question === 'string' ? input.question.trim() : 'De 0 a 10, o quanto você recomendaria nossa clínica?';
    if (question.length < 10 || question.length > 1000) throw new BadRequestException('A pergunta deve ter entre 10 e 1000 caracteres.');
    const threshold = input.createFollowupBelow === null || input.createFollowupBelow === '' || input.createFollowupBelow === undefined ? null : Number(input.createFollowupBelow);
    if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0 || threshold > 6)) throw new BadRequestException('O follow-up por NPS deve usar uma nota entre 0 e 6.');
    const delayHours = number('delayHours', 0, 720, 24);
    const repeatAfterDays = number('repeatAfterDays', 0, 365, 0);
    const windowStartMinute = number('windowStartMinute', 0, 1439, 480);
    const windowEndMinute = number('windowEndMinute', 1, 1440, 1200);
    const followupDueHours = number('followupDueHours', 1, 720, 24);
    if (windowStartMinute >= windowEndMinute) throw new BadRequestException('A janela de contato deve terminar depois do horário de início.');
    let responsibleUserId = typeof input.responsibleUserId === 'string' && input.responsibleUserId ? input.responsibleUserId : null;
    if (threshold !== null) {
      if (!responsibleUserId) throw new BadRequestException('Selecione a pessoa responsável pelas tarefas de NPS baixo.');
      const membership = await this.prisma.scoped.membership.findFirst({ where: { tenantId: f.scope.tenantId, userId: responsibleUserId, status: 'ACTIVE', user: { active: true }, ...(unitId ? { OR: [{ role: 'TENANT_ADMIN' }, { unitScopes: { some: { unitId } } }] } : { role: 'TENANT_ADMIN' }) }, select: { id: true } });
      if (!membership) throw new BadRequestException('A pessoa responsável não tem acesso ao escopo do NPS.');
    }
    return this.prisma.unscoped.$transaction(async (tx) => {
      const row = await tx.npsSettings.upsert({
        where: { tenantId: f.scope.tenantId },
        create: { tenantId: f.scope.tenantId, enabled, unitId, eligibleProcedureIds: procedureIds as Prisma.InputJsonValue, delayHours, question, allowComment: input.allowComment !== false, repeatAfterDays, windowStartMinute, windowEndMinute, createFollowupBelow: threshold, followupDueHours, responsibleUserId },
        update: { enabled, unitId, eligibleProcedureIds: procedureIds as Prisma.InputJsonValue, delayHours, question, allowComment: input.allowComment !== false, repeatAfterDays, windowStartMinute, windowEndMinute, createFollowupBelow: threshold, followupDueHours, responsibleUserId },
      });
      const cancelled = !enabled ? await tx.npsSurvey.updateMany({ where: { tenantId: f.scope.tenantId, status: 'PLANNED' }, data: { status: 'CANCELLED' } }) : { count: 0 };
      await tx.auditEvent.create({ data: { tenantId: f.scope.tenantId, actorUserId: f.scope.userId, action: 'NPS_SETTINGS_UPDATED', entityType: 'NpsSettings', entityId: row.id, metadata: { enabled, unitId, eligibleProcedureCount: procedureIds.length, createFollowupBelow: threshold, cancelledPlannedSurveys: cancelled.count } } });
      return row;
    });
  }

  async npsSurveys(query: ReportQuery & { status?: string; page?: string; pageSize?: string }) {
    const f = await this.filter(query);
    if (query.status && !['PLANNED', 'RESPONDED', 'CANCELLED', 'SUPPRESSED', 'FAILED'].includes(query.status)) throw new BadRequestException('Status de pesquisa NPS inválido.');
    const page = positiveInt(query.page, 1, 100000);
    const pageSize = positiveInt(query.pageSize, 25, 100);
    const where = { tenantId: f.scope.tenantId, ...(f.allowedUnits ? { unitId: { in: f.allowedUnits } } : {}), OR: [{ scheduledAt: { gte: f.start, lt: f.endExclusive } }, { respondedAt: { gte: f.start, lt: f.endExclusive } }], ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await this.prisma.unscoped.$transaction([
      this.prisma.unscoped.npsSurvey.findMany({ where, select: { id: true, unitId: true, appointmentId: true, scheduledAt: true, status: true, question: true, allowComment: true, score: true, responseSource: true, respondedAt: true, followupTaskId: true, unit: { select: { name: true } }, appointment: { select: { startsAt: true, procedure: { select: { name: true } } } } }, orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.unscoped.npsSurvey.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async recordNpsResponse(id: string, input: Record<string, unknown>) {
    const f = await this.filter({});
    const score = Number(input.score);
    if (!Number.isInteger(score) || score < 0 || score > 10) throw new BadRequestException('A nota NPS deve ser um inteiro entre 0 e 10.');
    const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
    if (comment.length > 2000) throw new BadRequestException('O comentário deve ter no máximo 2.000 caracteres.');
    const result = await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "NpsSurvey" WHERE "tenantId" = ${f.scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const survey = await tx.npsSurvey.findFirst({ where: { tenantId: f.scope.tenantId, id, ...(f.allowedUnits ? { unitId: { in: f.allowedUnits } } : {}) } });
      if (!survey) throw new NotFoundException('Pesquisa NPS não encontrada.');
      if (survey.status !== 'PLANNED') throw new BadRequestException('A pesquisa já foi respondida ou encerrada.');
      if (survey.scheduledAt > new Date()) throw new BadRequestException('A pesquisa ainda não chegou ao horário programado.');
      const settings = await tx.npsSettings.findUnique({ where: { tenantId: f.scope.tenantId } });
      if (comment && !survey.allowComment) throw new BadRequestException('Esta pesquisa não permite comentários.');
      const updated = await tx.npsSurvey.update({ where: { tenantId_id: { tenantId: f.scope.tenantId, id } }, data: { status: 'RESPONDED', score, comment: comment || null, responseSource: 'STAFF_RECORDED', respondedByUserId: f.scope.userId, respondedAt: new Date() } });
      let task = null;
      if (settings?.enabled && settings.createFollowupBelow !== null && score <= settings.createFollowupBelow && survey.status === 'PLANNED') {
        const assignee = settings.responsibleUserId ?? f.scope.userId;
        task = await tx.task.create({ data: { tenantId: f.scope.tenantId, unitId: survey.unitId, patientId: survey.patientId, appointmentId: survey.appointmentId, title: `Follow-up NPS: nota ${score}`, description: `Acompanhamento interno de uma resposta NPS registrada pela equipe. Pesquisa ${survey.id}. Motivo: nota igual ou inferior a ${settings.createFollowupBelow}.`, assignedToId: assignee, createdById: f.scope.userId, priority: score <= 3 ? TaskPriority.HIGH : TaskPriority.NORMAL, dueAt: new Date(Date.now() + settings.followupDueHours * 3600000) } });
        await tx.taskHistory.create({ data: { tenantId: f.scope.tenantId, taskId: task.id, actorUserId: f.scope.userId, action: 'NPS_FOLLOWUP_CREATED', after: { surveyId: survey.id, score, source: 'STAFF_RECORDED' } } });
        await tx.npsSurvey.update({ where: { tenantId_id: { tenantId: f.scope.tenantId, id } }, data: { followupTaskId: task.id } });
      }
      await tx.auditEvent.create({ data: { tenantId: f.scope.tenantId, actorUserId: f.scope.userId, action: 'NPS_RESPONSE_RECORDED', entityType: 'NpsSurvey', entityId: id, metadata: { score, source: 'STAFF_RECORDED', followupTaskId: task?.id ?? null, commentRecorded: Boolean(comment) } } });
      return { ...updated, followupTaskId: task?.id ?? updated.followupTaskId };
    });
    return result;
  }

  async planNpsForCompletedAppointment(tx: Prisma.TransactionClient, tenantId: string, appointmentId: string) {
    const appointment = await tx.appointment.findFirst({ where: { tenantId, id: appointmentId }, include: { patient: { select: { active: true, deletedAt: true } } } });
    if (!appointment || appointment.source !== 'NATIVE' || appointment.status !== 'COMPLETED' || !appointment.completedAt || !appointment.patient.active || appointment.patient.deletedAt) return;
    const settings = await tx.npsSettings.findUnique({ where: { tenantId: appointment.tenantId } });
    if (!settings?.enabled || (settings.unitId && settings.unitId !== appointment.unitId)) return;
    const procedures = Array.isArray(settings.eligibleProcedureIds) ? settings.eligibleProcedureIds as string[] : [];
    if (procedures.length && (!appointment.procedureId || !procedures.includes(appointment.procedureId))) return;
    const consent = await tx.consentPreference.findFirst({ where: { tenantId: appointment.tenantId, patientId: appointment.patientId, channel: 'WHATSAPP', purpose: 'SATISFACTION_SURVEY', status: 'GRANTED' }, select: { id: true } });
    if (!consent) return;
    if (settings.repeatAfterDays > 0) {
      const last = await tx.npsSurvey.findFirst({ where: { tenantId: appointment.tenantId, patientId: appointment.patientId, status: 'RESPONDED', respondedAt: { gte: new Date(Date.now() - settings.repeatAfterDays * 86400000) } }, select: { id: true } });
      if (last) return;
    }
    const scheduledAt = nextAllowedContactTime(new Date(appointment.completedAt.getTime() + settings.delayHours * 3600000), settings.windowStartMinute, settings.windowEndMinute);
    const created = await tx.npsSurvey.upsert({ where: { tenantId_appointmentId: { tenantId: appointment.tenantId, appointmentId } }, create: { tenantId: appointment.tenantId, unitId: appointment.unitId, appointmentId, patientId: appointment.patientId, scheduledAt, question: settings.question, allowComment: settings.allowComment }, update: {} });
    await tx.auditEvent.create({ data: { tenantId: appointment.tenantId, action: 'NPS_SURVEY_PLANNED', entityType: 'NpsSurvey', entityId: created.id, metadata: { appointmentId, scheduledAt: scheduledAt.toISOString(), outboundMessageCreated: false } } });
  }

  private async humanResponseMinutes(f: Awaited<ReturnType<ReportsService['filter']>>) {
    const rows = await this.prisma.unscoped.$queryRaw<Array<{ averageMinutes: number | null; sampleCount: bigint }>>`
      WITH responses AS (
        SELECT o."tenantId", o."conversationId", o."sentAt",
          (SELECT max(i."createdAt") FROM "Message" i
            WHERE i."tenantId" = o."tenantId" AND i."conversationId" = o."conversationId" AND i.direction = 'INBOUND'
              AND i."createdAt" <= o."sentAt" AND i."createdAt" >= ${f.start} AND i."createdAt" < ${f.endExclusive}
              AND NOT EXISTS (SELECT 1 FROM "Message" prior WHERE prior."tenantId" = o."tenantId" AND prior."conversationId" = o."conversationId" AND prior.direction = 'OUTBOUND' AND prior.actor = 'HUMAN' AND prior.status IN ('SENT','DELIVERED','READ') AND prior."sentAt" > i."createdAt" AND prior."sentAt" < o."sentAt")
          ) AS "inboundAt"
          FROM "Message" o JOIN "Conversation" c ON c."tenantId" = o."tenantId" AND c.id = o."conversationId"
         WHERE o."tenantId" = ${f.scope.tenantId}::uuid AND o.direction = 'OUTBOUND' AND o.actor = 'HUMAN'
           AND o.origin IN ('HUMAN','AI_DRAFT_HUMAN_APPROVED') AND o.status IN ('SENT','DELIVERED','READ')
           AND o."sentAt" >= ${f.start} AND o."sentAt" < ${f.endExclusive}
           AND (${f.unitId}::uuid IS NULL OR c."unitId" = ${f.unitId}::uuid)
           AND (${f.allowedUnits === null} OR c."unitId" = ANY(string_to_array(${f.allowedUnits?.join(',') ?? ''}, ',')::uuid[]))
      )
      SELECT avg(extract(epoch from ("sentAt" - "inboundAt"))/60)::float8 AS "averageMinutes", count(*) FILTER (WHERE "inboundAt" IS NOT NULL)::bigint AS "sampleCount" FROM responses`;
    const row = rows[0];
    if (!row || Number(row.sampleCount) === 0) return { value: null, reason: 'Não há pares de mensagem recebida e resposta humana efetivamente enviada no período.' };
    return { value: Math.round(Number(row.averageMinutes) * 10) / 10, reason: null };
  }
}

function localMidnight(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const utc = Date.UTC(year!, month! - 1, day!);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utc));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const localAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return new Date(utc - (localAsUtc - utc));
}
function localToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function validDateOnly(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T12:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function addDays(value: string, days: number) { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function positiveInt(value: string | undefined, fallback: number, max: number) { const parsed = Number(value ?? fallback); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback; }
function csvCell(value: unknown) { let text = String(value ?? ''); if (/^\s*[=+@-]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }
function nextAllowedContactTime(candidate: Date, startMinute: number, endMinute: number) { const result = new Date(candidate); for (let attempt = 0; attempt < 4 * 24 * 60; attempt++, result.setTime(result.getTime() + 60000)) { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(result); const minute = Number(parts.find((x) => x.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((x) => x.type === 'minute')?.value ?? 0); if (minute >= startMinute && minute < endMinute) return new Date(result); } return candidate; }
