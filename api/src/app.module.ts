import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';
import { InvitationMailerService } from './users/invitation-mailer.service.js';
import { PatientsController } from './patients/patients.controller.js';
import { PatientsService } from './patients/patients.service.js';
import { ProceduresController } from './procedures/procedures.controller.js';
import { ProceduresService } from './procedures/procedures.service.js';
import { AppointmentsController } from './appointments/appointments.controller.js';
import { AppointmentsService } from './appointments/appointments.service.js';
import { UnoController } from './uno/uno.controller.js';
import { UnoService } from './uno/uno.service.js';
import { InboxController } from './inbox/inbox.controller.js';
import { InboxService } from './inbox/inbox.service.js';
import { StageCampaignService } from './inbox/stage-campaign.service.js';
import { CampaignsController } from './campaigns/campaigns.controller.js';
import { CampaignsService } from './campaigns/campaigns.service.js';
import { UnitsController } from './units/units.controller.js';
import { UnitsService } from './units/units.service.js';
import { AiController } from './ai/ai.controller.js';
import { AiService } from './ai/ai.service.js';
import { UsageController } from './usage/usage.controller.js';
import { UsageService } from './usage/usage.service.js';
import { TenantContextInterceptor } from './security/tenant-context.interceptor.js';
import { JwtAuthGuard } from './security/jwt-auth.guard.js';
import { TenantGuard } from './security/tenant.guard.js';
import { RolesGuard } from './security/roles.guard.js';
import { TasksController } from './tasks/tasks.controller.js';
import { TasksService } from './tasks/tasks.service.js';
import { QuickRepliesController } from './quick-replies/quick-replies.controller.js';
import { QuickRepliesService } from './quick-replies/quick-replies.service.js';
import { MetaWebhookController } from './meta/meta-webhook.controller.js';
import { MetaWebhookService } from './meta/meta-webhook.service.js';
import { MetaWebhookProcessor } from './meta/meta-webhook.processor.js';
import { RedisCoordinatorService } from './queue/redis-coordinator.service.js';
import { OutboxDispatchController } from './outbox/outbox-dispatch.controller.js';
import { OutboxDispatchProcessor, OutboxDispatchService } from './outbox/outbox-dispatch.service.js';
import { MessagingConnectionsController } from './messaging/messaging-connections.controller.js';
import { MessagingConnectionsService } from './messaging/messaging-connections.service.js';
import { WhatsappContactsController } from './messaging/whatsapp-contacts.controller.js';
import { EvolutionWebhookController } from './messaging/evolution-webhook.controller.js';
import { EvolutionWebhookService } from './messaging/evolution-webhook.service.js';
import { AutomationsController } from './automations/automations.controller.js';
import { AutomationsService } from './automations/automations.service.js';
import { ReferralsController } from './referrals/referrals.controller.js';
import { ReferralsService } from './referrals/referrals.service.js';
import { SchedulingRulesService } from './appointments/scheduling-rules.service.js';
import { ResourcesController } from './resources/resources.controller.js';
import { ResourcesService } from './resources/resources.service.js';
import { UnitSchedulesController } from './unit-schedules/unit-schedules.controller.js';
import { UnitSchedulesService } from './unit-schedules/unit-schedules.service.js';
import { PlatformController } from './platform/platform.controller.js';
import { PlatformService } from './platform/platform.service.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { PrivacyController } from './privacy/privacy.controller.js';
import { PrivacyService } from './privacy/privacy.service.js';
import { TenantSettingsController } from './settings/tenant-settings.controller.js';
import { TenantSettingsService } from './settings/tenant-settings.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisConnection() }) }),
    BullModule.registerQueue({ name: 'meta-webhooks' }),
    BullModule.registerQueue({ name: 'outbox-dispatch' }),
    BullModule.registerQueue({ name: 'evolution-webhooks' }),
    BullModule.registerQueue({ name: 'automation-executions' }),
    PrismaModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    PatientsController,
    ProceduresController,
    AppointmentsController,
    UnoController,
    InboxController,
    CampaignsController,
    UnitsController,
    AiController,
    UsageController,
    TasksController,
    QuickRepliesController,
    MetaWebhookController,
    OutboxDispatchController,
    MessagingConnectionsController,
    WhatsappContactsController,
    EvolutionWebhookController,
    AutomationsController,
    ReferralsController,
    ResourcesController,
    UnitSchedulesController,
    PlatformController,
    DashboardController,
    ReportsController,
    PrivacyController,
    TenantSettingsController,
  ],
  providers: [
    AuthService,
    UsersService,
    InvitationMailerService,
    PatientsService,
    ProceduresService,
    AppointmentsService,
    UnoService,
    InboxService,
    StageCampaignService,
    CampaignsService,
    UnitsService,
    AiService,
    UsageService,
    TasksService,
    QuickRepliesService,
    MetaWebhookService,
    MetaWebhookProcessor,
    RedisCoordinatorService,
    OutboxDispatchService,
    OutboxDispatchProcessor,
    MessagingConnectionsService,
    EvolutionWebhookService,
    AutomationsService,
    ReferralsService,
    SchedulingRulesService,
    ResourcesService,
    UnitSchedulesService,
    PlatformService,
    DashboardService,
    ReportsService,
    PrivacyService,
    TenantSettingsService,
    TenantContextInterceptor,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380');
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isInteger(database) || database < 0 || database > 15) {
    throw new Error('REDIS_URL deve usar um índice de banco Redis entre 0 e 15.');
  }
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: database,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
