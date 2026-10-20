import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';

const TENANT_FIELDS = ['displayName', 'legalName', 'contactEmail', 'contactPhone', 'address', 'accentColor', 'secondaryColor', 'institutionalText'] as const;

@Injectable()
export class TenantSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}

  private admin() {
    const scope = this.context.current();
    if (!scope || scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Somente o administrador da clínica pode alterar configurações.');
    return scope;
  }

  async get() {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    const [tenant, units] = await Promise.all([
      this.prisma.scoped.tenant.findFirst({ where: { id: scope.tenantId }, select: { id: true, name: true, displayName: true, legalName: true, contactEmail: true, contactPhone: true, address: true, accentColor: true, secondaryColor: true, institutionalText: true } }),
      this.prisma.scoped.unit.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, contactEmail: true, contactPhone: true, address: true } }),
    ]);
    return { tenant, units };
  }

  async updateTenant(input: Record<string, unknown>) {
    const scope = this.admin();
    const data: Record<string, string | null> = {};
    for (const key of TENANT_FIELDS) if (key in input) data[key] = this.string(input[key], key, key === 'institutionalText' ? 1000 : key === 'address' ? 500 : 180);
    if (!Object.keys(data).length) throw new BadRequestException('Informe ao menos um campo permitido.');
    for (const key of ['accentColor', 'secondaryColor'] as const) {
      const color = data[key];
      if (color && (!/^#[0-9a-f]{6}$/i.test(color) || this.contrastOnWhite(color) < 4.5)) throw new BadRequestException(`${key} precisa atender contraste mínimo 4,5:1 com texto branco.`);
    }
    if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) throw new BadRequestException('E-mail de contato inválido.');
    if (data.institutionalText && /<\/?[a-z!][^>]*>/i.test(data.institutionalText)) throw new BadRequestException('Use texto simples; marcação HTML não é permitida.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({ where: { id: scope.tenantId }, data, select: { id: true, name: true, displayName: true, legalName: true, contactEmail: true, contactPhone: true, address: true, accentColor: true, secondaryColor: true, institutionalText: true } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'TENANT_BRANDING_UPDATED', entityType: 'Tenant', entityId: tenant.id, metadata: { changedFields: Object.keys(data) } } });
      return tenant;
    });
  }

  async updateUnit(id: string, input: Record<string, unknown>) {
    const scope = this.admin();
    const data: Record<string, string | null> = {};
    for (const key of ['contactEmail', 'contactPhone', 'address'] as const) if (key in input) data[key] = this.string(input[key], key, key === 'address' ? 500 : 180);
    if (!Object.keys(data).length) throw new BadRequestException('Informe contato ou endereço da unidade.');
    if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) throw new BadRequestException('E-mail de contato inválido.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const exists = await tx.unit.findFirst({ where: { id, tenantId: scope.tenantId, active: true }, select: { id: true } });
      if (!exists) throw new NotFoundException('Unidade ativa não encontrada nesta clínica.');
      const unit = await tx.unit.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data, select: { id: true, name: true, slug: true, contactEmail: true, contactPhone: true, address: true } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'UNIT_CONTACT_UPDATED', entityType: 'Unit', entityId: id, metadata: { changedFields: Object.keys(data) } } });
      return unit;
    });
  }

  async setupProgress() {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    const [tenant, unitCount, staffCount, procedureCount, resourceCount, workIntervalCount, appointmentCount, consentCount, automationCount, configuredChannels] = await Promise.all([
      this.prisma.scoped.tenant.findFirst({ where: { id: scope.tenantId }, select: { displayName: true, contactEmail: true, contactPhone: true } }),
      this.prisma.scoped.unit.count({ where: { active: true } }),
      this.prisma.scoped.membership.count({ where: { status: 'ACTIVE' } }),
      this.prisma.scoped.procedure.count({ where: { active: true } }),
      this.prisma.scoped.unitResource.count({ where: { active: true } }),
      this.prisma.scoped.unitWorkingInterval.count(),
      this.prisma.scoped.appointment.count(),
      this.prisma.scoped.consentPreference.count(),
      this.prisma.scoped.automation.count({ where: { status: 'ACTIVE' } }),
      Promise.all([this.prisma.scoped.metaConnection.count({ where: { enabled: true } }), this.prisma.scoped.evolutionConnection.count({ where: { enabled: true } })]).then(([meta, evolution]) => meta + evolution),
    ]);
    const steps = [
      { key: 'clinic', label: 'Revisar dados da clínica', complete: Boolean(tenant?.displayName && (tenant.contactEmail || tenant.contactPhone)) },
      { key: 'unit', label: 'Confirmar unidade', complete: unitCount > 0, count: unitCount },
      { key: 'team', label: 'Cadastrar equipe', complete: staffCount > 1, count: staffCount },
      { key: 'procedures', label: 'Cadastrar procedimentos', complete: procedureCount > 0, count: procedureCount },
      { key: 'resources', label: 'Configurar profissionais e recursos', complete: resourceCount > 0, count: resourceCount },
      { key: 'schedule', label: 'Definir expediente', complete: workIntervalCount > 0, count: workIntervalCount },
      { key: 'calendar', label: 'Verificar agenda', complete: appointmentCount > 0, count: appointmentCount },
      { key: 'consents', label: 'Revisar consentimentos registrados', complete: consentCount > 0, count: consentCount },
      { key: 'channels', label: 'Consultar canais (opcional; sem envio)', complete: configuredChannels > 0, count: configuredChannels, optional: true },
      { key: 'automations', label: 'Revisar automações', complete: automationCount > 0, count: automationCount, optional: true },
    ];
    const required = steps.filter((step) => !step.optional);
    return { completed: required.filter((step) => step.complete).length, total: required.length, percent: Math.round(100 * required.filter((step) => step.complete).length / required.length), steps };
  }

  private string(value: unknown, key: string, max: number) {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > max) throw new BadRequestException(`${key} deve ser texto de até ${max} caracteres.`);
    return value.trim();
  }

  private contrastOnWhite(hex: string) {
    const rgb = hex.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
    return 1.05 / (luminance + 0.05);
  }
}
