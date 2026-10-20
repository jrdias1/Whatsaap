import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrivacyRequestStatus, PrivacyRequestType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';

const TYPES = ['ACCESS', 'CORRECTION', 'EXPORT', 'CONSENT_REVIEW', 'ERASURE', 'ANONYMIZATION', 'DATA_USE_QUESTION'] as const;
const STATUSES: PrivacyRequestStatus[] = ['OPEN', 'UNDER_REVIEW', 'COMPLETED', 'REJECTED'];

@Injectable()
export class PrivacyService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}

  private scope() {
    const scope = this.context.current();
    if (!scope || scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Somente o administrador da clínica pode administrar solicitações de privacidade.');
    return scope;
  }

  async list() {
    const scope = this.scope();
    return this.prisma.scoped.privacyRequest.findMany({ where: { tenantId: scope.tenantId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, patientId: true, type: true, reason: true, status: true, closureReason: true, createdById: true, assignedToId: true, createdAt: true, updatedAt: true, patient: { select: { fullName: true } }, events: { orderBy: { occurredAt: 'asc' }, select: { id: true, actorUserId: true, action: true, details: true, occurredAt: true } } } });
  }

  async create(input: { patientId?: unknown; type?: unknown; reason?: unknown }) {
    const scope = this.scope();
    if (typeof input.patientId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.patientId)) throw new BadRequestException('Paciente inválido.');
    if (!TYPES.includes(input.type as (typeof TYPES)[number])) throw new BadRequestException('Tipo de solicitação inválido.');
    if (typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.trim().length > 1000) throw new BadRequestException('Descreva o pedido em 5 a 1.000 caracteres.');
    const reason = input.reason.trim();
    const patient = await this.prisma.scoped.patient.findFirst({ where: { id: input.patientId, tenantId: scope.tenantId, active: true, deletedAt: null }, select: { id: true } });
    if (!patient) throw new NotFoundException('Paciente ativo não encontrado neste tenant.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const request = await tx.privacyRequest.create({ data: { tenantId: scope.tenantId, patientId: patient.id, type: input.type as PrivacyRequestType, reason, createdById: scope.userId } });
      await tx.privacyRequestEvent.create({ data: { tenantId: scope.tenantId, privacyRequestId: request.id, actorUserId: scope.userId, action: 'REQUEST_REGISTERED', details: { type: request.type } } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'PRIVACY_REQUEST_CREATED', entityType: 'PrivacyRequest', entityId: request.id, metadata: { patientId: patient.id, type: request.type } } });
      return request;
    });
  }

  async update(id: string, input: { status?: unknown; closureReason?: unknown; assignedToId?: unknown }) {
    const scope = this.scope();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException('O identificador da solicitação é inválido.');
    if (!STATUSES.includes(input.status as PrivacyRequestStatus)) throw new BadRequestException('Status inválido.');
    if (['COMPLETED', 'REJECTED'].includes(input.status as string) && (typeof input.closureReason !== 'string' || input.closureReason.trim().length < 5 || input.closureReason.trim().length > 1000)) throw new BadRequestException('Informe o motivo do encerramento.');
    let assignedToId: string | null | undefined;
    if (input.assignedToId !== undefined) {
      if (input.assignedToId === null) assignedToId = null;
      else if (typeof input.assignedToId === 'string') {
        const member = await this.prisma.scoped.membership.findFirst({ where: { tenantId: scope.tenantId, userId: input.assignedToId, status: 'ACTIVE', user: { active: true } }, select: { userId: true } });
        if (!member) throw new BadRequestException('Responsável não pertence à clínica ou está inativo.');
        assignedToId = member.userId;
      } else throw new BadRequestException('Responsável inválido.');
    }
    return this.prisma.unscoped.$transaction(async (tx) => {
      const prior = await tx.privacyRequest.findFirst({ where: { id, tenantId: scope.tenantId }, select: { id: true, status: true, assignedToId: true } });
      if (!prior) throw new NotFoundException('Solicitação não encontrada.');
      const status = input.status as PrivacyRequestStatus;
      if (['COMPLETED', 'REJECTED'].includes(prior.status) && prior.status !== status) throw new ConflictException('Solicitação encerrada não pode ser reaberta; registre um novo pedido se necessário.');
      const closureReason = input.closureReason === undefined ? undefined : String(input.closureReason).trim();
      const updated = await tx.privacyRequest.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data: { status, ...(closureReason ? { closureReason } : {}), ...(assignedToId !== undefined ? { assignedToId } : {}) } });
      const action = prior.status === status ? 'REQUEST_DETAILS_UPDATED' : `STATUS_${status}`;
      await tx.privacyRequestEvent.create({ data: { tenantId: scope.tenantId, privacyRequestId: id, actorUserId: scope.userId, action, details: { from: prior.status, to: status, closureReason: closureReason ?? null, assignedToId: assignedToId ?? null } } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'PRIVACY_REQUEST_UPDATED', entityType: 'PrivacyRequest', entityId: id, metadata: { from: prior.status, to: status, assignedToId: assignedToId ?? null } } });
      return updated;
    });
  }
}
