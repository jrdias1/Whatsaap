ALTER TABLE "Campaign" ADD COLUMN "mode" VARCHAR(24) NOT NULL DEFAULT 'BULK';

ALTER TABLE "ConversationStage"
  ADD COLUMN "campaignId" UUID,
  ADD COLUMN "inactivityDays" INTEGER;

CREATE TABLE "StageCampaignEnrollment" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "stageId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "inactivityDays" INTEGER NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "outboxMessageId" UUID,
  "reason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StageCampaignEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StageCampaignEnrollment_tenantId_id_key" ON "StageCampaignEnrollment"("tenantId", "id");
CREATE UNIQUE INDEX "StageCampaignEnrollment_tenantId_outboxMessageId_key" ON "StageCampaignEnrollment"("tenantId", "outboxMessageId");
CREATE INDEX "StageCampaignEnrollment_tenantId_status_dueAt_idx" ON "StageCampaignEnrollment"("tenantId", "status", "dueAt");
CREATE INDEX "StageCampaignEnrollment_tenantId_conversationId_status_idx" ON "StageCampaignEnrollment"("tenantId", "conversationId", "status");

ALTER TABLE "ConversationStage" ADD CONSTRAINT "ConversationStage_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "Campaign"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StageCampaignEnrollment" ADD CONSTRAINT "StageCampaignEnrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StageCampaignEnrollment" ADD CONSTRAINT "StageCampaignEnrollment_tenantId_conversationId_fkey" FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StageCampaignEnrollment" ADD CONSTRAINT "StageCampaignEnrollment_tenantId_stageId_fkey" FOREIGN KEY ("tenantId", "stageId") REFERENCES "ConversationStage"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StageCampaignEnrollment" ADD CONSTRAINT "StageCampaignEnrollment_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "Campaign"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
