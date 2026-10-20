-- CreateTable
CREATE TABLE "QuickReply" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(240),
    "shortcut" VARCHAR(40),
    "category" VARCHAR(60) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaWebhookEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "providerMessageId" TEXT,
    "providerTimestamp" BIGINT,

    CONSTRAINT "MetaWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuickReply_tenantId_active_category_name_idx" ON "QuickReply"("tenantId", "active", "category", "name");

-- CreateIndex
CREATE UNIQUE INDEX "QuickReply_tenantId_id_key" ON "QuickReply"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "QuickReply_tenantId_shortcut_key" ON "QuickReply"("tenantId", "shortcut");

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_phoneNumberId_key" ON "MetaConnection"("phoneNumberId");

-- CreateIndex
CREATE INDEX "MetaConnection_tenantId_status_idx" ON "MetaConnection"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_tenantId_id_key" ON "MetaConnection"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_tenantId_unitId_key" ON "MetaConnection"("tenantId", "unitId");

-- CreateIndex
CREATE INDEX "MetaWebhookEvent_status_nextAttemptAt_receivedAt_idx" ON "MetaWebhookEvent"("status", "nextAttemptAt", "receivedAt");

-- CreateIndex
CREATE INDEX "MetaWebhookEvent_tenantId_connectionId_providerMessageId_pr_idx" ON "MetaWebhookEvent"("tenantId", "connectionId", "providerMessageId", "providerTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "MetaWebhookEvent_tenantId_connectionId_eventKey_key" ON "MetaWebhookEvent"("tenantId", "connectionId", "eventKey");

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaWebhookEvent" ADD CONSTRAINT "MetaWebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaWebhookEvent" ADD CONSTRAINT "MetaWebhookEvent_tenantId_connectionId_fkey" FOREIGN KEY ("tenantId", "connectionId") REFERENCES "MetaConnection"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
