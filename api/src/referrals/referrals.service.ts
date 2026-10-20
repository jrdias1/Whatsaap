import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ReferralCampaignStatus, ReferralQualificationCriterion, ReferralRewardStatus, ReferralRewardType, ReferralStatus, Prisma } from '@prisma/client';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';

const QUALIFIED: ReferralStatus[] = ['QUALIFIED', 'CONVERTED'];
const PHONE = /^[0-9]{12,13}$/;

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}

  private scope(admin = true) {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    if (admin && scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Somente administrador pode gerenciar campanhas e recompensas.');
    return scope;
  }

  async listCampaigns() {
    const { tenantId } = this.scope();
    return this.prisma.scoped.referralCampaign.findMany({ where: { tenantId }, include: { units: { include: { unit: { select: { id: true, name: true } } } }, _count: { select: { participants: true, referrals: true, rewards: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
  }

  async createCampaign(input: Record<string, unknown>) {
    const scope = this.scope();
    const name = this.string(input.name, 'Nome', 2, 120);
    const description = input.description == null ? null : this.string(input.description, 'Descrição', 0, 1000);
    const units = this.unitIds(input.unitIds);
    const startsAt = this.date(input.startsAt, 'Início');
    const endsAt = input.endsAt == null || input.endsAt === '' ? null : this.date(input.endsAt, 'Término');
    if (endsAt && endsAt <= startsAt) throw new BadRequestException('Término deve ser posterior ao início.');
    const criterion = input.qualificationCriterion;
    if (!Object.values(ReferralQualificationCriterion).includes(criterion as ReferralQualificationCriterion)) throw new BadRequestException('Critério©rio de qualificação inválido.');
    const rewardType = input.rewardType;
    if (!Object.values(ReferralRewardType).includes(rewardType as ReferralRewardType)) throw new BadRequestException('Tipo de benefício inválido.');
    const rewardEvery = this.integer(input.rewardEveryQualifiedCount ?? 1, 'Quantidade para recompensa', 1, 100_000);
    const rewardQuantity = this.integer(input.rewardQuantity ?? 1, 'Quantidade do benefício', 1, 100);
    const validity = this.integer(input.rewardValidityDays ?? 90, 'Validade', 1, 3650);
    const maxRewards = this.integer(input.maxRewardsPerParticipant ?? 1, 'Limite por participante', 1, 1000);
    const rewardDescription = this.string(input.rewardDescription, 'Descrição do benefício', 2, 500);
    if (input.requireHumanApproval === false) throw new BadRequestException('Aprovação humana é obrigatória para qualquer recompensa.');
    await this.assertUnits(scope.tenantId, units);
    const row = await this.prisma.unscoped.$transaction(async (tx) => {
      const created = await tx.referralCampaign.create({
        data: {
          tenantId: scope.tenantId, name, description, startsAt, endsAt,
          qualificationCriterion: criterion as ReferralQualificationCriterion,
          rewardEveryQualifiedCount: rewardEvery, rewardType: rewardType as ReferralRewardType,
          rewardQuantity, rewardDescription, rewardValidityDays: validity,
          maxRewardsPerParticipant: maxRewards, requireHumanApproval: true,
          createdById: scope.userId,
        },
      });
      await tx.referralCampaignUnit.createMany({ data: units.map((unitId) => ({ tenantId: scope.tenantId, campaignId: created.id, unitId })) });
      const withUnits = await tx.referralCampaign.findUniqueOrThrow({ where: { tenantId_id: { tenantId: scope.tenantId, id: created.id } }, include: { units: { include: { unit: { select: { id: true, name: true } } } } } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'REFERRAL_CAMPAIGN_CREATED', entityType: 'ReferralCampaign', entityId: created.id, metadata: { qualificationCriterion: created.qualificationCriterion, rewardEveryQualifiedCount: rewardEvery, rewardType: created.rewardType, unitIds: units } } });
      return withUnits;
    });
    return row;
  }

  async updateCampaign(id: string, input: Record<string, unknown>) {
    const scope = this.scope();
    const current = await this.prisma.scoped.referralCampaign.findFirst({ where: { tenantId: scope.tenantId, id }, include: { units: true } });
    if (!current) throw new NotFoundException('Campanha de indicação não encontrada.');
    if (current.status === 'ACTIVE') throw new ConflictException('Pause a campanha antes de alterar suas regras.');
    const name = input.name === undefined ? current.name : this.string(input.name, 'Nome', 2, 120);
    const description = input.description === undefined ? current.description : input.description == null ? null : this.string(input.description, 'Descrição', 0, 1000);
    const startsAt = input.startsAt === undefined ? current.startsAt : this.date(input.startsAt, 'Início');
    const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt == null || input.endsAt === '' ? null : this.date(input.endsAt, 'Término');
    if (endsAt && endsAt <= startsAt) throw new BadRequestException('Término deve ser posterior ao início.');
    const units = input.unitIds === undefined ? current.units.map((item) => item.unitId) : this.unitIds(input.unitIds);
    await this.assertUnits(scope.tenantId, units);
    const criterion = input.qualificationCriterion === undefined ? current.qualificationCriterion : input.qualificationCriterion as ReferralQualificationCriterion;
    if (!Object.values(ReferralQualificationCriterion).includes(criterion)) throw new BadRequestException('Critério©rio de qualificação inválido.');
    const rewardType = input.rewardType === undefined ? current.rewardType : input.rewardType as ReferralRewardType;
    if (!Object.values(ReferralRewardType).includes(rewardType)) throw new BadRequestException('Tipo de benefício inválido.');
    if (input.requireHumanApproval === false) throw new BadRequestException('Aprovação humana é obrigatória.');
    const patch = {
      name, description, startsAt, endsAt, qualificationCriterion: criterion, rewardType,
      rewardEveryQualifiedCount: input.rewardEveryQualifiedCount === undefined ? current.rewardEveryQualifiedCount : this.integer(input.rewardEveryQualifiedCount, 'Quantidade para recompensa', 1, 100_000),
      rewardQuantity: input.rewardQuantity === undefined ? current.rewardQuantity : this.integer(input.rewardQuantity, 'Quantidade do benefício', 1, 100),
      rewardDescription: input.rewardDescription === undefined ? current.rewardDescription : this.string(input.rewardDescription, 'Descrição do benefício', 2, 500),
      rewardValidityDays: input.rewardValidityDays === undefined ? current.rewardValidityDays : this.integer(input.rewardValidityDays, 'Validade', 1, 3650),
      maxRewardsPerParticipant: input.maxRewardsPerParticipant === undefined ? current.maxRewardsPerParticipant : this.integer(input.maxRewardsPerParticipant, 'Limite por participante', 1, 1000),
    };
    const result = await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.referralCampaignUnit.deleteMany({ where: { tenantId: scope.tenantId, campaignId: id } });
      await tx.referralCampaign.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data: patch });
      await tx.referralCampaignUnit.createMany({ data: units.map((unitId) => ({ tenantId: scope.tenantId, campaignId: id, unitId })) });
      const result = await tx.referralCampaign.findUniqueOrThrow({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, include: { units: { include: { unit: { select: { id: true, name: true } } } } } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'REFERRAL_CAMPAIGN_UPDATED', entityType: 'ReferralCampaign', entityId: id, metadata: { qualificationCriterion: criterion, unitIds: units } } });
      return result;
    });
    return result;
  }

  async setCampaignStatus(id: string, value: string) {
    const scope = this.scope();
    if (!['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'].includes(value)) throw new BadRequestException('Estado de campanha inválido.');
    const campaign = await this.prisma.scoped.referralCampaign.findFirst({ where: { id, tenantId: scope.tenantId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    if (value === 'ACTIVE' && campaign.endsAt && campaign.endsAt <= new Date()) throw new BadRequestException('Esta campanha já terminou.');
    const updated = await this.prisma.scoped.referralCampaign.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data: { status: value as ReferralCampaignStatus } });
    await this.prisma.scoped.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: `REFERRAL_CAMPAIGN_${value}`, entityType: 'ReferralCampaign', entityId: id } });
    return updated;
  }

  async issueParticipantLink(campaignId: string, patientId: string, unitId: string) {
    const scope = this.scope();
    const now = new Date();
    const campaign = await this.prisma.scoped.referralCampaign.findFirst({ where: { tenantId: scope.tenantId, id: campaignId, status: 'ACTIVE', units: { some: { unitId } } }, select: { id: true, startsAt: true, endsAt: true } });
    if (!campaign) throw new NotFoundException('A campanha não está ativa ou não participa desta unidade.');
    if (campaign.startsAt > now) throw new BadRequestException(`Esta campanha está programada para começar em ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(campaign.startsAt)}.`);
    if (campaign.endsAt && campaign.endsAt <= now) throw new BadRequestException('Esta campanha já terminou.');
    const patient = await this.prisma.scoped.patient.findFirst({ where: { tenantId: scope.tenantId, id: patientId, active: true, deletedAt: null, OR: [{ unitId }, { unitId: null }] }, select: { id: true } });
    if (!patient) throw new NotFoundException('Paciente não encontrado nesta unidade.');
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(rawToken);
    const participant = await this.prisma.unscoped.referralParticipant.upsert({ where: { tenantId_campaignId_patientId: { tenantId: scope.tenantId, campaignId, patientId } }, create: { tenantId: scope.tenantId, campaignId, patientId, unitId, shareTokenHash: tokenHash }, update: { unitId, shareTokenHash: tokenHash } });
    await this.prisma.scoped.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'REFERRAL_LINK_ISSUED', entityType: 'ReferralParticipant', entityId: participant.id, metadata: { campaignId, unitId } } });
    const base = (process.env.PUBLIC_APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    return { participantId: participant.id, link: `${base}/indicacao/${rawToken}`, token: rawToken };
  }

  async registerClick(shareToken: string, clickKeyValue: unknown) {
    const clickKey = this.string(clickKeyValue, 'Identificador de clique', 16, 100);
    const participant = await this.prisma.unscoped.referralParticipant.findFirst({ where: { shareTokenHash: this.hash(shareToken), campaign: { status: 'ACTIVE', startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } }, include: { campaign: true } });
    if (!participant) throw new NotFoundException('Link de indicação inválido ou expirado.');
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET deve conter 32 caracteres para proteger o link de cadastro.');
    const claimToken = createHmac('sha256', secret).update(`${participant.id}:${clickKey}`).digest('base64url');
    const claimHash = this.hash(claimToken);
    let referral = await this.prisma.unscoped.referral.findFirst({ where: { tenantId: participant.tenantId, clickKey } });
    if (!referral) {
      try {
        referral = await this.prisma.unscoped.$transaction(async (tx) => {
          const created = await tx.referral.create({ data: { tenantId: participant.tenantId, campaignId: participant.campaignId, participantId: participant.id, indicatorPatientId: participant.patientId, unitId: participant.unitId, clickKey, claimTokenHash: claimHash } });
          await tx.referralEvent.create({ data: { tenantId: participant.tenantId, referralId: created.id, event: 'CLICKED', metadata: { campaignId: participant.campaignId, unitId: participant.unitId } } });
          return created;
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        referral = await this.prisma.unscoped.referral.findFirst({ where: { tenantId: participant.tenantId, clickKey } });
      }
    }
    if (!referral || referral.participantId !== participant.id) throw new ConflictException('Identificador de clique já utilizado.');
    return { claimToken, next: 'REGISTER_LEAD', consentRecorded: false, patientCreated: false };
  }

  async registerLead(claimToken: string, phoneInput: unknown) {
    if (typeof claimToken !== 'string' || claimToken.length < 32 || claimToken.length > 200) throw new NotFoundException('Link de cadastro inválido.');
    const phone = this.phone(phoneInput);
    const result = await this.prisma.unscoped.$transaction(async (tx) => {
      const referral = await tx.referral.findFirst({ where: { claimTokenHash: this.hash(claimToken) }, include: { campaign: true, indicatorPatient: { select: { phoneNormalized: true } } } });
      if (!referral) throw new NotFoundException('Link de cadastro inválido.');
      await tx.$executeRaw`SELECT id FROM "Referral" WHERE "tenantId" = ${referral.tenantId}::uuid AND id = ${referral.id}::uuid FOR UPDATE`;
      const current = await tx.referral.findUniqueOrThrow({ where: { tenantId_id: { tenantId: referral.tenantId, id: referral.id } } });
      if (current.status !== 'CLICKED') return { accepted: ['LEAD_REGISTERED', 'PATIENT_LINKED', 'QUALIFIED', 'CONVERTED'].includes(current.status), status: current.status, patientCreated: false, consentRecorded: false };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${referral.tenantId}:referral-lead:${phone}`}, 0))`;
      const indicatorPhone = this.normalizeDigits(referral.indicatorPatient.phoneNormalized);
      if (indicatorPhone && indicatorPhone === phone) {
        await tx.referral.update({ where: { tenantId_id: { tenantId: referral.tenantId, id: referral.id } }, data: { status: 'REJECTED', leadPhoneNormalized: phone } });
        await tx.referralEvent.create({ data: { tenantId: referral.tenantId, referralId: referral.id, event: 'SELF_REFERRAL_REJECTED', metadata: { match: 'NORMALIZED_PHONE' } } });
        return { accepted: false, status: 'REJECTED', patientCreated: false, consentRecorded: false };
      }
      const active = referral.campaign.status === 'ACTIVE' && referral.campaign.startsAt <= new Date() && (!referral.campaign.endsAt || referral.campaign.endsAt > new Date());
      if (!active) throw new ConflictException('A campanha não está aceitando novas indicações.');
      const duplicate = await tx.referral.findFirst({ where: { tenantId: referral.tenantId, leadPhoneNormalized: phone, id: { not: referral.id } }, select: { id: true } });
      if (duplicate) {
        await tx.referral.update({ where: { tenantId_id: { tenantId: referral.tenantId, id: referral.id } }, data: { status: 'REJECTED' } });
        await tx.referralEvent.create({ data: { tenantId: referral.tenantId, referralId: referral.id, event: 'DUPLICATE_LEAD_REJECTED', metadata: { priority: 'FIRST_REGISTERED_LEAD' } } });
        return { accepted: false, status: 'REJECTED', patientCreated: false, consentRecorded: false };
      }
      const updated = await tx.referral.update({ where: { tenantId_id: { tenantId: referral.tenantId, id: referral.id } }, data: { status: 'LEAD_REGISTERED', leadPhoneNormalized: phone, leadRegisteredAt: new Date() } });
      await tx.referralEvent.create({ data: { tenantId: referral.tenantId, referralId: referral.id, event: 'LEAD_REGISTERED', metadata: { consentRecorded: false, patientCreated: false } } });
      if (referral.campaign.qualificationCriterion === 'LEAD_REGISTERED') {
        await tx.referral.update({ where: { tenantId_id: { tenantId: referral.tenantId, id: referral.id } }, data: { status: 'QUALIFIED', qualifiedAt: new Date(), qualificationEvidence: 'Lead com telefone normalizado; critério da campanha.' } });
        await tx.referralEvent.create({ data: { tenantId: referral.tenantId, referralId: referral.id, event: 'QUALIFIED', metadata: { criterion: 'LEAD_REGISTERED' } } });
        await this.createMilestoneRewards(tx, referral.tenantId, referral.campaignId, referral.participantId, referral.unitId);
      }
      return { id: updated.id, accepted: true, status: referral.campaign.qualificationCriterion === 'LEAD_REGISTERED' ? 'QUALIFIED' : 'LEAD_REGISTERED', patientCreated: false, consentRecorded: false };
    });
    return result;
  }

  async associatePatient(referralId: string, patientId: string) {
    const scope = this.scope();
    const referral = await this.prisma.scoped.referral.findFirst({ where: { tenantId: scope.tenantId, id: referralId }, include: { campaign: { include: { units: true } } } });
    if (!referral) throw new NotFoundException('Indicação não encontrada.');
    const allowed = referral.campaign.units.map((item) => item.unitId);
    if (scope.role !== 'TENANT_ADMIN' && !allowed.includes(referral.unitId)) throw new ForbiddenException('Unidade fora do escopo.');
    const patient = await this.prisma.scoped.patient.findFirst({ where: { tenantId: scope.tenantId, id: patientId, active: true, deletedAt: null, OR: [{ unitId: referral.unitId }, { unitId: null }] } });
    if (!patient || (referral.leadPhoneNormalized && this.normalizeDigits(patient.phoneNormalized) !== referral.leadPhoneNormalized)) throw new BadRequestException('Paciente não corresponde ao contato informado na indicação.');
    const indicatorPhone = this.normalizeDigits((await this.prisma.scoped.patient.findFirst({ where: { id: referral.indicatorPatientId }, select: { phoneNormalized: true } }))?.phoneNormalized);
    const referredPhone = this.normalizeDigits(patient.phoneNormalized);
    if (indicatorPhone && referredPhone && indicatorPhone === referredPhone) throw new ConflictException('Autoindicação não permitida.');
    try {
      return await this.prisma.unscoped.$transaction(async (tx) => {
        const statusAfterLink = referral.status === 'QUALIFIED' ? 'QUALIFIED' : 'PATIENT_LINKED';
        const updated = await tx.referral.updateMany({ where: { tenantId: scope.tenantId, id: referral.id, patientId: null, status: { in: ['LEAD_REGISTERED', 'QUALIFIED', 'PENDING_VERIFICATION'] } }, data: { patientId, status: statusAfterLink, patientLinkedAt: new Date() } });
        if (!updated.count) throw new ConflictException('A indicação já foi associada ou não aceita vínculo.');
        await tx.referralEvent.create({ data: { tenantId: scope.tenantId, referralId: referral.id, actorId: scope.userId, event: 'PATIENT_LINKED', metadata: { patientId, unitId: referral.unitId } } });
        await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'REFERRAL_PATIENT_LINKED', entityType: 'Referral', entityId: referral.id, metadata: { patientId } } });
        return { referralId: referral.id, patientId, status: statusAfterLink };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Este paciente já está atribuído a uma indicação neste tenant.');
      throw error;
    }
  }

  async recordNativeAppointmentCompletion(tx: Prisma.TransactionClient, appointmentId: string, actorId: string) {
    const appointment = await tx.appointment.findFirst({ where: { id: appointmentId, source: 'NATIVE', status: 'COMPLETED', completedAt: { not: null } }, select: { id: true, tenantId: true, unitId: true, patientId: true, completedAt: true } });
    if (!appointment) return 0;
    const candidates = await tx.referral.findMany({ where: { tenantId: appointment.tenantId, unitId: appointment.unitId, patientId: appointment.patientId, status: { in: ['PATIENT_LINKED', 'LEAD_REGISTERED'] }, campaign: { status: 'ACTIVE', qualificationCriterion: 'FIRST_NATIVE_APPOINTMENT_COMPLETED', startsAt: { lte: appointment.completedAt! }, OR: [{ endsAt: null }, { endsAt: { gt: appointment.completedAt! } }] } }, select: { id: true, campaignId: true, participantId: true, unitId: true, createdAt: true } });
    let converted = 0;
    for (const candidate of candidates) {
      if (appointment.completedAt! < candidate.createdAt) continue;
      await tx.$queryRaw`SELECT id FROM "Referral" WHERE "tenantId" = ${appointment.tenantId}::uuid AND id = ${candidate.id}::uuid FOR UPDATE`;
      const current = await tx.referral.findUnique({ where: { tenantId_id: { tenantId: appointment.tenantId, id: candidate.id } } });
      if (!current || !['PATIENT_LINKED', 'LEAD_REGISTERED'].includes(current.status) || current.appointmentId) continue;
      const prior = await tx.appointment.count({ where: { tenantId: appointment.tenantId, patientId: appointment.patientId, unitId: appointment.unitId, source: 'NATIVE', status: 'COMPLETED', id: { not: appointment.id }, completedAt: { gte: candidate.createdAt, lte: appointment.completedAt! } } });
      if (prior) continue;
      const result = await tx.referral.updateMany({ where: { tenantId: appointment.tenantId, id: candidate.id, status: { in: ['PATIENT_LINKED', 'LEAD_REGISTERED'] }, appointmentId: null }, data: { status: 'CONVERTED', appointmentId: appointment.id, convertedAt: appointment.completedAt, qualifiedAt: appointment.completedAt, qualificationEvidence: 'Native appointment completion confirmed by the local API.' } });
      if (!result.count) continue;
      await tx.referralEvent.create({ data: { tenantId: appointment.tenantId, referralId: candidate.id, actorId, event: 'NATIVE_APPOINTMENT_CONVERTED', metadata: { appointmentId: appointment.id, status: 'COMPLETED', source: 'NATIVE_API' } } });
      await this.createMilestoneRewards(tx, appointment.tenantId, candidate.campaignId, candidate.participantId, candidate.unitId);
      converted++;
    }
    return converted;
  }

  async listReferrals(campaignId?: string) {
    const scope = this.scope();
    return this.prisma.scoped.referral.findMany({ where: { tenantId: scope.tenantId, ...(campaignId ? { campaignId } : {}) }, include: { campaign: { select: { id: true, name: true, qualificationCriterion: true } }, indicatorPatient: { select: { id: true, fullName: true } }, patient: { select: { id: true, fullName: true, phoneNormalized: true } }, appointment: { select: { id: true, status: true, source: true, completedAt: true } }, events: { orderBy: { createdAt: 'asc' } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 500 });
  }

  async changeReferralStatus(id: string, value: string, reasonValue: unknown) {
    const scope = this.scope();
    if (!['PENDING_VERIFICATION', 'REJECTED', 'CANCELLED', 'REVERSED'].includes(value)) throw new BadRequestException('Estado de revisão inválido.');
    const reason = this.string(reasonValue, 'Motivo da decisão', 3, 500);
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Referral" WHERE "tenantId" = ${scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const referral = await tx.referral.findFirst({ where: { tenantId: scope.tenantId, id } });
      if (!referral) throw new NotFoundException('Indicação não encontrada.');
      if (['CANCELLED', 'REVERSED', 'REJECTED'].includes(referral.status)) throw new ConflictException('A indicação já foi encerrada.');
      const linkedRewards = await tx.referralRewardSource.findMany({ where: { tenantId: scope.tenantId, referralId: id }, include: { reward: true } });
      if (value === 'REVERSED' && linkedRewards.some(({ reward }) => reward.usedQty > 0)) throw new ConflictException('Benefício já utilizado; a reversão precisa de revisão humana fora do fluxo automático.');
      const updated = await tx.referral.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data: { status: value as ReferralStatus, qualificationEvidence: reason } });
      if (value === 'REVERSED' || value === 'CANCELLED') await tx.referralReward.updateMany({ where: { tenantId: scope.tenantId, id: { in: linkedRewards.map(({ reward }) => reward.id) }, usedQty: 0, status: { in: ['PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY_USED'] } }, data: { status: 'CANCELLED', decisionReason: reason } });
      await tx.referralEvent.create({ data: { tenantId: scope.tenantId, referralId: id, actorId: scope.userId, event: value, metadata: { reason, cancelledUnusedRewards: value === 'REVERSED' || value === 'CANCELLED' } } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: `REFERRAL_${value}`, entityType: 'Referral', entityId: id, metadata: { reason } } });
      return updated;
    });
  }

  async rewards(status?: string) {
    const scope = this.scope();
    if (status && !Object.values(ReferralRewardStatus).includes(status as ReferralRewardStatus)) throw new BadRequestException('Estado de recompensa inválido.');
    return this.prisma.scoped.referralReward.findMany({ where: { tenantId: scope.tenantId, ...(status ? { status: status as ReferralRewardStatus } : {}) }, include: { campaign: { select: { id: true, name: true } }, participant: { include: { patient: { select: { id: true, fullName: true } } } }, unit: { select: { id: true, name: true } }, sources: { include: { referral: { select: { id: true, status: true, patientId: true } } } }, uses: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 500 });
  }

  async decideReward(id: string, action: 'APPROVE' | 'REJECT', reasonValue?: unknown) {
    const scope = this.scope();
    const reason = reasonValue == null ? null : this.string(reasonValue, 'Motivo', 3, 500);
    if (action === 'REJECT' && !reason) throw new BadRequestException('Informe o motivo da recusa.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ReferralReward" WHERE "tenantId" = ${scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const reward = await tx.referralReward.findFirst({ where: { tenantId: scope.tenantId, id } });
      if (!reward) throw new NotFoundException('Recompensa não encontrada.');
      if (reward.status !== 'PENDING_APPROVAL') throw new ConflictException('A recompensa já foi decidida.');
      const status: ReferralRewardStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = await tx.referralReward.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data: { status, approvedById: action === 'APPROVE' ? scope.userId : null, approvedAt: action === 'APPROVE' ? new Date() : null, decisionReason: reason } });
      const sources = await tx.referralRewardSource.findMany({ where: { tenantId: scope.tenantId, rewardId: id }, select: { referralId: true } });
      if (sources.length) await tx.referralEvent.createMany({ data: sources.map(({ referralId }) => ({ tenantId: scope.tenantId, referralId, actorId: scope.userId, event: `REWARD_${status}`, metadata: { rewardId: id, reason } })) });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: `REFERRAL_REWARD_${status}`, entityType: 'ReferralReward', entityId: id, metadata: { reason } } });
      return updated;
    });
  }

  async issueReward(id: string) {
    const scope = this.scope();
    const code = randomBytes(18).toString('base64url').toUpperCase();
    const voucherHash = this.hash(code);
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ReferralReward" WHERE "tenantId" = ${scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const reward = await tx.referralReward.findFirst({ where: { tenantId: scope.tenantId, id }, include: { campaign: true } });
      if (!reward) throw new NotFoundException('Recompensa não encontrada.');
      if (reward.status !== 'APPROVED') throw new ConflictException('A recompensa precisa estar aprovada antes da emissão.');
      if (reward.expiresAt && reward.expiresAt <= new Date()) throw new ConflictException('A aprovação expirou; aprove novamente conforme a política da clínica.');
      const now = new Date();
      const updated = await tx.referralReward.update({ where: { tenantId_id: { tenantId: scope.tenantId, id } }, data: { status: 'ISSUED', issuedById: scope.userId, issuedAt: now, expiresAt: new Date(now.getTime() + reward.campaign.rewardValidityDays * 86400000), voucherHash, voucherLast4: code.slice(-4) } });
      const sources = await tx.referralRewardSource.findMany({ where: { tenantId: scope.tenantId, rewardId: id }, select: { referralId: true } });
      if (sources.length) await tx.referralEvent.createMany({ data: sources.map(({ referralId }) => ({ tenantId: scope.tenantId, referralId, actorId: scope.userId, event: 'REWARD_ISSUED', metadata: { rewardId: id, expiresAt: updated.expiresAt } })) });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'REFERRAL_REWARD_ISSUED', entityType: 'ReferralReward', entityId: id, metadata: { expiresAt: updated.expiresAt, type: reward.type, quantity: reward.authorizedQty } } });
      return { ...updated, voucherCode: code };
    });
  }

  async redeemVoucher(input: Record<string, unknown>) {
    const scope = this.scope(false);
    const code = this.string(input.code, 'Voucher', 10, 100).toUpperCase();
    const unitId = this.string(input.unitId, 'Unidade', 36, 36);
    const idempotencyKey = this.string(input.idempotencyKey, 'Chave de uso', 16, 100);
    const quantity = this.integer(input.quantity ?? 1, 'Quantidade', 1, 100);
    if (scope.role !== 'TENANT_ADMIN') {
      const allowed = await this.prisma.scoped.unitMembership.findFirst({ where: { membershipId: scope.membershipId, unitId }, select: { unitId: true } });
      if (!allowed) throw new ForbiddenException('Unidade fora do escopo.');
    }
    const result = await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.tenantId}:voucher:${this.hash(code)}`}, 0))`;
      const reward = await tx.referralReward.findFirst({ where: { tenantId: scope.tenantId, voucherHash: this.hash(code) } });
      if (!reward) throw new NotFoundException('Voucher inválido.');
      const existing = await tx.referralRewardUse.findFirst({ where: { tenantId: scope.tenantId, idempotencyKey } });
      if (existing) {
        if (existing.rewardId !== reward.id || existing.unitId !== unitId || existing.quantity !== quantity) throw new ConflictException('Chave de idempotência já utilizada em outra operação.');
        return { ...existing, duplicate: true };
      }
      if (reward.unitId !== unitId) throw new ForbiddenException('Voucher não pode ser utilizado nesta unidade.');
      const now = new Date();
      if (!['ISSUED', 'PARTIALLY_USED'].includes(reward.status) || !reward.issuedAt || !reward.expiresAt || reward.expiresAt <= now) {
        if (reward.expiresAt && reward.expiresAt <= now && ['ISSUED', 'PARTIALLY_USED'].includes(reward.status)) {
          await tx.referralReward.update({ where: { tenantId_id: { tenantId: scope.tenantId, id: reward.id } }, data: { status: 'EXPIRED' } });
          return { expired: true as const };
        }
        throw new ConflictException('Voucher indisponível.');
      }
      if (reward.usedQty + quantity > reward.authorizedQty) throw new ConflictException('Uso excede a quantidade aprovada.');
      const use = await tx.referralRewardUse.create({ data: { tenantId: scope.tenantId, rewardId: reward.id, unitId, idempotencyKey, quantity, actorUserId: scope.userId } });
      await tx.referralReward.update({ where: { tenantId_id: { tenantId: scope.tenantId, id: reward.id } }, data: { usedQty: { increment: quantity }, status: reward.usedQty + quantity === reward.authorizedQty ? 'USED' : 'PARTIALLY_USED' } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'REFERRAL_REWARD_REDEEMED', entityType: 'ReferralReward', entityId: reward.id, metadata: { useId: use.id, unitId, quantity, type: reward.type, internalBenefitOnly: reward.type === 'SESSION_CREDIT' } } });
      return { ...use, duplicate: false };
    });
    if ('expired' in result) throw new ConflictException('Voucher expirado.');
    return result;
  }

  async loyaltyCard(patientId: string) {
    const scope = this.scope(false);
    const patient = await this.prisma.scoped.patient.findFirst({ where: { tenantId: scope.tenantId, id: patientId, deletedAt: null }, select: { id: true, fullName: true, unitId: true } });
    if (!patient) throw new NotFoundException('Paciente não encontrado.');
    if (scope.role !== 'TENANT_ADMIN') {
      const units = await this.prisma.scoped.unitMembership.findMany({ where: { membershipId: scope.membershipId }, select: { unitId: true } });
      if (patient.unitId && !units.some((row) => row.unitId === patient.unitId)) throw new ForbiddenException('Paciente fora do escopo de unidades.');
    }
    const [participations, referrals, rewards] = await Promise.all([
      this.prisma.scoped.referralParticipant.findMany({ where: { tenantId: scope.tenantId, patientId, campaign: { status: { in: ['ACTIVE', 'PAUSED', 'ENDED'] } } }, include: { campaign: { select: { id: true, name: true, qualificationCriterion: true, rewardEveryQualifiedCount: true, rewardType: true, rewardDescription: true, endsAt: true } } } }),
      this.prisma.scoped.referral.findMany({
        where: { tenantId: scope.tenantId, indicatorPatientId: patientId },
        include: { campaign: { select: { id: true, name: true } }, patient: { select: { id: true, fullName: true } }, events: { orderBy: { createdAt: 'asc' } } },
      }),
      this.prisma.scoped.referralReward.findMany({ where: { tenantId: scope.tenantId, participant: { patientId } }, include: { campaign: { select: { name: true } }, unit: { select: { name: true } }, uses: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    ]);
    const progress = await Promise.all(participations.map(async (participant) => {
      const [total, qualified] = await Promise.all([
        this.prisma.scoped.referral.count({ where: { tenantId: scope.tenantId, participantId: participant.id } }),
        this.prisma.scoped.referral.count({ where: { tenantId: scope.tenantId, participantId: participant.id, status: { in: QUALIFIED } } }),
      ]);
      return { campaign: participant.campaign, clicksAndLeads: total, qualified, target: participant.campaign.rewardEveryQualifiedCount, remaining: Math.max(0, participant.campaign.rewardEveryQualifiedCount - qualified) };
    }));
    return { patient, progress, referrals: referrals.map(({ leadPhoneNormalized: _phone, claimTokenHash: _claim, clickKey: _click, ...safe }) => safe), rewards };
  }

  async board() {
    const [campaigns, referrals, rewards] = await Promise.all([this.listCampaigns(), this.listReferrals(), this.rewards()]);
    return { campaigns, referrals, rewards, pendingApprovals: rewards.filter((row) => row.status === 'PENDING_APPROVAL').length, activeCampaigns: campaigns.filter((row) => row.status === 'ACTIVE').length };
  }

  private async createMilestoneRewards(tx: Prisma.TransactionClient, tenantId: string, campaignId: string, participantId: string, unitId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${campaignId}:${participantId}:referral-rewards`}, 0))`;
    const campaign = await tx.referralCampaign.findUnique({ where: { tenantId_id: { tenantId, id: campaignId } } });
    if (!campaign) return;
    const [referrals, existing] = await Promise.all([
      tx.referral.findMany({ where: { tenantId, campaignId, participantId, status: { in: QUALIFIED } }, orderBy: [{ qualifiedAt: 'asc' }, { id: 'asc' }], select: { id: true } }),
      tx.referralReward.findMany({ where: { tenantId, campaignId, participantId }, select: { milestoneNumber: true } }),
    ]);
    const rewardCount = Math.min(Math.floor(referrals.length / campaign.rewardEveryQualifiedCount), campaign.maxRewardsPerParticipant);
    const done = new Set(existing.map((row) => row.milestoneNumber));
    for (let milestone = 1; milestone <= rewardCount; milestone++) {
      if (done.has(milestone)) continue;
      const from = (milestone - 1) * campaign.rewardEveryQualifiedCount;
      const sources = referrals.slice(from, from + campaign.rewardEveryQualifiedCount);
      if (sources.length < campaign.rewardEveryQualifiedCount) continue;
      const reward = await tx.referralReward.create({ data: { tenantId, campaignId, participantId, unitId, milestoneNumber: milestone, type: campaign.rewardType, description: campaign.rewardDescription, authorizedQty: campaign.rewardQuantity, status: 'PENDING_APPROVAL', sources: { createMany: { data: sources.map(({ id }) => ({ referralId: id })) } } } });
      await tx.referralEvent.createMany({ data: sources.map(({ id }) => ({ tenantId, referralId: id, event: 'REWARD_PENDING_APPROVAL', metadata: { rewardId: reward.id, milestone } })) });
      await tx.auditEvent.create({ data: { tenantId, action: 'REFERRAL_REWARD_PENDING_APPROVAL', entityType: 'ReferralReward', entityId: reward.id, metadata: { campaignId, participantId, milestone, qualifyingCount: sources.length, approvalRequired: true } } });
    }
  }

  private async assertUnits(tenantId: string, ids: string[]) {
    const count = await this.prisma.scoped.unit.count({ where: { tenantId, id: { in: ids }, active: true } });
    if (count !== ids.length) throw new BadRequestException('Uma ou mais unidades são inválidas para este tenant.');
  }
  private unitIds(value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 20 || value.some((id) => typeof id !== 'string')) throw new BadRequestException('Selecione ao menos uma unidade participante.');
    const ids = [...new Set(value as string[])];
    if (ids.length !== value.length) throw new BadRequestException('Unidades duplicadas.');
    return ids;
  }
  private integer(value: unknown, label: string, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${label} inválido.`); return n; }
  private string(value: unknown, label: string, min: number, max: number) { if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new BadRequestException(`${label} inválido.`); return value.trim(); }
  private date(value: unknown, label: string) { if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new BadRequestException(`${label} deve incluir fuso explícito.`); const date = new Date(value); if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} inválido.`); return date; }
  private phone(value: unknown) { if (typeof value !== 'string') throw new BadRequestException('Telefone inválido.'); const digits = this.normalizeDigits(value); const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits; if (!PHONE.test(normalized) || !normalized.startsWith('55')) throw new BadRequestException('Informe telefone brasileiro válido com DDD.'); return normalized; }
  private normalizeDigits(value: string | null | undefined) { const digits = (value ?? '').replace(/\D/g, ''); return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits; }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
}
