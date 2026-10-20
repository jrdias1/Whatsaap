import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { SchedulingRulesService } from '../appointments/scheduling-rules.service.js';

type Interval = { startMinute: number; endMinute: number };

@Injectable()
export class UnitSchedulesService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext, private readonly rules: SchedulingRulesService) {}

  async get(unitId: string) {
    const scope = this.scope();
    await this.assertUnit(unitId);
    const today = new Date(`${this.rules.localDate(new Date())}T00:00:00.000Z`);
    const [unit, weekly, exceptions, blocks] = await Promise.all([
      this.prisma.scoped.unit.findFirstOrThrow({ where: { tenantId: scope.tenantId, id: unitId }, select: { id: true, name: true, scheduleEnabled: true } }),
      this.prisma.scoped.unitWorkingInterval.findMany({ where: { tenantId: scope.tenantId, unitId }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
      this.prisma.scoped.unitScheduleException.findMany({ where: { tenantId: scope.tenantId, unitId, date: { gte: today } }, include: { intervals: { orderBy: { startMinute: 'asc' } } }, orderBy: { date: 'asc' }, take: 120 }),
      this.prisma.scoped.unitScheduleBlock.findMany({ where: { tenantId: scope.tenantId, unitId, endsAt: { gte: new Date() } }, include: { resource: { select: { id: true, name: true, type: true } } }, orderBy: { startsAt: 'asc' }, take: 100 }),
    ]);
    return { timezone: 'America/Sao_Paulo', unit, weekly, exceptions, blocks };
  }

  async replaceWeekly(unitId: string, input: { enabled?: unknown; intervals?: unknown }) {
    const scope = this.requireManager();
    await this.assertUnit(unitId);
    if (typeof input.enabled !== 'boolean') throw new BadRequestException('Informe se a validação do expediente está ativa.');
    const enabled = input.enabled as boolean;
    const intervals = this.parseIntervals(input.intervals, true) as (Interval & { weekday: number })[];
    this.assertNoOverlap(intervals.map((interval) => ({ ...interval, dateKey: String(interval.weekday) })));
    await this.prisma.unscoped.$transaction(async (tx) => {
      await this.rules.lockUnit(tx, scope.tenantId, unitId);
      await tx.unitWorkingInterval.deleteMany({ where: { tenantId: scope.tenantId, unitId } });
      if (intervals.length) await tx.unitWorkingInterval.createMany({ data: intervals.map(({ weekday, startMinute, endMinute }) => ({ tenantId: scope.tenantId, unitId, weekday, startMinute, endMinute })) });
      await tx.unit.update({ where: { id: unitId }, data: { scheduleEnabled: enabled } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'UNIT_WORKING_HOURS_UPDATED', entityType: 'Unit', entityId: unitId, metadata: { enabled, intervals } } });
    });
    return this.get(unitId);
  }

  async setException(unitId: string, date: string, input: { closed?: unknown; label?: unknown; intervals?: unknown }) {
    const scope = this.requireManager();
    await this.assertUnit(unitId);
    const parsedDate = this.parseDate(date);
    if (typeof input.closed !== 'boolean') throw new BadRequestException('Informe se a unidade estará fechada nesta data.');
    const closed = input.closed as boolean;
    const intervals = this.parseIntervals(input.intervals, false) as Interval[];
    if (closed && intervals.length) throw new BadRequestException('Uma data fechada não pode ter intervalos abertos.');
    if (!closed && !intervals.length) throw new BadRequestException('Informe ao menos um intervalo para a exceção aberta.');
    this.assertNoOverlap(intervals.map((interval) => ({ ...interval, dateKey: date })));
    const label = input.label == null || input.label === '' ? null : String(input.label).trim().slice(0, 160);
    const exception = await this.prisma.unscoped.$transaction(async (tx) => {
      await this.rules.lockUnit(tx, scope.tenantId, unitId);
      const saved = await tx.unitScheduleException.upsert({ where: { tenantId_unitId_date: { tenantId: scope.tenantId, unitId, date: parsedDate } }, create: { tenantId: scope.tenantId, unitId, date: parsedDate, closed, label }, update: { closed, label } });
      await tx.unitScheduleExceptionInterval.deleteMany({ where: { tenantId: scope.tenantId, unitId, exceptionId: saved.id } });
      if (intervals.length) await tx.unitScheduleExceptionInterval.createMany({ data: intervals.map((interval) => ({ tenantId: scope.tenantId, unitId, exceptionId: saved.id, ...interval })) });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'UNIT_SCHEDULE_EXCEPTION_UPDATED', entityType: 'UnitScheduleException', entityId: saved.id, metadata: { unitId, date, closed, label, intervals } } });
      return saved;
    });
    return exception;
  }

  async removeException(unitId: string, date: string) {
    const scope = this.requireManager();
    await this.assertUnit(unitId);
    const parsedDate = this.parseDate(date);
    const current = await this.prisma.scoped.unitScheduleException.findFirst({ where: { tenantId: scope.tenantId, unitId, date: parsedDate } });
    if (!current) throw new NotFoundException('Exceção de expediente não encontrada.');
    await this.prisma.unscoped.$transaction(async (tx) => {
      await this.rules.lockUnit(tx, scope.tenantId, unitId);
      await tx.unitScheduleException.delete({ where: { id: current.id } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'UNIT_SCHEDULE_EXCEPTION_REMOVED', entityType: 'UnitScheduleException', entityId: current.id, metadata: { unitId, date } } });
    });
    return { removed: true };
  }

  async addBlock(unitId: string, input: Record<string, unknown>) {
    const scope = this.requireManager();
    await this.assertUnit(unitId);
    const startsAt = this.parseInstant(input.startsAt, 'Início');
    const endsAt = this.parseInstant(input.endsAt, 'Fim');
    if (endsAt <= startsAt) throw new BadRequestException('O fim do bloqueio deve ser posterior ao início.');
    const resourceId = input.resourceId == null || input.resourceId === '' ? null : String(input.resourceId);
    if (resourceId && !await this.prisma.scoped.unitResource.findFirst({ where: { tenantId: scope.tenantId, unitId, id: resourceId, active: true } })) throw new BadRequestException('Recurso inválido para esta unidade.');
    const label = input.label == null || input.label === '' ? null : String(input.label).trim().slice(0, 160);
    const block = await this.prisma.unscoped.$transaction(async (tx) => {
      await this.rules.lockUnit(tx, scope.tenantId, unitId);
      const row = await tx.unitScheduleBlock.create({ data: { tenantId: scope.tenantId, unitId, resourceId, startsAt, endsAt, label } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'UNIT_SCHEDULE_BLOCK_CREATED', entityType: 'UnitScheduleBlock', entityId: row.id, metadata: { unitId, resourceId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), label } } });
      return row;
    });
    return block;
  }

  async removeBlock(unitId: string, id: string) {
    const scope = this.requireManager();
    await this.assertUnit(unitId);
    const current = await this.prisma.scoped.unitScheduleBlock.findFirst({ where: { tenantId: scope.tenantId, unitId, id } });
    if (!current) throw new NotFoundException('Bloqueio não encontrado.');
    await this.prisma.unscoped.$transaction(async (tx) => {
      await this.rules.lockUnit(tx, scope.tenantId, unitId);
      await tx.unitScheduleBlock.delete({ where: { id } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'UNIT_SCHEDULE_BLOCK_REMOVED', entityType: 'UnitScheduleBlock', entityId: id, metadata: { unitId } } });
    });
    return { removed: true };
  }

  private parseIntervals(value: unknown, weekly: true): (Interval & { weekday: number })[];
  private parseIntervals(value: unknown, weekly: false): Interval[];
  private parseIntervals(value: unknown, weekly: boolean): (Interval & { weekday?: number })[] {
    if (!Array.isArray(value)) throw new BadRequestException('Informe uma lista de intervalos.');
    return value.map((row) => {
      if (!row || typeof row !== 'object') throw new BadRequestException('Intervalo inválido.');
      const item = row as Record<string, unknown>;
      const startMinute = Number(item.startMinute);
      const endMinute = Number(item.endMinute);
      if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || startMinute < 0 || startMinute > 1439 || endMinute < 1 || endMinute > 1440 || endMinute <= startMinute) throw new BadRequestException('Intervalo deve estar entre 00:00 e 24:00 e ter duração positiva.');
      if (!weekly) return { startMinute, endMinute };
      const weekday = Number(item.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new BadRequestException('Dia da semana inválido (0=domingo a 6=sábado).');
      return { weekday, startMinute, endMinute };
    });
  }

  private assertNoOverlap(intervals: (Interval & { dateKey: string })[]) {
    const byDay = new Map<string, Interval[]>();
    for (const interval of intervals) byDay.set(interval.dateKey, [...(byDay.get(interval.dateKey) ?? []), interval]);
    for (const day of byDay.values()) {
      day.sort((a, b) => a.startMinute - b.startMinute);
      for (let index = 1; index < day.length; index++) if (day[index]!.startMinute < day[index - 1]!.endMinute) throw new BadRequestException('Os intervalos do mesmo dia não podem se sobrepor.');
    }
  }

  private parseDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Data deve estar no formato AAAA-MM-DD.');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Data inválida.');
    return date;
  }

  private parseInstant(value: unknown, label: string) {
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${label} obrigatório.`);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} inválido.`);
    return date;
  }

  private async assertUnit(unitId: string) {
    const scope = this.scope();
    if (!unitId) throw new BadRequestException('Unidade obrigatória.');
    if (!await this.prisma.scoped.unit.findFirst({ where: { tenantId: scope.tenantId, id: unitId, active: true }, select: { id: true } })) throw new NotFoundException('Unidade não encontrada.');
    if (!['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'].includes(scope.role) && !await this.prisma.scoped.unitMembership.findFirst({ where: { tenantId: scope.tenantId, membershipId: scope.membershipId, unitId } })) throw new ForbiddenException('Unidade fora do seu escopo.');
  }

  private scope() {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    return scope;
  }

  private requireManager() {
    const scope = this.scope();
    if (!['PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER'].includes(scope.role)) throw new ForbiddenException('Somente administrador ou gerente pode configurar expediente.');
    return scope;
  }

}
