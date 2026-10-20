import { ForbiddenException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../security/tenant-context.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new PrismaClient();

  constructor(private readonly tenantContext: TenantContext) {}

  get unscoped() { return this.client; }

  get scoped() {
    const scope = this.tenantContext.current();
    if (!scope) throw new ForbiddenException('Operação Prisma sem contexto de tenant.');

    return this.client.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const tenantId = scope.tenantId;
            const input = args as Record<string, any>;
            const where = input.where ?? {};
            const write = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(operation);
            const uniqueWhere = ['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert'].includes(operation);
            const constrain = (filter: Record<string, any>) => uniqueWhere
              ? { ...filter, tenantId }
              : { AND: [filter, { tenantId }] };

            if (model === 'Tenant') {
              if (!['create', 'createMany'].includes(operation)) input.where = uniqueWhere ? { ...where, id: tenantId } : { AND: [where, { id: tenantId }] };
              if (write) throw new ForbiddenException('Alterações em tenants exigem fluxo administrativo próprio.');
            } else if (['Unit', 'Membership', 'Subscription', 'UsageEntry', 'AuditEvent', 'AuthSession', 'UserInvitation', 'PasswordRecoveryToken', 'PrivacyRequest', 'PrivacyRequestEvent', 'Patient', 'PatientTagDefinition', 'PatientTag', 'PatientNote', 'PatientDocument', 'QuickReply', 'MetaConnection', 'MetaWebhookEvent', 'EvolutionConnection', 'EvolutionWebhookEvent', 'ConsentPreference', 'ConsentEvent', 'Procedure', 'ProcedureResourceRequirement', 'Appointment', 'AppointmentResource', 'UnitResource', 'UnitWorkingInterval', 'UnitScheduleException', 'UnitScheduleExceptionInterval', 'UnitScheduleBlock', 'AutomationExecution', 'SatisfactionSurvey', 'SatisfactionSurveyEvent', 'NpsSettings', 'NpsSurvey', 'UnoConnection', 'UnoEvent', 'Conversation', 'ConversationStage', 'ConversationAssignment', 'Task', 'TaskHistory', 'Message', 'Campaign', 'Automation', 'OutboxMessage', 'AiSettings', 'AiDraft', 'ReferralCampaign', 'ReferralCampaignUnit', 'ReferralParticipant', 'Referral', 'ReferralEvent', 'ReferralReward', 'ReferralRewardSource', 'ReferralRewardUse'].includes(model)) {
              if (!['create', 'createMany'].includes(operation)) input.where = constrain(where);
              if (write) {
                const data = input.data;
                const values = Array.isArray(data) ? data : data ? [data] : [];
                for (const value of values) {
                  if (value.tenantId !== undefined && value.tenantId !== tenantId) {
                    throw new ForbiddenException('A operação ultrapassa o tenant autenticado.');
                  }
                  if (['create', 'createMany'].includes(operation)) value.tenantId = tenantId;
                }
                if (operation === 'upsert') {
                  if (input.create.tenantId && input.create.tenantId !== tenantId) throw new ForbiddenException();
                  if (input.update?.tenantId !== undefined && input.update.tenantId !== tenantId) throw new ForbiddenException('A operação ultrapassa o tenant autenticado.');
                  input.create.tenantId = tenantId;
                }
              }
            } else if (model === 'User') {
              if (!['create', 'createMany'].includes(operation)) input.where = uniqueWhere ? { ...where, memberships: { some: { tenantId, status: 'ACTIVE' } } } : { AND: [where, { memberships: { some: { tenantId, status: 'ACTIVE' } } }] };
              if (write) throw new ForbiddenException('Usuários globais só podem ser criados pelo fluxo de convite.');
            } else if (model === 'UnitMembership') {
              if (!['create', 'createMany'].includes(operation)) {
                const scopeFilter = { unit: { is: { tenantId } }, membership: { is: { tenantId } } };
                input.where = uniqueWhere ? { ...where, ...scopeFilter } : { AND: [where, scopeFilter] };
              }
              if (write) throw new ForbiddenException('Vínculos de unidade devem ser criados pelo fluxo de convite.');
            } else if (model === 'Plan') {
              if (write) throw new ForbiddenException('Planos são dados globais de administração.');
            } else {
              throw new ForbiddenException(`Modelo Prisma ${model} sem política de tenant definida.`);
            }
            return query(input);
          },
        },
      },
    });
  }

  async onModuleInit() {
    if (process.env.DATABASE_URL) await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
