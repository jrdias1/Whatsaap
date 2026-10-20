import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Procedure } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';

@Injectable()
export class ProceduresService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}

  async list() {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    const where: Record<string, unknown> = { active: true };
    if (scope.role === 'UNIT_MANAGER' || scope.role === 'OPERATOR') {
      const rows = await this.prisma.scoped.unitMembership.findMany({ where: { membershipId: scope.membershipId }, select: { unitId: true } });
      where.OR = [{ unitId: null }, { unitId: { in: rows.map(({ unitId }) => unitId) } }];
    }
    return this.prisma.scoped.procedure.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(input: Record<string, unknown>) {
    const scope = this.context.current();
    if (!scope || scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Somente administrador do tenant pode cadastrar procedimentos.');
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 120) throw new BadRequestException('Nome inválido.');
    const duration = Number(input.appointmentDurationMinutes);
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440) throw new BadRequestException('Duração deve ser um número inteiro entre 5 e 1440 minutos.');
    const returnAfterDays = this.optionalDays(input.returnAfterDays, 'Intervalo de retorno');
    const reminderAdvanceDays = this.optionalDays(input.reminderAdvanceDays, 'Antecedência do lembrete');
    this.validateReturnDays(returnAfterDays, reminderAdvanceDays);
    const unitId = input.unitId == null || input.unitId === '' ? null : String(input.unitId);
    if (unitId) {
      const unit = await this.prisma.scoped.unit.findFirst({ where: { id: unitId, active: true }, select: { id: true } });
      if (!unit) throw new BadRequestException('Unidade inválida para este tenant.');
    }
    let procedure: Procedure;
    try {
      procedure = await this.prisma.scoped.procedure.create({ data: { tenantId: scope.tenantId, unitId, name: input.name.trim(), appointmentDurationMinutes: duration, returnAfterDays, reminderAdvanceDays } });
    } catch (error) {
      this.rethrowProcedureConflict(error);
    }
    await this.prisma.scoped.auditEvent.create({ data: { actorUserId: scope.userId, action: 'PROCEDURE_CREATED', entityType: 'Procedure', entityId: procedure.id } });
    return procedure;
  }

  async update(id: string, input: Record<string, unknown>) {
    const scope = this.context.current();
    if (!scope || scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Somente administrador do tenant pode editar procedimentos.');
    const current = await this.prisma.scoped.procedure.findFirst({ where: { id } });
    if (!current) throw new BadRequestException('Procedimento não encontrado neste tenant.');
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 120) throw new BadRequestException('Nome inválido.');
      data.name = input.name.trim();
    }
    if (input.appointmentDurationMinutes !== undefined) {
      const duration = Number(input.appointmentDurationMinutes);
      if (!Number.isInteger(duration) || duration < 5 || duration > 1440) throw new BadRequestException('Duração deve ser um número inteiro entre 5 e 1440 minutos.');
      data.appointmentDurationMinutes = duration;
    }
    if (input.returnAfterDays !== undefined) data.returnAfterDays = this.optionalDays(input.returnAfterDays, 'Intervalo de retorno');
    if (input.reminderAdvanceDays !== undefined) data.reminderAdvanceDays = this.optionalDays(input.reminderAdvanceDays, 'Antecedência do lembrete');
    this.validateReturnDays((data.returnAfterDays as number | null | undefined) ?? (input.returnAfterDays === undefined ? current.returnAfterDays : null), (data.reminderAdvanceDays as number | null | undefined) ?? (input.reminderAdvanceDays === undefined ? current.reminderAdvanceDays : null));
    if (input.active !== undefined) {
      if (typeof input.active !== 'boolean') throw new BadRequestException('Status inválido.');
      data.active = input.active;
    }
    if (input.unitId !== undefined) {
      const unitId = input.unitId == null || input.unitId === '' ? null : String(input.unitId);
      if (unitId && !await this.prisma.scoped.unit.findFirst({ where: { id: unitId, active: true }, select: { id: true } })) throw new BadRequestException('Unidade inválida para este tenant.');
      data.unitId = unitId;
    }
    let procedure: Procedure;
    try {
      procedure = await this.prisma.scoped.procedure.update({ where: { id }, data });
    } catch (error) {
      this.rethrowProcedureConflict(error);
    }
    await this.prisma.scoped.auditEvent.create({ data: { actorUserId: scope.userId, action: 'PROCEDURE_UPDATED', entityType: 'Procedure', entityId: id } });
    return procedure;
  }

  private optionalDays(value: unknown, label: string): number | null {
    if (value == null || value === '') return null;
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw new BadRequestException(`${label} inválido.`);
    return days;
  }

  private validateReturnDays(returnAfterDays: number | null, reminderAdvanceDays: number | null) {
    if (reminderAdvanceDays !== null && returnAfterDays === null) throw new BadRequestException('Informe os dias estimados do efeito antes da antecedência do contato.');
    if (returnAfterDays !== null && reminderAdvanceDays !== null && reminderAdvanceDays > returnAfterDays) throw new BadRequestException('A antecedência não pode superar a duração estimada do efeito.');
  }

  private rethrowProcedureConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Ja existe um procedimento com este nome neste tenant.',
      );
    }
    throw error;
  }
}
