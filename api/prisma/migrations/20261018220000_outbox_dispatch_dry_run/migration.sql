-- CreateEnum
CREATE TYPE "OutboxAttemptOutcome" AS ENUM ('ACCEPTED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'UNKNOWN', 'SUPPRESSED');

ALTER TYPE "OutboxStatus" ADD VALUE 'RETRY';
ALTER TYPE "OutboxStatus" ADD VALUE 'UNKNOWN';

ALTER TABLE "OutboxMessage"
  ADD COLUMN "enqueuedAt" TIMESTAMP(3),
  ADD COLUMN "lastError" VARCHAR(500),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "OutboxAttempt" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "outboxMessageId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "outcome" "OutboxAttemptOutcome" NOT NULL,
  "cause" VARCHAR(120) NOT NULL,
  "detail" VARCHAR(500),
  "nextAction" VARCHAR(120) NOT NULL,
  "providerReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboxAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DryRunProviderReceipt" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "outboxMessageId" UUID NOT NULL,
  "providerReference" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DryRunProviderReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutboxAttempt_tenantId_outcome_createdAt_idx" ON "OutboxAttempt"("tenantId", "outcome", "createdAt");
CREATE UNIQUE INDEX "OutboxAttempt_tenantId_outboxMessageId_attemptNumber_key" ON "OutboxAttempt"("tenantId", "outboxMessageId", "attemptNumber");
CREATE UNIQUE INDEX "DryRunProviderReceipt_providerReference_key" ON "DryRunProviderReceipt"("providerReference");
CREATE INDEX "DryRunProviderReceipt_tenantId_outboxMessageId_idx" ON "DryRunProviderReceipt"("tenantId", "outboxMessageId");
CREATE UNIQUE INDEX "DryRunProviderReceipt_tenantId_idempotencyKey_key" ON "DryRunProviderReceipt"("tenantId", "idempotencyKey");
CREATE INDEX "OutboxMessage_status_nextAttemptAt_scheduledAt_idx" ON "OutboxMessage"("status", "nextAttemptAt", "scheduledAt");
CREATE UNIQUE INDEX "OutboxMessage_tenantId_id_key" ON "OutboxMessage"("tenantId", "id");

ALTER TABLE "OutboxAttempt" ADD CONSTRAINT "OutboxAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutboxAttempt" ADD CONSTRAINT "OutboxAttempt_tenantId_outboxMessageId_fkey" FOREIGN KEY ("tenantId", "outboxMessageId") REFERENCES "OutboxMessage"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DryRunProviderReceipt" ADD CONSTRAINT "DryRunProviderReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
