-- CreateEnum
CREATE TYPE "MessagingProvider" AS ENUM ('META_CLOUD', 'EVOLUTION_BAILEYS', 'EVOLUTION_CLOUD');

-- DropIndex
DROP INDEX "MetaConnection_tenantId_unitId_key";

-- AlterTable
ALTER TABLE "MetaConnection" ADD COLUMN     "displayName" TEXT NOT NULL DEFAULT 'Meta Cloud',
ADD COLUMN     "graphApiVersion" TEXT NOT NULL DEFAULT 'UNCONFIRMED';

-- AlterTable
ALTER TABLE "OutboxMessage" ADD COLUMN     "connectionId" UUID;

-- CreateTable
CREATE TABLE "EvolutionConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "apiBaseUrl" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "mode" "MessagingProvider" NOT NULL DEFAULT 'EVOLUTION_BAILEYS',
    "apiVersion" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    "apiKeyEncrypted" TEXT NOT NULL,
    "webhookSecretHash" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvolutionConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvolutionWebhookEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "enqueuedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "providerMessageId" TEXT,

    CONSTRAINT "EvolutionWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionConnection_webhookSecretHash_key" ON "EvolutionConnection"("webhookSecretHash");

-- CreateIndex
CREATE INDEX "EvolutionConnection_tenantId_unitId_status_idx" ON "EvolutionConnection"("tenantId", "unitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionConnection_tenantId_id_key" ON "EvolutionConnection"("tenantId", "id");

-- CreateIndex
CREATE INDEX "EvolutionWebhookEvent_status_enqueuedAt_nextAttemptAt_recei_idx" ON "EvolutionWebhookEvent"("status", "enqueuedAt", "nextAttemptAt", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionWebhookEvent_tenantId_connectionId_eventKey_key" ON "EvolutionWebhookEvent"("tenantId", "connectionId", "eventKey");

-- AddForeignKey
ALTER TABLE "EvolutionConnection" ADD CONSTRAINT "EvolutionConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvolutionConnection" ADD CONSTRAINT "EvolutionConnection_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvolutionWebhookEvent" ADD CONSTRAINT "EvolutionWebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvolutionWebhookEvent" ADD CONSTRAINT "EvolutionWebhookEvent_tenantId_connectionId_fkey" FOREIGN KEY ("tenantId", "connectionId") REFERENCES "EvolutionConnection"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
