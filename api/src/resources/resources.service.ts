import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UnitResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { SchedulingRulesService } from '../appointments/scheduling-rules.service.js';

const RESOURCE_TYPES = Object.values(UnitResourceType);
const START_INTERVALS = [5, 10, 15, 20, 30, 60];

@Injectable()
export class ResourcesService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext, private readonly rules: SchedulingRulesService) {}

  async list(unitId: string) {
    const scope = this.scope();
    await this.assertUnit(unitId);
    const [resources, procedures] = await Promise.all([
      this.prisma.scoped.unitResource.findMany({ where: { tenantId: scope.tenantId, unitId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
      this.prisma.scoped.procedure.findMany({ where: { tenantId: scope.tenantId, active: true, OR: [{ unitId }, { unitId: null }] }, include: { resourceRequirements: true }, orderBy: { name: 'asc' } }),
    ]);
    return { resources, procedures };
  }

  async create(input: Record<string, unknown>) {
    const scope = this.requireManager();
    const unitId = this.string(input.unitId, 'Unidade');
    await this.assertUnit(unitId);
    const name = this.name(input.name);
    const type = this.type(input.type);
    const startIntervalMinutes = this.startInterval(input.startIntervalMinutes);
    return this.prisma.unscoped.$transaction(async (tx) => {
      await this.rules.lockUnit(tx, scope.tenantId, unitId);
      const resource = await tx.unitResource.create({ data: { tenantId: scope.tenantId, unitId, name, type, startIntervalMinutes } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'UNIT_RESOURCE_CREATED', entityType: 'UnitResource', entityId: resource.id, metadata: { unitId, type, name, startIntervalMinutes } } });
      return resource;
    });
  }

  async update(id: string, input: Record<string, unknown>) {
    const scope = this.requireManager();
    const current = await this.prisma.scoped.unitResource.findFirst({ where: { tenantId: scope.tenantId, id } });
    if (!current) throw new NotFoundException('Recurso não encontrado.');
    await this.assertUnit(current.unitId);
    const data: { name?: string; active?: boolean; startIntervalMinutes?: number | null } = {};
    if (input.name !== undefined) data.name = this.name(input.name);
    if (input.active !== undefined) {
      if (typeof input.active !== 'boolean') throw new BadRequestException('Status do recurso inválido.');
      data.active = input.active;
    }
    if (input.startIntervalMinutes !== undefined) data.startIntervalMinutes = this.startInterval(input.startIntervalMinutes);
    if (!Object.keys(data).length) throw new BadRequestException('Informe nome, status ou intervalo entre inícios para atualizar.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      await this.rules.lockUnit(tx, scope.tenantId, current.unitId);
      const resource = await tx.unitResource.update({ where: { id }, data });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'UNIT_RESOURCE_UPDATED', entityType: 'UnitResource', entityId: id, metadata: { unitId: current.unitId, ...data } } });
      return resource;
    });
  }

  async setProcedureRequirements(procedureId: string, unitId: string, raw: unknown) {
    const scope = this.requireManager();
    await this.assertUnit(unitId);
    const procedure = await this.prisma.scoped.procedure.findFirst({ where: { tenantId: scope.tenantId, id: procedureId, active: true, OR: [{ unitId }, { unitId: null }] } });
    if (!procedure) throw new NotFoundException('Procedimento não encontrado para esta unidade.');
    if (!Array.isArray(raw)) throw new BadRequestException('Informe a lista de recursos obrigatórios.');
    const requirements = raw.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new BadRequestException('Requisito de recurso inválido.');
      const item = entry as Record<string, unknown>;
      const resourceType = this.type(item.resourceType);
      const quantity = Number(item.quantity ?? 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new BadRequestException('A quantidade exigida deve ficar entre 1 e 10.');
      return { tenantId: scope.tenantId, procedureId, resourceType, quantity };
    });
    if (new Set(requirements.map((item) => item.resourceType)).size !== requirements.length) throw new BadRequestException('Cada tipo de recurso pode aparecer uma única vez.');
    await this.prisma.unscoped.$transaction(async (tx) => {
      await this.rules.lockUnit(tx, scope.tenantId, unitId);
      await tx.procedureResourceRequirement.deleteMany({ where: { tenantId: scope.tenantId, procedureId } });
      if (requirements.length) await tx.procedureResourceRequirement.createMany({ data: requirements });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'PROCEDURE_RESOURCES_UPDATED', entityType: 'Procedure', entityId: procedureId, metadata: { unitId, requirements: requirements.map(({ resourceType, quantity }) => ({ resourceType, quantity })) } } });
    });
    return this.prisma.scoped.procedureResourceRequirement.findMany({ where: { tenantId: scope.tenantId, procedureId }, orderBy: { resourceType: 'asc' } });
  }

  private async assertUnit(unitId: string) {
    const scope = this.scope();
    const unit = await this.prisma.scoped.unit.findFirst({ where: { tenantId: scope.tenantId, id: unitId, active: true }, select: { id: true } });
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    if (!['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'].includes(scope.role)) {
      const link = await this.prisma.scoped.unitMembership.findFirst({ where: { tenantId: scope.tenantId, membershipId: scope.membershipId, unitId } });
      if (!link) throw new ForbiddenException('Unidade fora do seu escopo.');
    }
  }

  private scope() {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    return scope;
  }

  private requireManager() {
    const scope = this.scope();
    if (!['PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER'].includes(scope.role)) throw new ForbiddenException('Somente administrador ou gerente pode configurar recursos.');
    return scope;
  }

  private name(value: unknown) {
    if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 120) throw new BadRequestException('Nome deve ter entre 2 e 120 caracteres.');
    return value.trim();
  }

  private string(value: unknown, label: string) {
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${label} obrigatória.`);
    return value.trim();
  }

  private type(value: unknown): UnitResourceType {
    if (typeof value !== 'string' || !RESOURCE_TYPES.includes(value as UnitResourceType)) throw new BadRequestException('Tipo de recurso inválido.');
    return value as UnitResourceType;
  }
  private startInterval(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !START_INTERVALS.includes(value)) throw new BadRequestException('O intervalo entre inícios deve ser 5, 10, 15, 20, 30 ou 60 minutos.');
    return value;
  }
}
