import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UnitResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const TZ = 'America/Sao_Paulo';
const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'] as const;
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

@Injectable()
export class SchedulingRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(
    tx: Prisma.TransactionClient,
    input: { tenantId: string; unitId: string; startsAt: Date; endsAt: Date; resourceIds: string[]; procedureId?: string | null; excludeAppointmentId?: string; allowOutsideHours?: boolean },
  ): Promise<{ available: boolean; reason: string | null; resources: { id: string; type: UnitResourceType; name: string }[]; outsideHours: boolean }> {
    const resourceIds = [...new Set(input.resourceIds)];
    if (resourceIds.length !== input.resourceIds.length) throw new BadRequestException('Recurso duplicado no agendamento.');
    const unit = await tx.unit.findFirst({ where: { tenantId: input.tenantId, id: input.unitId, active: true }, select: { id: true, scheduleEnabled: true } });
    if (!unit) throw new BadRequestException('Unidade inválida.');
    const resources = resourceIds.length ? await tx.unitResource.findMany({ where: { tenantId: input.tenantId, unitId: input.unitId, id: { in: resourceIds }, active: true }, select: { id: true, type: true, name: true, startIntervalMinutes: true } }) : [];
    if (resources.length !== resourceIds.length) throw new BadRequestException('Selecione somente recursos ativos desta unidade.');
    if (input.procedureId) {
      const requirements = await tx.procedureResourceRequirement.findMany({ where: { tenantId: input.tenantId, procedureId: input.procedureId } });
      for (const requirement of requirements) {
        const count = resources.filter((resource) => resource.type === requirement.resourceType).length;
        if (count < requirement.quantity) throw new BadRequestException(`O procedimento exige ${requirement.quantity} recurso(s) do tipo ${requirement.resourceType}.`);
      }
    }

    const local = this.localParts(input.startsAt);
    const startMinute = local.hour * 60 + local.minute;
    if (resources.some((resource) => resource.startIntervalMinutes && (startMinute % resource.startIntervalMinutes !== 0 || input.startsAt.getUTCSeconds() !== 0 || input.startsAt.getUTCMilliseconds() !== 0))) {
      return { available: false, reason: 'RESOURCE_START_INTERVAL', resources, outsideHours: false };
    }
    let outsideHours = false;
    if (unit.scheduleEnabled) {
      const endLocal = this.localParts(input.endsAt);
      let endMinute: number;
      if (local.date === endLocal.date) endMinute = endLocal.hour * 60 + endLocal.minute;
      else if (local.date !== endLocal.date && endLocal.hour === 0 && endLocal.minute === 0 && this.nextLocalDate(local.date) === endLocal.date) endMinute = 1440;
      else return { available: false, reason: 'CROSS_DAY', resources, outsideHours: false };
      const dateValue = new Date(`${local.date}T00:00:00.000Z`);
      const exception = await tx.unitScheduleException.findFirst({ where: { tenantId: input.tenantId, unitId: input.unitId, date: dateValue }, include: { intervals: true } });
      let intervals: { startMinute: number; endMinute: number }[];
      if (exception) intervals = exception.closed ? [] : exception.intervals;
      else intervals = await tx.unitWorkingInterval.findMany({ where: { tenantId: input.tenantId, unitId: input.unitId, weekday: local.weekday } });
      if (!intervals.some((interval) => interval.startMinute <= startMinute && interval.endMinute >= endMinute)) {
        outsideHours = true;
        if (!input.allowOutsideHours) return { available: false, reason: exception?.closed ? 'CLOSED_DATE' : 'OUTSIDE_HOURS', resources, outsideHours };
      }
    }

    const applicableBlock = await tx.unitScheduleBlock.findFirst({
      where: {
        tenantId: input.tenantId, unitId: input.unitId, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt },
        OR: [{ resourceId: null }, ...(resourceIds.length ? [{ resourceId: { in: resourceIds } }] : [])],
      }, select: { id: true, resourceId: true },
    });
    if (applicableBlock) return { available: false, reason: 'BLOCKED', resources, outsideHours };

    const resourceFilter = resourceIds.length
      ? { OR: [{ resources: { none: {} } }, { resources: { some: { resourceId: { in: resourceIds } } } }] }
      : {};
    const conflict = await tx.appointment.findFirst({
      where: {
        tenantId: input.tenantId, unitId: input.unitId, id: input.excludeAppointmentId ? { not: input.excludeAppointmentId } : undefined,
        status: { in: [...ACTIVE_STATUSES] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt }, ...resourceFilter,
      }, select: { id: true },
    });
    return { available: !conflict, reason: conflict ? (resourceIds.length ? 'RESOURCE_CONFLICT' : 'UNIT_CONFLICT') : null, resources, outsideHours };
  }

  async lockUnit(tx: Prisma.TransactionClient, tenantId: string, unitId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${unitId}:appointments`}, 0))`;
  }

  localDate(value: Date) { return this.localParts(value).date; }

  private localParts(value: Date) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      weekday: WEEKDAY[values.weekday ?? ''],
      hour: Number(values.hour),
      minute: Number(values.minute),
    };
  }

  private nextLocalDate(value: string) {
    const [year, month, day] = value.split('-').map(Number);
    const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }
}
